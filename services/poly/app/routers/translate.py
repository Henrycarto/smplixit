"""Translation endpoints."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import Settings, get_settings
from app.engine import language_registry
from app.engine.deepl_client import DeepLClient, DeepLError
from app.schemas import (
    BatchTranslateRequest,
    BatchTranslateResponse,
    LanguageInfo,
    LanguageListResponse,
    TranslateRequest,
    TranslateResponse,
    TranslationStatus,
    UsageResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["translate"])


def get_client(request: Request) -> DeepLClient:
    client: DeepLClient | None = getattr(request.app.state, "deepl", None)
    if client is None:  # pragma: no cover - only on a failed startup
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Translation client is not initialized",
        )
    return client


@router.get("/languages", response_model=LanguageListResponse)
async def list_languages() -> LanguageListResponse:
    """Every supported target, with its tier.

    The console renders Tier 1 and Tier 2 in separate groups. A nurse needs to
    know before selecting that Hmong routes to interpreter services rather than
    returning a document in ten seconds.
    """
    counts = language_registry.counts()
    return LanguageListResponse(
        languages=[
            LanguageInfo(
                code=language.code,
                name=language.name,
                native_name=language.native_name,
                tier=language.tier.value,
                machine_translatable=language.deepl_code is not None,
                rtl=language.rtl,
            )
            for language in language_registry.all_languages()
        ],
        total=counts["total"],
        machine_translated=counts["machine_translated"],
        requires_human_review=counts["requires_human_review"],
    )


@router.post("/translate", response_model=TranslateResponse)
async def translate(
    payload: TranslateRequest,
    client: DeepLClient = Depends(get_client),
    settings: Settings = Depends(get_settings),
) -> TranslateResponse:
    """Translate one simplified document into one language."""
    if len(payload.text) > settings.max_input_chars:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Text exceeds the {settings.max_input_chars} character limit",
        )

    language = language_registry.get(payload.target_lang)
    if language is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"'{payload.target_lang}' is not a supported target. "
                "Call GET /languages for the list."
            ),
        )

    return await _translate_one(
        text=payload.text,
        language=language,
        source_lang=payload.source_lang,
        preserve_terms=payload.preserve_terms,
        job_id=payload.job_id,
        client=client,
        settings=settings,
    )


@router.post("/translate/batch", response_model=BatchTranslateResponse)
async def translate_batch(
    payload: BatchTranslateRequest,
    client: DeepLClient = Depends(get_client),
    settings: Settings = Depends(get_settings),
) -> BatchTranslateResponse:
    """Translate one document into several languages concurrently."""
    started = time.perf_counter()

    if len(payload.target_langs) > settings.max_batch_targets:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"A batch is limited to {settings.max_batch_targets} languages",
        )

    unknown = [code for code in payload.target_langs if not language_registry.is_supported(code)]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported target language(s): {', '.join(unknown)}",
        )

    languages = [language_registry.get(code) for code in payload.target_langs]
    results = await asyncio.gather(
        *(
            _translate_one(
                text=payload.text,
                language=language,
                source_lang=payload.source_lang,
                preserve_terms=payload.preserve_terms,
                job_id=payload.job_id,
                client=client,
                settings=settings,
            )
            for language in languages
            if language is not None
        )
    )

    releasable = sum(1 for result in results if result.status is TranslationStatus.RELEASABLE)
    return BatchTranslateResponse(
        job_id=payload.job_id,
        results=list(results),
        releasable_count=releasable,
        held_count=len(results) - releasable,
        duration_ms=int((time.perf_counter() - started) * 1000),
    )


@router.get("/usage", response_model=UsageResponse)
async def usage(client: DeepLClient = Depends(get_client)) -> UsageResponse:
    """Character quota remaining. Checked before a ward-wide bulk run."""
    try:
        data = await client.usage()
    except Exception as exc:  # noqa: BLE001 - network boundary
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not read DeepL usage: {exc}",
        ) from exc

    used = int(data.get("character_count", 0))
    limit = int(data.get("character_limit", 0)) or 1
    return UsageResponse(
        character_count=used,
        character_limit=limit,
        percent_used=round(used / limit * 100, 2),
    )


# --------------------------------------------------------------------- helpers


async def _translate_one(
    *,
    text: str,
    language: language_registry.Language,
    source_lang: str,
    preserve_terms: list[str],
    job_id: str | None,
    client: DeepLClient,
    settings: Settings,
) -> TranslateResponse:
    started = time.perf_counter()

    def _respond(
        *,
        status_value: TranslationStatus,
        translated: str | None,
        protected: list[str],
        lost: list[str],
        reasons: list[str],
    ) -> TranslateResponse:
        return TranslateResponse(
            job_id=job_id,
            status=status_value,
            source_lang=source_lang,
            target_lang=language.code,
            language_name=language.name,
            rtl=language.rtl,
            original_text=text,
            translated_text=translated,
            protected_terms=protected,
            lost_terms=lost,
            review_reasons=reasons,
            character_count=len(text),
            duration_ms=int((time.perf_counter() - started) * 1000),
            created_at=datetime.now(UTC),
        )

    if language.deepl_code is None:
        return _respond(
            status_value=TranslationStatus.HUMAN_TRANSLATION_REQUIRED,
            translated=None,
            protected=[],
            lost=[],
            reasons=[
                f"{language.name} is outside the machine translation engine's coverage. "
                "Route this document to interpreter services with the simplified "
                "English attached."
            ],
        )

    try:
        translated, protected, lost = await client.translate(
            text=text,
            target_lang=language.deepl_code,
            source_lang=source_lang,
            preserve_terms=preserve_terms,
            glossary_id=settings.deepl_glossary_id,
        )
    except DeepLError as exc:
        logger.error("translation to %s failed: %s", language.code, exc)
        return _respond(
            status_value=TranslationStatus.FAILED,
            translated=None,
            protected=[],
            lost=[],
            reasons=[str(exc)],
        )

    if lost and settings.fail_on_lost_terms:
        return _respond(
            status_value=TranslationStatus.NEEDS_REVIEW,
            translated=translated,
            protected=protected,
            lost=lost,
            reasons=[
                f"{len(lost)} protected term(s) did not survive translation: "
                f"{', '.join(lost[:10])}. Do not release without review."
            ],
        )

    return _respond(
        status_value=TranslationStatus.RELEASABLE,
        translated=translated,
        protected=protected,
        lost=lost,
        reasons=[],
    )
