"""Pre-rewrite against post-rewrite comparison.

This is the module that decides whether a rewritten discharge instruction is
safe to hand to a patient. Everything else in Guard feeds it.

Scoring. The safety score starts at 100 and loses points per finding. It is a
communication device for the console, not the pass/fail gate. The gate is
simpler and stricter: any single critical finding fails the document. A score of
94 with one critical finding is a failure, and the console shows it in red.
Scores exist so a reviewer can triage a queue of held documents, not so a
borderline document can be argued into release.

Weighting rationale:

  A missing drug is the worst outcome, because the patient stops taking
  something nobody told them to stop. A changed dose is close behind. A missing
  route is usually recoverable from context ("take" implies oral), so it costs
  less. A lost warning is weighted like a dose change, because a missed stop
  condition and a wrong amount put the patient in the same emergency department.
"""

from __future__ import annotations

import re

from app.engine.drug_extractor import (
    ExtractionResult,
    MedicationMention,
    extract,
    extract_warnings,
)
from app.engine.fda_client import DrugLabel
from app.schemas import Finding, FindingType, MedicationRecord, Severity

# Points removed from 100 per finding, by type.
PENALTIES: dict[FindingType, float] = {
    FindingType.DRUG_MISSING: 40.0,
    FindingType.DRUG_ADDED: 35.0,
    FindingType.DOSE_CHANGED: 35.0,
    FindingType.DOSE_MISSING: 25.0,
    FindingType.FREQUENCY_CHANGED: 30.0,
    FindingType.FREQUENCY_MISSING: 18.0,
    FindingType.ROUTE_CHANGED: 20.0,
    FindingType.ROUTE_MISSING: 6.0,
    FindingType.DURATION_CHANGED: 15.0,
    FindingType.WARNING_LOST: 30.0,
    FindingType.BOXED_WARNING_NOT_CONVEYED: 25.0,
    FindingType.INTERACTION_NOT_CONVEYED: 8.0,
    FindingType.DRUG_UNVERIFIED: 3.0,
}

# Fraction of source warnings that must survive before Guard raises a finding.
# Not 1.0: a rewrite legitimately merges "Do not drive" and "Do not operate
# machinery" into one sentence, and failing that would make the check noise.
WARNING_RETENTION_THRESHOLD = 0.75


def _to_record(mention: MedicationMention, label: DrugLabel | None) -> MedicationRecord:
    return MedicationRecord(
        name=mention.name,
        surface_form=mention.surface_form,
        dose=mention.dose_string,
        route=mention.route,
        frequency=mention.frequency,
        duration=mention.duration,
        detection=mention.detection,
        fda_verified=bool(label and label.found),
        has_boxed_warning=bool(label and label.has_boxed_warning),
    )


def _resolve_aliases(
    source: ExtractionResult,
    output: ExtractionResult,
    labels: dict[str, DrugLabel | None],
) -> dict[str, str]:
    """Map brand names onto generic names using openFDA label data.

    A rewrite that turns "Coumadin" into "warfarin" has not lost a drug. Without
    this map, that swap reports as one drug missing plus one drug added, which
    is two critical findings for a correct rewrite. The label lists both names,
    so the two mentions collapse onto the same canonical key.
    """
    canonical: dict[str, str] = {}
    for name in source.names | output.names:
        label = labels.get(name)
        if label and label.found and label.generic_names:
            canonical[name] = label.generic_names[0]
        else:
            canonical[name] = name
    return canonical


def _best_mention(mentions: list[MedicationMention]) -> MedicationMention:
    """Pick the most complete mention when a drug appears several times.

    A discharge summary names a drug in the narrative and again in the
    medication list. The list entry carries the dose and frequency, so it is the
    one to compare against.
    """
    return max(
        mentions,
        key=lambda m: (
            m.dose_value is not None,
            m.frequency is not None,
            m.route is not None,
            m.duration is not None,
        ),
    )


def _normalize_dose(mention: MedicationMention) -> tuple[float, str] | None:
    """Convert a dose to a comparable (value, unit) pair.

    Only mass units are converted. Converting "2 tablets" to milligrams needs the
    strength of the tablet, which is not in the text, so tablet counts compare
    literally.
    """
    if mention.dose_value is None or mention.dose_unit is None:
        return None

    unit = mention.dose_unit.lower()
    value = mention.dose_value

    if unit == "g":
        return value * 1000, "mg"
    if unit == "mcg":
        return value / 1000, "mg"
    if unit == "mg":
        return value, "mg"
    if unit == "l":
        return value * 1000, "ml"
    if unit == "ml":
        return value, "ml"
    return value, unit


