"""Request and response contracts for Smplixit Poly."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class TranslationStatus(str, Enum):
    RELEASABLE = "releasable"
    # Translation completed but a protected term did not survive. Held.
    NEEDS_REVIEW = "needs_review"
    # Language is outside DeepL's coverage. Routed to interpreter services.
    HUMAN_TRANSLATION_REQUIRED = "human_translation_required"
    FAILED = "failed"


class LanguageInfo(BaseModel):
    code: str
    name: str
    native_name: str
    tier: str
    machine_translatable: bool
    rtl: bool


class LanguageListResponse(BaseModel):
    languages: list[LanguageInfo]
    total: int
    machine_translated: int
    requires_human_review: int


class TranslateRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Simplified English from Core")
    target_lang: str = Field(..., description="Target language code, for example 'es'")
    source_lang: str = Field(default="EN", description="Source language code")
    preserve_terms: list[str] = Field(
        default_factory=list,
        description="Terms that must survive byte-for-byte. In practice the drug list from Guard.",
    )
    job_id: str | None = Field(default=None, description="Core job id, for audit correlation")

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("text cannot be blank")
        return cleaned


class TranslateResponse(BaseModel):
    job_id: str | None
    status: TranslationStatus

    source_lang: str
    target_lang: str
    language_name: str
    rtl: bool

    original_text: str
    translated_text: str | None

    protected_terms: list[str] = Field(default_factory=list)
    lost_terms: list[str] = Field(
        default_factory=list,
        description="Protected terms missing from the output. Non-empty means do not release.",
    )

    review_reasons: list[str] = Field(default_factory=list)
    character_count: int
    duration_ms: int
    created_at: datetime


class BatchTranslateRequest(BaseModel):
    """One simplified document out to several languages at once.

    A discharge nurse working a multilingual ward asks for three or four
    languages in one action, not one request per language.
    """

    text: str = Field(..., min_length=1)
    target_langs: list[str] = Field(..., min_length=1)
    source_lang: str = "EN"
    preserve_terms: list[str] = Field(default_factory=list)
    job_id: str | None = None


class BatchTranslateResponse(BaseModel):
    job_id: str | None
    results: list[TranslateResponse]
    releasable_count: int
    held_count: int
    duration_ms: int


class UsageResponse(BaseModel):
    character_count: int
    character_limit: int
    percent_used: float


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
