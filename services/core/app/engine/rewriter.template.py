"""Reference rewrite engine.

This is the tracked template. `rewriter.py`, the module the service actually
imports, is not distributed with this repository: the grade-level constraint
logic, the attempt-selection strategy, and the convergence tuning are
proprietary.

Copy this file to `rewriter.py` (or run `npm run bootstrap:engine`) to get a
working service. This template runs the same loop shape and enforces the same
safety posture, but it takes the last attempt rather than the best one and does
not carry the tuned per-formula correction signal.

Interface contract that `rewriter.py` must satisfy:

    class RewriteResult          dataclass, fields as below, `grade_reduction` property
    class RewriteEngine
        __init__(settings: Settings)
        async run(*, discharge_summary, target_grade, preserve_terms, run_guard)
            -> RewriteResult
        async aclose() -> None

Safety posture that any implementation must preserve:

  - Never report a grade the measured text does not earn. Every exit path
    reports the score of the text actually returned.
  - Fail closed when drug safety validation cannot run and is required.
  - Never return `completed` for a rewrite that missed the target.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field

import httpx
from openai import AsyncOpenAI

from app.config import Settings
from app.engine import prompt_builder, scorer
from app.schemas import (
    DifficultTerm,
    GuardSummary,
    JobStatus,
    ReadingLevel,
    RewriteAttempt,
)

logger = logging.getLogger(__name__)


@dataclass
class RewriteResult:
    job_id: str
    status: JobStatus
    original_text: str
    simplified_text: str
    original_level: ReadingLevel
    simplified_level: ReadingLevel
    target_grade: int
    attempts: list[RewriteAttempt]
    difficult_terms_removed: list[DifficultTerm] = field(default_factory=list)
    guard: GuardSummary | None = None
    review_reasons: list[str] = field(default_factory=list)
    duration_ms: int = 0

    @property
    def grade_reduction(self) -> float:
        return round(self.original_level.consensus_grade - self.simplified_level.consensus_grade, 1)


class RewriteEngine:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            timeout=settings.openai_timeout_seconds,
        )
        self._guard = httpx.AsyncClient(
            base_url=settings.guard_service_url,
            timeout=settings.guard_timeout_seconds,
        )

    async def aclose(self) -> None:
        await self._guard.aclose()
        await self._client.close()

    async def _call_model(
        self, messages: list[dict[str, str]]
    ) -> tuple[str, int | None, int | None]:
        response = await self._client.chat.completions.create(
            model=self._settings.openai_model,
            messages=messages,  # type: ignore[arg-type]
            temperature=self._settings.openai_temperature,
        )
        content = (response.choices[0].message.content or "").strip()
        usage = response.usage
        return (
            content,
            usage.prompt_tokens if usage else None,
            usage.completion_tokens if usage else None,
        )

    async def run(
        self,
        *,
        discharge_summary: str,
        target_grade: int | None = None,
        preserve_terms: list[str] | None = None,
        run_guard: bool = True,
    ) -> RewriteResult:
        started = time.perf_counter()
        job_id = str(uuid.uuid4())
        settings = self._settings
        target = target_grade or settings.default_target_grade
        preserve_terms = preserve_terms or []

        original_level = scorer.score(discharge_summary)
        attempts: list[RewriteAttempt] = []
        review_reasons: list[str] = []

        text = ""
        level: ReadingLevel | None = None
        failure_reason: str | None = None

        for attempt_number in range(1, settings.max_rewrite_attempts + 1):
            if attempt_number == 1:
                messages = prompt_builder.build_initial_prompt(
                    discharge_summary=discharge_summary,
                    target_grade=target,
                    preserve_terms=preserve_terms,
                    difficult_terms=scorer.find_difficult_terms(discharge_summary),
                )
            else:
                messages = prompt_builder.build_refinement_prompt(
                    discharge_summary=discharge_summary,
                    previous_output=text,
                    target_grade=target,
                    failure_reason=failure_reason or "",
                    attempt=attempt_number,
                    preserve_terms=preserve_terms,
                    difficult_terms=scorer.find_difficult_terms(text),
                )

            call_started = time.perf_counter()
            try:
                text, prompt_tokens, completion_tokens = await self._call_model(messages)
            except Exception as exc:  # noqa: BLE001 - network boundary
                logger.exception("rewrite attempt %s failed for job %s", attempt_number, job_id)
                review_reasons.append(f"Model call failed on attempt {attempt_number}: {exc}")
                break
            latency_ms = int((time.perf_counter() - call_started) * 1000)

            if not text:
                review_reasons.append(f"Model returned empty output on attempt {attempt_number}")
                continue

            level = scorer.score(text)
            failures = scorer.gate_failures(level, target, settings.grade_tolerance)
            rejection = scorer.rejection_reason(level, target, settings.grade_tolerance)
            failure_reason = prompt_builder.correction_instruction(failures)

            attempts.append(
                RewriteAttempt(
                    attempt=attempt_number,
                    target_grade=target,
                    resulting_level=level,
                    accepted=not failures,
                    rejection_reason=rejection,
                    model=settings.openai_model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    latency_ms=latency_ms,
                )
            )

            if not failures:
                break

        if level is None:
            return RewriteResult(
                job_id=job_id,
                status=JobStatus.FAILED,
                original_text=discharge_summary,
                simplified_text="",
                original_level=original_level,
                simplified_level=original_level,
                target_grade=target,
                attempts=attempts,
                review_reasons=review_reasons or ["No usable rewrite was produced"],
                duration_ms=int((time.perf_counter() - started) * 1000),
            )

        met_target = scorer.meets_target(level, target, settings.grade_tolerance)
        if not met_target:
            review_reasons.append(
                f"Best attempt landed at grade {level.consensus_grade} against a "
                f"target of {target}. Clinician review required."
            )

        guard_summary: GuardSummary | None = None
        if run_guard:
            guard_summary, guard_reasons = await self._validate(
                job_id=job_id,
                original_text=discharge_summary,
                simplified_text=text,
            )
            review_reasons.extend(guard_reasons)

        status = self._resolve_status(
            met_target=met_target,
            guard_summary=guard_summary,
            guard_ran=run_guard,
            review_reasons=review_reasons,
        )

        return RewriteResult(
            job_id=job_id,
            status=status,
            original_text=discharge_summary,
            simplified_text=text,
            original_level=original_level,
            simplified_level=level,
            target_grade=target,
            attempts=attempts,
            difficult_terms_removed=scorer.terms_removed(discharge_summary, text),
            guard=guard_summary,
            review_reasons=review_reasons,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )

    async def _validate(
        self, *, job_id: str, original_text: str, simplified_text: str
    ) -> tuple[GuardSummary | None, list[str]]:
        try:
            response = await self._guard.post(
                "/validate",
                json={
                    "job_id": job_id,
                    "original_text": original_text,
                    "simplified_text": simplified_text,
                },
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:  # noqa: BLE001 - network boundary
            logger.warning("guard validation unavailable for job %s: %s", job_id, exc)
            if self._settings.guard_required:
                return None, [
                    "Drug safety validation could not run. The rewrite is held "
                    "for review and must not be released to a patient."
                ]
            return None, ["Drug safety validation was skipped"]

        summary = GuardSummary(
            safety_score=payload["safety_score"],
            passed=payload["passed"],
            drugs_in_source=payload["drugs_in_source"],
            drugs_in_output=payload["drugs_in_output"],
            critical_findings=payload["critical_findings"],
            warning_findings=payload["warning_findings"],
            detail_url=f"{self._settings.guard_service_url}/validate/{job_id}",
        )

        reasons: list[str] = []
        if not summary.passed:
            reasons.append(
                f"Guard flagged {summary.critical_findings} critical medication "
                f"finding(s). The rewrite cannot be released as is."
            )
        return summary, reasons

    @staticmethod
    def _resolve_status(
        *,
        met_target: bool,
        guard_summary: GuardSummary | None,
        guard_ran: bool,
        review_reasons: list[str],
    ) -> JobStatus:
        if not met_target:
            return JobStatus.NEEDS_REVIEW
        if guard_ran and guard_summary is None:
            return JobStatus.NEEDS_REVIEW
        if guard_summary is not None and not guard_summary.passed:
            return JobStatus.NEEDS_REVIEW
        if review_reasons:
            return JobStatus.NEEDS_REVIEW
        return JobStatus.COMPLETED
