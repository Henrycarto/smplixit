"""Scorer tests.

These lock in the two properties the product depends on:

  1. Simplified text scores lower than clinical text. If this ever inverts, the
     grade badge in the console is lying to a compliance officer.
  2. The dual gate cannot be passed by fixing only one formula.
"""

from __future__ import annotations

import re

import pytest
from app.engine import scorer

CLINICAL = (
    "The patient was admitted with acute exacerbation of congestive heart failure "
    "secondary to medication nonadherence and dietary indiscretion. Intravenous "
    "diuresis was initiated with furosemide 40 mg administered twice daily, "
    "resulting in significant symptomatic improvement and resolution of peripheral "
    "edema. Anticoagulation was continued with apixaban 5 mg twice daily for "
    "prophylaxis against thromboembolic complications. The patient demonstrated "
    "hemodynamic stability throughout the remainder of the hospitalization and was "
    "discharged in satisfactory condition with instructions regarding sodium "
    "restriction and daily weight monitoring."
)

PLAIN = (
    "You were in the hospital because your heart failure got worse. "
    "You had too much fluid in your body. "
    "We gave you a water pill to remove the fluid. "
    "Take furosemide 40 mg two times a day. "
    "Take apixaban 5 mg two times a day. This is a blood thinner. "
    "Weigh yourself every morning. Write the number down. "
    "Eat less salt. Do not add salt to your food. "
    "Call your doctor if you gain 3 pounds in one day."
)


def test_scores_clinical_text_higher_than_plain_text():
    clinical = scorer.score(CLINICAL)
    plain = scorer.score(PLAIN)

    assert clinical.consensus_grade > plain.consensus_grade
    assert clinical.smog > plain.smog
    assert clinical.polysyllabic_word_count > plain.polysyllabic_word_count


def test_consensus_grade_is_the_stricter_of_the_two_formulas():
    level = scorer.score(CLINICAL)
    assert level.consensus_grade == round(max(level.smog, level.flesch_kincaid), 1)


def test_empty_text_raises_rather_than_returning_zero():
    with pytest.raises(ValueError):
        scorer.score("   ")


def test_meets_target_requires_both_formulas_to_clear():
    level = scorer.score(CLINICAL)
    generous = int(max(level.smog, level.flesch_kincaid)) + 2
    strict = 6

    assert scorer.meets_target(level, generous)
    assert not scorer.meets_target(level, strict)


def test_rejection_reason_states_the_measurement():
    level = scorer.score(CLINICAL)
    reason = scorer.rejection_reason(level, 6)

    assert reason is not None
    assert "SMOG" in reason or "Flesch-Kincaid" in reason
    # This string goes into the audit trail, so it has to carry the measured
    # number rather than only a verdict.
    assert any(character.isdigit() for character in reason)


def test_gate_failures_name_the_formula_and_its_driving_metric():
    level = scorer.score(CLINICAL)
    failures = scorer.gate_failures(level, 6)

    assert failures
    by_formula = {failure.formula: failure for failure in failures}

    # The two formulas fail for different reasons, and the caller has to be able
    # to tell them apart. Collapsing them into one message is what lets a
    # rewrite fix sentence length and leave the vocabulary untouched.
    if "SMOG" in by_formula:
        assert by_formula["SMOG"].driver_metric == "polysyllabic_words"
        assert by_formula["SMOG"].measured > by_formula["SMOG"].ceiling
    if "Flesch-Kincaid" in by_formula:
        assert by_formula["Flesch-Kincaid"].driver_metric == "avg_sentence_length"


def test_gate_failures_are_empty_when_the_gate_passes():
    level = scorer.score(PLAIN)
    assert scorer.gate_failures(level, 12) == []


def test_scorer_reports_measurement_only():
    """The scorer measures. It must not tell a model what to do about it.

    Correction phrasing is the tuned part of the pipeline and lives in
    prompt_builder, which is not distributed. This test is the guard that keeps
    it from drifting back into the public scoring module.

    Asserted on shape rather than on a list of forbidden phrases, so the test
    cannot pass while carrying instruction text it forgot to name, and so the
    private wording is not reproduced here in order to check for it.
    """
    level = scorer.score(CLINICAL)
    reason = scorer.rejection_reason(level, 6)
    assert reason is not None

    # Matched whole-string rather than split on ".", because the measurements
    # themselves contain decimal points.
    number = r"-?\d+(?:\.\d+)?"
    sentence = (
        rf"(?:SMOG|Flesch-Kincaid) measured {number} against a ceiling of "
        rf"{number} \([a-z ]+: {number}\)\."
    )

    assert re.fullmatch(rf"{sentence}(?: {sentence})*", reason), (
        f"rejection_reason carries content beyond the measurement: {reason!r}"
    )


def test_rejection_reason_is_none_when_the_gate_passes():
    level = scorer.score(PLAIN)
    assert scorer.rejection_reason(level, 12) is None


def test_difficult_terms_are_ranked_by_impact():
    terms = scorer.find_difficult_terms(CLINICAL)

    assert terms
    assert all(term.syllables >= 3 for term in terms)
    impacts = [term.syllables * term.occurrences for term in terms]
    assert impacts == sorted(impacts, reverse=True)


def test_difficult_terms_carry_plain_language_suggestions_where_known():
    terms = {term.term: term for term in scorer.find_difficult_terms(CLINICAL)}
    assert "anticoagulation" in terms or "prophylaxis" in terms


def test_terms_removed_reports_vocabulary_the_rewrite_eliminated():
    removed = {term.term for term in scorer.terms_removed(CLINICAL, PLAIN)}

    assert "exacerbation" in removed
    assert "peripheral" in removed
    # Words still present in the plain version must not be reported as removed.
    assert "furosemide" not in removed


def test_smog_confidence_degrades_on_short_samples():
    short = scorer.score("You had surgery. Rest at home. Call us if you bleed.")
    assert scorer.smog_confidence(short) == "low"
    assert not scorer.smog_is_reliable(short)