_WARNING_STOPWORDS: frozenset[str] = frozenset(
    {
        "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "is", "are",
        "was", "were", "be", "been", "with", "for", "your", "you", "this", "that",
        "it", "if", "as", "by", "from", "have", "has", "had", "will", "may",
        "can", "do", "does", "did", "not", "while", "when", "any", "all",
    }
)

# Length of the prefix used to treat two words as the same concept.
_STEM_LENGTH = 5

# Fraction of a source warning's stems that must reappear for it to count as
# surviving. Set from the observation that a faithful rewrite of a two-clause
# warning typically preserves the subject and the directive while replacing the
# register, which lands around one half. Below 0.4 the check stops catching
# genuine losses, above 0.5 it starts flagging correct paraphrases.
_WARNING_OVERLAP_THRESHOLD = 0.4


def _stems(text: str) -> set[str]:
    """Reduce a sentence to comparable concept stems.

    Prefix stemming rather than exact word matching, because the rewrite is
    supposed to have rephrased. "alcoholic" and "alcohol" both stem to "alcoh",
    and "medication" and "medicine" both stem to "medic", so a correct
    simplification is recognized as the same warning instead of a lost one.

    This is deliberately cruder than a real stemmer. A linguistic stemmer would
    add a model dependency and a language assumption to a check whose job is to
    be conservative and explainable to a safety officer.
    """
    words = re.findall(r"[a-z]+", text.lower())
    return {
        word[:_STEM_LENGTH]
        for word in words
        if word not in _WARNING_STOPWORDS and len(word) > 2
    }


def _warning_survived(source_warning: str, output_warnings: list[str]) -> bool:
    """Decide whether a source warning is still represented in the output."""
    source_stems = _stems(source_warning)
    if not source_stems:
        return True

    for candidate in output_warnings:
        overlap = source_stems & _stems(candidate)
        if len(overlap) / len(source_stems) >= _WARNING_OVERLAP_THRESHOLD:
            return True
    return False


