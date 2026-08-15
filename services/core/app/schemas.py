"""Request and response contracts for Smplixit Core.

These models are the public API surface. `packages/shared-types` mirrors them on
the TypeScript side, so any change here needs a matching change there.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class JobStatus(str, Enum):
    """Terminal state of a rewrite job."""

    COMPLETED = "completed"
    NEEDS_REVIEW = "needs_review"
    FAILED = "failed"


class ReadingLevel(BaseModel):
    """Literacy measurement for one block of text.

    Two independent formulas are reported because they weight different things.
    SMOG counts polysyllabic words, which is what actually breaks comprehension
    in clinical text. Flesch-Kincaid weights sentence length. A rewrite passes
    only when both clear the target, so shortening sentences without simplifying
    vocabulary cannot fake a pass.
    """

    smog: float = Field(..., description="SMOG grade level")
    flesch_kincaid: float = Field(..., description="Flesch-Kincaid grade level")
    flesch_reading_ease: float = Field(..., description="Flesch Reading Ease, 0 to 100")
    consensus_grade: float = Field(..., description="Max of SMOG and Flesch-Kincaid")

    word_count: int
    sentence_count: int
    polysyllabic_word_count: int
    avg_sentence_length: float

    @property
    def meets_target(self) -> bool:  # pragma: no cover - convenience only
        raise NotImplementedError("Use scorer.meets_target, which knows the tolerance")


class DifficultTerm(BaseModel):
    """A term flagged as above the target reading level."""

    term: str
    syllables: int
    occurrences: int
    plain_language_suggestion: str | None = None


class SimplifyRequest(BaseModel):
    discharge_summary: str = Field(..., min_length=40, description="Raw clinical text")
    target_grade: int | None = Field(
        default=None,
        ge=3,
        le=12,
        description="Target reading grade. Falls back to the service default of 6.",
    )
    patient_id: str | None = Field(default=None, description="FHIR Patient resource id")
    encounter_id: str | None = Field(default=None, description="FHIR Encounter resource id")
    clinician_id: str | None = Field(default=None, description="Authenticated fhirUser")
    preserve_terms: list[str] = Field(
        default_factory=list,
        description="Clinical terms that must survive verbatim, for example device names",
    )
    run_guard: bool = Field(default=True, description="Run drug safety validation inline")

    @field_validator("discharge_summary")
    @classmethod
    def strip_and_check(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("discharge_summary cannot be blank")
        return cleaned


class RewriteAttempt(BaseModel):
    """One pass of the rewrite loop, kept for auditability.

    Regulators and clinical safety officers ask how the output was produced.
    Storing every attempt, including rejected ones, answers that question
    without re-running a model against PHI.
    """

    attempt: int
    target_grade: int
    resulting_level: ReadingLevel
    accepted: bool
    rejection_reason: str | None = None
    model: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    latency_ms: int


class GuardSummary(BaseModel):
    """Condensed Guard verdict embedded in the Core response."""

    safety_score: float = Field(..., ge=0, le=100)
    passed: bool
    drugs_in_source: int
    drugs_in_output: int
    critical_findings: int
    warning_findings: int
    detail_url: str | None = None


class SimplifyResponse(BaseModel):
    job_id: str
    status: JobStatus

    original_text: str
    simplified_text: str

    original_level: ReadingLevel
    simplified_level: ReadingLevel
    target_grade: int
    grade_reduction: float = Field(..., description="Consensus grades removed by the rewrite")

    attempts: list[RewriteAttempt]
    difficult_terms_removed: list[DifficultTerm] = Field(default_factory=list)

    guard: GuardSummary | None = None
    review_reasons: list[str] = Field(default_factory=list)

    created_at: datetime
    duration_ms: int


class ScoreRequest(BaseModel):
    """Scoring without rewriting. Used by the console to grade text as it is pasted."""

    text: str = Field(..., min_length=1)
    target_grade: int | None = Field(default=None, ge=3, le=12)


class ScoreResponse(BaseModel):
    level: ReadingLevel
    target_grade: int
    meets_target: bool
    difficult_terms: list[DifficultTerm]


class JobSummary(BaseModel):
    """Row shape for the dashboard job table."""

    job_id: str
    status: JobStatus
    patient_id: str | None
    original_grade: float
    simplified_grade: float
    target_grade: int
    safety_score: float | None
    created_at: datetime


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
    context: dict[str, Any] | None = None
