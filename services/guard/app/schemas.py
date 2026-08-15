"""Request and response contracts for Smplixit Guard."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class Severity(str, Enum):
    """Three levels, and the boundary between them is a policy decision.

    CRITICAL   the rewrite is not releasable. A patient following it could take
               the wrong drug, the wrong amount, or miss a stop condition.
    WARNING    releasable after a clinician looks at it. Something changed that
               is probably fine but was not verifiable automatically.
    INFO       no action needed. Recorded so the audit trail is complete.
    """

    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class FindingType(str, Enum):
    DRUG_MISSING = "drug_missing"
    DRUG_ADDED = "drug_added"
    DOSE_MISSING = "dose_missing"
    DOSE_CHANGED = "dose_changed"
    FREQUENCY_MISSING = "frequency_missing"
    FREQUENCY_CHANGED = "frequency_changed"
    ROUTE_MISSING = "route_missing"
    ROUTE_CHANGED = "route_changed"
    DURATION_CHANGED = "duration_changed"
    WARNING_LOST = "warning_lost"
    BOXED_WARNING_NOT_CONVEYED = "boxed_warning_not_conveyed"
    INTERACTION_NOT_CONVEYED = "interaction_not_conveyed"
    DRUG_UNVERIFIED = "drug_unverified"


class Finding(BaseModel):
    """One thing that changed between the source and the rewrite."""

    type: FindingType
    severity: Severity
    drug_name: str | None = None

    message: str = Field(..., description="Plain-language statement of what changed")
    source_value: str | None = Field(default=None, description="What the source said")
    output_value: str | None = Field(default=None, description="What the rewrite says")

    source_context: str | None = Field(default=None, description="Sentence from the source")
    output_context: str | None = Field(default=None, description="Sentence from the rewrite")

    fda_verified: bool = Field(
        default=False, description="Whether the drug was confirmed against openFDA"
    )
    remediation: str | None = Field(
        default=None, description="What a clinician should do about it"
    )


class MedicationRecord(BaseModel):
    """A medication as Guard understood it, on one side of the rewrite."""

    name: str
    surface_form: str
    dose: str | None = None
    route: str | None = None
    frequency: str | None = None
    duration: str | None = None
    detection: str
    fda_verified: bool
    has_boxed_warning: bool = False


class ValidateRequest(BaseModel):
    original_text: str = Field(..., min_length=1, description="Source discharge summary")
    simplified_text: str = Field(..., min_length=1, description="Rewritten instructions")
    job_id: str | None = Field(default=None, description="Core job id, for audit correlation")
    check_fda: bool = Field(
        default=True,
        description="Cross-reference openFDA. Disable only for offline testing.",
    )

    @field_validator("original_text", "simplified_text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("text cannot be blank")
        return cleaned


class ValidateResponse(BaseModel):
    job_id: str | None

    passed: bool = Field(..., description="False if any critical finding was raised")
    safety_score: float = Field(..., ge=0, le=100)

    drugs_in_source: int
    drugs_in_output: int

    critical_findings: int
    warning_findings: int
    info_findings: int

    findings: list[Finding] = Field(default_factory=list)
    source_medications: list[MedicationRecord] = Field(default_factory=list)
    output_medications: list[MedicationRecord] = Field(default_factory=list)

    warnings_in_source: int = 0
    warnings_in_output: int = 0

    fda_available: bool = Field(
        default=True,
        description="False when openFDA could not be reached. Findings are downgraded, not hidden.",
    )

    duration_ms: int
    created_at: datetime


class DrugLookupResponse(BaseModel):
    """Direct openFDA passthrough, used by the console drug detail drawer."""

    name: str
    found: bool
    generic_names: list[str] = Field(default_factory=list)
    brand_names: list[str] = Field(default_factory=list)
    has_boxed_warning: bool = False
    boxed_warning: str | None = None
    interaction_count: int = 0


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
