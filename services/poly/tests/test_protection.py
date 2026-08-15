"""Terminology preservation tests.

The whole safety argument for Poly rests on one claim: a dose that goes into the
translator comes out unchanged. These tests are the evidence for that claim.
"""

from __future__ import annotations

from app.engine import language_registry
from app.engine.deepl_client import PROTECT_TAG, protect, unprotect, verify_preservation

INSTRUCTIONS = (
    "Take furosemide 40 mg two times a day.\n"
    "Take apixaban 5 mg two times a day.\n"
    "Call the clinic at 555-867-5309 if you gain 3 pounds in one day.\n"
    "Your follow-up appointment is on 03/14/2026 at 9:30 AM.\n"
    "Check your temperature. Call us if it is over 100.4 F."
)

DRUGS = ["furosemide", "apixaban"]


def test_doses_are_protected_as_single_units():
    result = protect(INSTRUCTIONS, DRUGS)
    assert "40 mg" in result.protected_terms
    assert "5 mg" in result.protected_terms


def test_drug_names_are_protected():
    result = protect(INSTRUCTIONS, DRUGS)
    assert "furosemide" in result.protected_terms
    assert "apixaban" in result.protected_terms


def test_phone_date_time_and_temperature_are_protected():
    protected = protect(INSTRUCTIONS, DRUGS).protected_terms
    assert any("555" in term for term in protected)
    assert "03/14/2026" in protected
    assert any("9:30" in term for term in protected)
    assert any("100.4" in term for term in protected)


def test_protection_tags_are_never_nested():
    """DeepL rejects nested ignore tags, so a dose inside a drug span must not
    pick up a second wrapper."""
    tagged = protect(INSTRUCTIONS, DRUGS).text
    depth = 0
    for token in tagged.split("<"):
        if token.startswith(f"{PROTECT_TAG}>"):
            depth += 1
            assert depth <= 1
        elif token.startswith(f"/{PROTECT_TAG}>"):
            depth -= 1
    assert depth == 0


def test_unprotect_restores_the_original_text_exactly():
    tagged = protect(INSTRUCTIONS, DRUGS).text
    assert unprotect(tagged) == INSTRUCTIONS


def test_free_text_is_left_translatable():
    """Only the clinically load-bearing tokens are frozen. Instruction prose
    must remain outside the tags or nothing gets translated."""
    tagged = protect(INSTRUCTIONS, DRUGS).text
    assert f"<{PROTECT_TAG}>Take</{PROTECT_TAG}>" not in tagged
    assert f"<{PROTECT_TAG}>two times a day</{PROTECT_TAG}>" not in tagged
    assert "Take " in tagged


def test_longer_drug_names_win_over_their_substrings():
    text = "Inject insulin glargine 10 units at bedtime. Insulin is a hormone."
    result = protect(text, ["insulin glargine", "insulin"])
    assert "insulin glargine" in result.protected_terms


def test_verify_preservation_reports_terms_that_vanished():
    lost = verify_preservation("Tome 40 mg dos veces al dia.", ["furosemide", "40 mg"])
    assert lost == ["furosemide"]


def test_verify_preservation_is_empty_when_everything_survived():
    assert verify_preservation("Tome furosemide 40 mg.", ["furosemide", "40 mg"]) == []


# ------------------------------------------------------------------- registry


def test_registry_covers_at_least_fifty_languages():
    counts = language_registry.counts()
    assert counts["total"] >= 50
    assert counts["machine_translated"] + counts["requires_human_review"] == counts["total"]


def test_tier_two_languages_have_no_machine_target():
    for language in language_registry.all_languages():
        if language.tier is language_registry.Tier.REVIEW_REQUIRED:
            assert language.deepl_code is None
        else:
            assert language.deepl_code is not None


def test_aliases_resolve():
    assert language_registry.normalize("ZH") == "zh-hans"
    assert language_registry.normalize("pt") == "pt-br"
    assert language_registry.normalize("en_US") == "en-us"
    assert language_registry.get("fil") is not None


def test_rtl_languages_are_flagged():
    arabic = language_registry.get("ar")
    assert arabic is not None and arabic.rtl
    spanish = language_registry.get("es")
    assert spanish is not None and not spanish.rtl


def test_unknown_language_is_not_supported():
    assert not language_registry.is_supported("xx-yy")
    assert language_registry.get("xx-yy") is None