def compare(
    original_text: str,
    simplified_text: str,
    labels: dict[str, DrugLabel | None] | None = None,
    fda_available: bool = True,
) -> tuple[list[Finding], list[MedicationRecord], list[MedicationRecord], dict[str, int]]:
    """Compare the two documents and return findings plus both medication lists."""
    labels = labels or {}

    source = extract(original_text)
    output = extract(simplified_text)

    canonical = _resolve_aliases(source, output, labels)

    source_groups = {canonical[name]: group for name, group in source.by_name().items()}
    output_groups = {canonical[name]: group for name, group in output.by_name().items()}

    findings: list[Finding] = []

    # ------------------------------------------------------- drugs lost or added

    for key, mentions in source_groups.items():
        if key in output_groups:
            continue
        mention = _best_mention(mentions)
        label = labels.get(mention.name)
        verified = bool(label and label.found)
        findings.append(
            Finding(
                type=FindingType.DRUG_MISSING,
                # A drug the extractor guessed at and openFDA could not confirm
                # is reported, but not as a release blocker.
                severity=Severity.CRITICAL if verified else Severity.WARNING,
                drug_name=mention.name,
                message=(
                    f"'{mention.surface_form}' appears in the source but not in the "
                    f"rewritten instructions."
                ),
                source_value=mention.dose_string or mention.surface_form,
                output_value=None,
                source_context=mention.context,
                fda_verified=verified,
                remediation=(
                    "Add this medication back to the instructions with its dose, "
                    "route, and frequency, or confirm the omission was intended."
                ),
            )
        )

    for key, mentions in output_groups.items():
        if key in source_groups:
            continue
        mention = _best_mention(mentions)
        label = labels.get(mention.name)
        verified = bool(label and label.found)
        findings.append(
            Finding(
                type=FindingType.DRUG_ADDED,
                severity=Severity.CRITICAL if verified else Severity.WARNING,
                drug_name=mention.name,
                message=(
                    f"'{mention.surface_form}' appears in the rewritten instructions "
                    f"but not in the source."
                ),
                source_value=None,
                output_value=mention.dose_string or mention.surface_form,
                output_context=mention.context,
                fda_verified=verified,
                remediation=(
                    "Remove this medication. Nothing may be added to patient "
                    "instructions that a clinician did not write into the source."
                ),
            )
        )

    # ------------------------------------------------ per-drug detail comparison

    for key in source_groups.keys() & output_groups.keys():
        source_mention = _best_mention(source_groups[key])
        output_mention = _best_mention(output_groups[key])
        label = labels.get(source_mention.name) or labels.get(output_mention.name)
        verified = bool(label and label.found)

        findings.extend(
            _compare_dose(source_mention, output_mention, verified)
            + _compare_frequency(source_mention, output_mention, verified)
            + _compare_route(source_mention, output_mention, verified)
            + _compare_duration(source_mention, output_mention, verified)
        )

        # Boxed warnings are the FDA's strongest safety statement. If a drug
        # carries one and the rewrite contains no cautionary language about that
        # drug at all, that is worth a clinician's attention.
        if label and label.has_boxed_warning:
            if not _mentions_caution(simplified_text, output_mention.name):
                findings.append(
                    Finding(
                        type=FindingType.BOXED_WARNING_NOT_CONVEYED,
                        severity=Severity.WARNING,
                        drug_name=output_mention.name,
                        message=(
                            f"{output_mention.surface_form} carries an FDA boxed warning "
                            f"and the rewritten instructions contain no caution about it."
                        ),
                        fda_verified=True,
                        remediation=(
                            "Confirm the discharging clinician intended to omit the "
                            "boxed warning, or add the relevant caution in plain language."
                        ),
                    )
                )

    # --------------------------------------------------------- warning retention

    source_warnings = extract_warnings(original_text)
    output_warnings = extract_warnings(simplified_text)

    lost_warnings = [
        warning for warning in source_warnings if not _warning_survived(warning, output_warnings)
    ]

    if source_warnings:
        retention = 1 - (len(lost_warnings) / len(source_warnings))
        if retention < WARNING_RETENTION_THRESHOLD:
            for warning in lost_warnings[:10]:
                findings.append(
                    Finding(
                        type=FindingType.WARNING_LOST,
                        severity=Severity.CRITICAL,
                        message="A warning or restriction from the source is not in the rewrite.",
                        source_value=warning[:300],
                        source_context=warning,
                        remediation=(
                            "Restore this warning as its own short sentence in the "
                            "rewritten instructions."
                        ),
                    )
                )

    # ------------------------------------------------------- unverified mentions

    if fda_available:
        for candidate in output.unverified_candidates:
            label = labels.get(candidate)
            if label is None or not label.found:
                findings.append(
                    Finding(
                        type=FindingType.DRUG_UNVERIFIED,
                        severity=Severity.INFO,
                        drug_name=candidate,
                        message=(
                            f"'{candidate}' reads like a medication but no matching "
                            f"FDA label was found."
                        ),
                        fda_verified=False,
                        remediation="Confirm the spelling against the medication list.",
                    )
                )

    source_records = [
        _to_record(mention, labels.get(mention.name)) for mention in source.mentions
    ]
    output_records = [
        _to_record(mention, labels.get(mention.name)) for mention in output.mentions
    ]

    counts = {
        "warnings_in_source": len(source_warnings),
        "warnings_in_output": len(output_warnings),
        "drugs_in_source": len(source_groups),
        "drugs_in_output": len(output_groups),
    }

    findings.sort(key=lambda f: (_severity_rank(f.severity), -PENALTIES.get(f.type, 0)))
    return findings, source_records, output_records, counts


# ------------------------------------------------------------- field comparisons


def _compare_dose(
    source: MedicationMention, output: MedicationMention, verified: bool
) -> list[Finding]:
    source_dose = _normalize_dose(source)
    output_dose = _normalize_dose(output)

    if source_dose is None:
        return []

    if output_dose is None:
        return [
            Finding(
                type=FindingType.DOSE_MISSING,
                severity=Severity.CRITICAL if verified else Severity.WARNING,
                drug_name=source.name,
                message=f"The dose for {source.surface_form} is missing from the rewrite.",
                source_value=source.dose_string,
                output_value=None,
                source_context=source.context,
                output_context=output.context,
                fda_verified=verified,
                remediation="Restore the dose exactly as written in the source.",
            )
        ]

    source_value, source_unit = source_dose
    output_value, output_unit = output_dose

    if source_unit != output_unit or abs(source_value - output_value) > 1e-6:
        return [
            Finding(
                type=FindingType.DOSE_CHANGED,
                severity=Severity.CRITICAL,
                drug_name=source.name,
                message=(
                    f"The dose for {source.surface_form} changed from "
                    f"{source.dose_string} to {output.dose_string}."
                ),
                source_value=source.dose_string,
                output_value=output.dose_string,
                source_context=source.context,
                output_context=output.context,
                fda_verified=verified,
                remediation="Restore the source dose. Do not round or convert units.",
            )
        ]
    return []


