"""Drug safety validation endpoints."""

from __future__ import annotations

import logging
import time
from collections import OrderedDict
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import Settings, get_settings
from app.engine import diff_checker
from app.engine.drug_extractor import extract
from app.engine.fda_client import FDAClient
from app.schemas import (
    DrugLookupResponse,
    Severity,
    ValidateRequest,
    ValidateResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["validate"])


def get_client(request: Request) -> FDAClient:
    client: FDAClient | None = getattr(request.app.state, "fda", None)
    if client is None:  # pragma: no cover - only on a failed startup
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="FDA client is not initialized",
        )
    return client


def get_results(request: Request) -> OrderedDict[str, ValidateResponse]:
    return request.app.state.results


@router.post("/validate", response_model=ValidateResponse)
async def validate(
    payload: ValidateRequest,
    client: FDAClient = Depends(get_client),
    settings: Settings = Depends(get_settings),
    results: OrderedDict[str, ValidateResponse] = Depends(get_results),
) -> ValidateResponse:
    """Compare a rewrite against its source and decide whether it is releasable.

    Always returns 200 with a verdict. A failed document is a successful
    validation with a negative answer, and Core needs the finding detail to
    explain the hold to the clinician.
    """
    started = time.perf_counter()

    for field_name, text in (
        ("original_text", payload.original_text),
        ("simplified_text", payload.simplified_text),
    ):
        if len(text) > settings.max_input_chars:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"{field_name} exceeds the {settings.max_input_chars} character limit",
            )

    # Gather every drug name from both sides, then resolve them all in one
    # bounded concurrent batch rather than serially per finding.
    source_names = extract(payload.original_text).names
    output_names = extract(payload.simplified_text).names
    all_names = sorted(source_names | output_names)

    labels: dict[str, object] = {}
    fda_available = True
    if payload.check_fda and all_names:
        resolved = await client.lookup_many(all_names)
        labels = dict(resolved)
        # Every lookup returning None means openFDA is unreachable, not that
        # none of the drugs exist. Guard reports that rather than hiding it.
        fda_available = any(label is not None for label in resolved.values())
        if not fda_available:
            logger.warning("openFDA unreachable, findings downgraded for job %s", payload.job_id)
    elif not payload.check_fda:
        fda_available = False

    findings, source_records, output_records, counts = diff_checker.compare(
        payload.original_text,
        payload.simplified_text,
        labels=labels,  # type: ignore[arg-type]
        fda_available=fda_available,
    )

    response = ValidateResponse(
        job_id=payload.job_id,
        passed=diff_checker.passed(findings),
        safety_score=diff_checker.safety_score(findings),
        drugs_in_source=counts["drugs_in_source"],
        drugs_in_output=counts["drugs_in_output"],
        critical_findings=sum(1 for f in findings if f.severity is Severity.CRITICAL),
        warning_findings=sum(1 for f in findings if f.severity is Severity.WARNING),
        info_findings=sum(1 for f in findings if f.severity is Severity.INFO),
        findings=findings,
        source_medications=source_records,
        output_medications=output_records,
        warnings_in_source=counts["warnings_in_source"],
        warnings_in_output=counts["warnings_in_output"],
        fda_available=fda_available,
        duration_ms=int((time.perf_counter() - started) * 1000),
        created_at=datetime.now(UTC),
    )

    if payload.job_id:
        results[payload.job_id] = response
        while len(results) > settings.result_cache_size:
            results.popitem(last=False)

    return response


@router.get("/validate/{job_id}", response_model=ValidateResponse)
async def get_validation(
    job_id: str,
    results: OrderedDict[str, ValidateResponse] = Depends(get_results),
) -> ValidateResponse:
    """Retrieve a recent validation for the console detail drawer."""
    response = results.get(job_id)
    if response is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "No recent validation for this job. Results are held in memory "
                "for the current process only. The durable copy lives in Core's "
                "audit trail."
            ),
        )
    return response


@router.get("/drugs/{name}", response_model=DrugLookupResponse)
async def lookup_drug(
    name: str,
    client: FDAClient = Depends(get_client),
) -> DrugLookupResponse:
    """openFDA passthrough for the drug detail drawer."""
    label = await client.lookup(name)
    if label is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="openFDA could not be reached",
        )

    return DrugLookupResponse(
        name=name,
        found=label.found,
        generic_names=label.generic_names,
        brand_names=label.brand_names,
        has_boxed_warning=label.has_boxed_warning,
        boxed_warning=label.boxed_warning,
        interaction_count=len(label.drug_interactions),
    )
