"""Rewrite and scoring endpoints."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import desc, select

from app.config import Settings, get_settings
from app.db import AuditEvent, Database, RewriteJob
from app.engine import scorer
from app.engine.rewriter import RewriteEngine, RewriteResult
from app.schemas import (
    JobStatus,
    JobSummary,
    ScoreRequest,
    ScoreResponse,
    SimplifyRequest,
    SimplifyResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["simplify"])


def get_engine(request: Request) -> RewriteEngine:
    engine: RewriteEngine | None = getattr(request.app.state, "engine", None)
    if engine is None:  # pragma: no cover - only reachable on a failed startup
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Rewrite engine is not initialized",
        )
    return engine


def get_database(request: Request) -> Database | None:
    return getattr(request.app.state, "database", None)


@router.post("/simplify", response_model=SimplifyResponse)
async def simplify(
    payload: SimplifyRequest,
    engine: RewriteEngine = Depends(get_engine),
    database: Database | None = Depends(get_database),
    settings: Settings = Depends(get_settings),
) -> SimplifyResponse:
    """Rewrite a discharge summary to a target reading grade.

    Returns 200 with `status: needs_review` when the pipeline could not reach
    the target or Guard flagged a medication finding. That is a successful call
    with an unsuccessful outcome, and the console renders it differently from a
    transport error, so it is not a 4xx.
    """
    if len(payload.discharge_summary) > settings.max_input_chars:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Discharge summary is {len(payload.discharge_summary)} characters. "
                f"The limit is {settings.max_input_chars}. Split it by section."
            ),
        )

    target = payload.target_grade or settings.default_target_grade
    if not settings.min_target_grade <= target <= settings.max_target_grade:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"target_grade must be between {settings.min_target_grade} and "
                f"{settings.max_target_grade}"
            ),
        )

    result = await engine.run(
        discharge_summary=payload.discharge_summary,
        target_grade=target,
        preserve_terms=payload.preserve_terms,
        run_guard=payload.run_guard,
    )

    if result.status is JobStatus.FAILED:
        logger.error("job %s failed: %s", result.job_id, result.review_reasons)

    if database is not None:
        await _persist(database, result, payload)

    return _to_response(result)


@router.post("/score", response_model=ScoreResponse)
async def score_text(
    payload: ScoreRequest,
    settings: Settings = Depends(get_settings),
) -> ScoreResponse:
    """Measure text without rewriting it.

    The console calls this as the clinician pastes, so the grade badge is
    populated before anyone spends a model call.
    """
    target = payload.target_grade or settings.default_target_grade
    level = scorer.score(payload.text)
    return ScoreResponse(
        level=level,
        target_grade=target,
        meets_target=scorer.meets_target(level, target, settings.grade_tolerance),
        difficult_terms=scorer.find_difficult_terms(payload.text),
    )


@router.get("/jobs", response_model=list[JobSummary])
async def list_jobs(
    limit: int = 50,
    patient_id: str | None = None,
    database: Database | None = Depends(get_database),
) -> list[JobSummary]:
    """Recent jobs for the dashboard table."""
    # An empty list and an unreachable database must not look the same. Both
    # render as "no jobs yet", and that is the wrong thing to show somebody
    # looking for a record they know exists.
    if database is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Job history is unavailable because persistence is not connected",
        )

    limit = max(1, min(limit, 200))
    query = select(RewriteJob).order_by(desc(RewriteJob.created_at)).limit(limit)
    if patient_id:
        query = query.where(RewriteJob.patient_id == patient_id)

    # The engine is created lazily and does not connect on construction, so the
    # database can be unreachable even though `database` is not None. Report
    # that as an explicit outage. Returning an empty list would render as
    # "no jobs yet", which is the wrong thing to show a compliance officer
    # looking for a record that exists.
    try:
        async with database.sessionmaker() as session:
            rows = (await session.execute(query)).scalars().all()
    except Exception as exc:  # noqa: BLE001 - database boundary
        logger.exception("job history query failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Job history is temporarily unavailable: {exc}",
        ) from exc

    return [
        JobSummary(
            job_id=row.id,
            status=JobStatus(row.status),
            patient_id=row.patient_id,
            original_grade=row.original_grade,
            simplified_grade=row.simplified_grade,
            target_grade=row.target_grade,
            safety_score=row.safety_score,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.get("/jobs/{job_id}", response_model=SimplifyResponse)
async def get_job(
    job_id: str,
    database: Database | None = Depends(get_database),
) -> SimplifyResponse:
    """Rehydrate a stored job for the /simplify/[id] detail view."""
    if database is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Job history is not available because persistence is disabled",
        )

    try:
        async with database.sessionmaker() as session:
            row = await session.get(RewriteJob, job_id)
    except Exception as exc:  # noqa: BLE001 - database boundary
        logger.exception("job lookup failed for %s", job_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Job history is temporarily unavailable: {exc}",
        ) from exc

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    return _row_to_response(row)


# --------------------------------------------------------------------- helpers


def _to_response(result: RewriteResult) -> SimplifyResponse:
    return SimplifyResponse(
        job_id=result.job_id,
        status=result.status,
        original_text=result.original_text,
        simplified_text=result.simplified_text,
        original_level=result.original_level,
        simplified_level=result.simplified_level,
        target_grade=result.target_grade,
        grade_reduction=result.grade_reduction,
        attempts=result.attempts,
        difficult_terms_removed=result.difficult_terms_removed,
        guard=result.guard,
        review_reasons=result.review_reasons,
        created_at=datetime.now(UTC),
        duration_ms=result.duration_ms,
    )


def _row_to_response(row: RewriteJob) -> SimplifyResponse:
    """Rebuild a response from storage.

    Per-attempt detail lives in audit_events, not on the job row, so the
    rehydrated response carries an empty attempts list. The detail view fetches
    the audit trail separately when a reviewer expands it.
    """
    from app.schemas import ReadingLevel

    original_level = ReadingLevel(
        smog=row.original_smog,
        flesch_kincaid=row.original_flesch_kincaid,
        flesch_reading_ease=0.0,
        consensus_grade=row.original_grade,
        word_count=0,
        sentence_count=0,
        polysyllabic_word_count=0,
        avg_sentence_length=0.0,
    )
    simplified_level = ReadingLevel(
        smog=row.simplified_smog,
        flesch_kincaid=row.simplified_flesch_kincaid,
        flesch_reading_ease=0.0,
        consensus_grade=row.simplified_grade,
        word_count=0,
        sentence_count=0,
        polysyllabic_word_count=0,
        avg_sentence_length=0.0,
    )

    return SimplifyResponse(
        job_id=row.id,
        status=JobStatus(row.status),
        original_text=row.original_text,
        simplified_text=row.simplified_text,
        original_level=original_level,
        simplified_level=simplified_level,
        target_grade=row.target_grade,
        grade_reduction=round(row.original_grade - row.simplified_grade, 1),
        attempts=[],
        difficult_terms_removed=[],
        guard=None,
        review_reasons=list(row.review_reasons or []),
        created_at=row.created_at,
        duration_ms=row.duration_ms,
    )


async def _persist(database: Database, result: RewriteResult, payload: SimplifyRequest) -> None:
    """Write the job row plus one audit event per rewrite attempt.

    Persistence failures are logged and swallowed. A database outage must not
    cost the clinician a completed rewrite they are looking at on screen.
    """
    try:
        async with database.sessionmaker() as session:
            job = RewriteJob(
                id=result.job_id,
                status=result.status.value,
                patient_id=payload.patient_id,
                encounter_id=payload.encounter_id,
                clinician_id=payload.clinician_id,
                original_text=result.original_text,
                simplified_text=result.simplified_text,
                target_grade=result.target_grade,
                original_smog=result.original_level.smog,
                original_flesch_kincaid=result.original_level.flesch_kincaid,
                original_grade=result.original_level.consensus_grade,
                simplified_smog=result.simplified_level.smog,
                simplified_flesch_kincaid=result.simplified_level.flesch_kincaid,
                simplified_grade=result.simplified_level.consensus_grade,
                attempt_count=len(result.attempts),
                safety_score=result.guard.safety_score if result.guard else None,
                guard_passed=result.guard.passed if result.guard else None,
                review_reasons=result.review_reasons,
                duration_ms=result.duration_ms,
            )
            session.add(job)

            for attempt in result.attempts:
                session.add(
                    AuditEvent(
                        job_id=result.job_id,
                        event_type="rewrite_attempt",
                        actor=payload.clinician_id,
                        payload={
                            "attempt": attempt.attempt,
                            "accepted": attempt.accepted,
                            "rejection_reason": attempt.rejection_reason,
                            "smog": attempt.resulting_level.smog,
                            "flesch_kincaid": attempt.resulting_level.flesch_kincaid,
                            "model": attempt.model,
                            "latency_ms": attempt.latency_ms,
                        },
                    )
                )

            session.add(
                AuditEvent(
                    job_id=result.job_id,
                    event_type=f"job_{result.status.value}",
                    actor=payload.clinician_id,
                    payload={
                        "target_grade": result.target_grade,
                        "grade_reduction": result.grade_reduction,
                        "safety_score": result.guard.safety_score if result.guard else None,
                        "review_reasons": result.review_reasons,
                    },
                )
            )

            await session.commit()
    except Exception:  # noqa: BLE001 - persistence must not break the request
        logger.exception("failed to persist job %s", result.job_id)