def _compare_frequency(
    source: MedicationMention, output: MedicationMention, verified: bool
) -> list[Finding]:
    if source.frequency is None:
        return []

    if output.frequency is None:
        return [
            Finding(
                type=FindingType.FREQUENCY_MISSING,
                severity=Severity.CRITICAL if verified else Severity.WARNING,
                drug_name=source.name,
                message=f"How often to take {source.surface_form} is missing from the rewrite.",
                source_value=source.frequency,
                output_value=None,
                source_context=source.context,
                output_context=output.context,
                fda_verified=verified,
                remediation="State the frequency in plain language, for example 'two times a day'.",
            )
        ]

    if source.frequency != output.frequency:
        return [
            Finding(
                type=FindingType.FREQUENCY_CHANGED,
                severity=Severity.CRITICAL,
                drug_name=source.name,
                message=(
                    f"How often to take {source.surface_form} changed from "
                    f"'{source.frequency}' to '{output.frequency}'."
                ),
                source_value=source.frequency,
                output_value=output.frequency,
                source_context=source.context,
                output_context=output.context,
                fda_verified=verified,
                remediation="Restore the source frequency.",
            )
        ]
    return []


def _compare_route(
    source: MedicationMention, output: MedicationMention, verified: bool
) -> list[Finding]:
    if source.route is None:
        return []

    if output.route is None:
        return [
            Finding(
                type=FindingType.ROUTE_MISSING,
                severity=Severity.WARNING,
                drug_name=source.name,
                message=f"How to take {source.surface_form} is not stated in the rewrite.",
                source_value=source.route,
                output_value=None,
                source_context=source.context,
                fda_verified=verified,
                remediation="Add the route in plain language, for example 'by mouth'.",
            )
        ]

    if source.route != output.route:
        return [
            Finding(
                type=FindingType.ROUTE_CHANGED,
                severity=Severity.CRITICAL,
                drug_name=source.name,
                message=(
                    f"The route for {source.surface_form} changed from "
                    f"'{source.route}' to '{output.route}'."
                ),
                source_value=source.route,
                output_value=output.route,
                source_context=source.context,
                output_context=output.context,
                fda_verified=verified,
                remediation="Restore the source route.",
            )
        ]
    return []


def _compare_duration(
    source: MedicationMention, output: MedicationMention, verified: bool
) -> list[Finding]:
    if source.duration is None or output.duration is None:
        return []
    if source.duration != output.duration:
        return [
            Finding(
                type=FindingType.DURATION_CHANGED,
                severity=Severity.CRITICAL,
                drug_name=source.name,
                message=(
                    f"How long to take {source.surface_form} changed from "
                    f"'{source.duration}' to '{output.duration}'."
                ),
                source_value=source.duration,
                output_value=output.duration,
                source_context=source.context,
                output_context=output.context,
                fda_verified=verified,
                remediation="Restore the source duration.",
            )
        ]
    return []


def _mentions_caution(text: str, drug_name: str) -> bool:
    """Whether the output says anything cautionary near a given drug."""
    caution_markers = (
        "do not", "don't", "never", "avoid", "stop", "call", "warning", "danger",
        "risk", "serious", "emergency", "side effect", "watch for", "tell your",
    )
    lowered = text.lower()
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", lowered):
        if drug_name in sentence and any(marker in sentence for marker in caution_markers):
            return True
    return False


def _severity_rank(severity: Severity) -> int:
    return {Severity.CRITICAL: 0, Severity.WARNING: 1, Severity.INFO: 2}[severity]


def safety_score(findings: list[Finding]) -> float:
    """Score from 100 down. Never negative, never a substitute for the gate."""
    score = 100.0
    for finding in findings:
        penalty = PENALTIES.get(finding.type, 5.0)
        if finding.severity is Severity.WARNING:
            penalty *= 0.5
        elif finding.severity is Severity.INFO:
            penalty *= 0.2
        score -= penalty
    return round(max(0.0, score), 1)


def passed(findings: list[Finding]) -> bool:
    """One critical finding fails the document. The score does not override this."""
    return not any(finding.severity is Severity.CRITICAL for finding in findings)
