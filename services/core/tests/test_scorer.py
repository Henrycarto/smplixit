"""Scorer tests.

These lock in the two properties the product depends on:

  1. Simplified text scores lower than clinical text. If this ever inverts, the
     grade badge in the console is lying to a compliance officer.
  2. The dual gate cannot be passed by fixing only one formula.
"""

from __future__ import annotations

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


def test_rejection_reason_is_actionable_and_names_the_failing_formula():
    level = scorer.score(CLINICAL)
    reason = scorer.rejection_reason(level, 6)

    assert reason is not None
    assert "SMOG" in reason or "Flesch-Kincaid" in reason
    # The reason is fed straight into the next prompt, so it has to carry the
    # measured number, not just a verdict.
    assert any(character.isdigit() for character in reason)


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
