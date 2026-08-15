"""Guard tests.

Guard's entire value proposition is that it catches the failure modes below.
Each test names a specific way a rewrite can hurt a patient.
"""

from __future__ import annotations

from app.engine import diff_checker
from app.engine.drug_extractor import extract, extract_warnings
from app.engine.fda_client import DrugLabel
from app.schemas import FindingType, Severity

SOURCE = (
    "DISCHARGE MEDICATIONS:\n"
    "Furosemide 40 mg PO BID for 14 days.\n"
    "Apixaban 5 mg PO BID.\n"
    "Metoprolol succinate 25 mg PO daily.\n"
    "Atorvastatin 40 mg PO at bedtime.\n"
    "Do not take ibuprofen while on apixaban.\n"
    "Call your doctor if you gain more than 3 pounds in one day.\n"
    "Do not drive until cleared at your follow-up visit."
)

GOOD_REWRITE = (
    "YOUR MEDICINES:\n"
    "Furosemide 40 mg by mouth two times a day for 14 days. This is a water pill.\n"
    "Apixaban 5 mg by mouth two times a day. This is a blood thinner.\n"
    "Metoprolol succinate 25 mg by mouth once daily. This slows your heart rate.\n"
    "Atorvastatin 40 mg by mouth at bedtime. This lowers your cholesterol.\n"
    "Do not take ibuprofen while you are on apixaban.\n"
    "Call your doctor if you gain more than 3 pounds in one day.\n"
    "Do not drive until your doctor says it is safe at your follow-up visit."
)


def _labels(*names: str) -> dict[str, DrugLabel | None]:
    """Stand-in for openFDA so the comparison logic is tested without network."""
    return {
        name: DrugLabel(query_name=name, generic_names=[name], found=True) for name in names
    }


ALL_DRUGS = _labels(
    "furosemide", "apixaban", "metoprolol", "atorvastatin", "ibuprofen"
)


# ------------------------------------------------------------------ extraction


def test_extracts_every_medication_from_the_source():
    names = extract(SOURCE).names
    for drug in ("furosemide", "apixaban", "metoprolol", "atorvastatin", "ibuprofen"):
        assert drug in names


def test_extracts_dose_route_and_frequency_from_clinical_shorthand():
    mentions = {m.name: m for m in extract("Furosemide 40 mg PO BID.").mentions}
    furosemide = mentions["furosemide"]

    assert furosemide.dose_string == "40 mg"
    assert furosemide.route == "oral"
    assert furosemide.frequency == "twice daily"


def test_normalizes_shorthand_and_plain_language_to_the_same_structure():
    """This is the property the whole comparison rests on. 'PO BID' and
    'by mouth two times a day' are the same instruction."""
    clinical = extract("Furosemide 40 mg PO BID.").mentions[0]
    plain = extract("Take furosemide 40 mg by mouth two times a day.").mentions[0]

    assert clinical.name == plain.name
    assert clinical.dose_string == plain.dose_string
    assert clinical.route == plain.route
    assert clinical.frequency == plain.frequency
    assert clinical.signature() == plain.signature()


def test_morphology_catches_drugs_outside_the_lexicon():
    """A drug the lexicon has never seen still gets caught by its generic stem."""
    mentions = extract("Take zafirlukastopril 10 mg by mouth once daily.").mentions
    assert any(m.name == "zafirlukastopril" and m.detection == "morphology" for m in mentions)


def test_context_strategy_catches_an_unknown_token_carrying_a_dose():
    mentions = extract("Take Xyzzynol 250 mg by mouth two times a day.").mentions
    found = [m for m in mentions if m.name == "xyzzynol"]
    assert found and found[0].detection == "context"
    assert found[0].dose_string == "250 mg"


def test_context_strategy_does_not_treat_ordinary_words_as_drugs():
    """'gain 3 pounds' and 'drink 8 cups' must not become medications."""
    names = extract(
        "Call your doctor if you gain 3 pounds in one day. Drink less than 2 l of fluid."
    ).names
    assert "gain" not in names
    assert "than" not in names
    assert "drink" not in names


def test_one_medication_per_line_does_not_cross_contaminate_doses():
    """Newline splitting matters. Without it, line two's dose leaks onto line one."""
    text = "Furosemide 40 mg daily\nApixaban 5 mg two times a day"
    mentions = {m.name: m for m in extract(text).mentions}
    assert mentions["furosemide"].dose_string == "40 mg"
    assert mentions["apixaban"].dose_string == "5 mg"


def test_extracts_warnings_and_stop_conditions():
    warnings = extract_warnings(SOURCE)
    assert any("do not take ibuprofen" in w.lower() for w in warnings)
    assert any("do not drive" in w.lower() for w in warnings)
    assert any("call your doctor" in w.lower() for w in warnings)


# ------------------------------------------------------------------ comparison


def test_a_faithful_rewrite_passes_with_no_critical_findings():
    findings, _, _, _ = diff_checker.compare(SOURCE, GOOD_REWRITE, labels=ALL_DRUGS)
    critical = [f for f in findings if f.severity is Severity.CRITICAL]

    assert critical == [], f"unexpected critical findings: {[f.message for f in critical]}"
    assert diff_checker.passed(findings)
    assert diff_checker.safety_score(findings) >= 90


def test_a_dropped_medication_is_critical():
    rewrite = GOOD_REWRITE.replace(
        "Metoprolol succinate 25 mg by mouth once daily. This slows your heart rate.\n", ""
    )
    findings, _, _, _ = diff_checker.compare(SOURCE, rewrite, labels=ALL_DRUGS)

    missing = [f for f in findings if f.type is FindingType.DRUG_MISSING]
    assert missing
    assert missing[0].drug_name == "metoprolol"
    assert missing[0].severity is Severity.CRITICAL
    assert not diff_checker.passed(findings)


def test_a_drug_named_only_in_a_warning_still_counts_as_present():
    """Dropping apixaban's dosing line while keeping "do not take ibuprofen
    while you are on apixaban" is a dosing failure, not a missing drug. The
    dose and frequency checks are what catch it, and they must not be masked by
    a spurious drug_missing finding."""
    rewrite = GOOD_REWRITE.replace(
        "Apixaban 5 mg by mouth two times a day. This is a blood thinner.\n", ""
    )
    findings, _, _, _ = diff_checker.compare(SOURCE, rewrite, labels=ALL_DRUGS)

    assert not [
        f for f in findings if f.type is FindingType.DRUG_MISSING and f.drug_name == "apixaban"
    ]
    dose_lost = [
        f
        for f in findings
        if f.drug_name == "apixaban"
        and f.type in (FindingType.DOSE_MISSING, FindingType.FREQUENCY_MISSING)
    ]
    assert dose_lost
    assert not diff_checker.passed(findings)


def test_a_changed_dose_is_critical_and_reports_both_values():
    rewrite = GOOD_REWRITE.replace("Furosemide 40 mg", "Furosemide 4 mg")
    findings, _, _, _ = diff_checker.compare(SOURCE, rewrite, labels=ALL_DRUGS)

    changed = [f for f in findings if f.type is FindingType.DOSE_CHANGED]
    assert changed
    assert changed[0].source_value == "40 mg"
    assert changed[0].output_value == "4 mg"
    assert changed[0].severity is Severity.CRITICAL
    assert not diff_checker.passed(findings)


def test_a_changed_frequency_is_critical():
    rewrite = GOOD_REWRITE.replace(
        "Apixaban 5 mg by mouth two times a day", "Apixaban 5 mg by mouth once daily"
    )
    findings, _, _, _ = diff_checker.compare(SOURCE, rewrite, labels=ALL_DRUGS)

    changed = [f for f in findings if f.type is FindingType.FREQUENCY_CHANGED]
    assert changed
    assert changed[0].source_value == "twice daily"
    assert changed[0].output_value == "once daily"
    assert not diff_checker.passed(findings)


def test_a_medication_invented_by_the_rewrite_is_critical():
    rewrite = GOOD_REWRITE + "\nTake aspirin 81 mg by mouth once daily."
    findings, _, _, _ = diff_checker.compare(
        SOURCE, rewrite, labels={**ALL_DRUGS, **_labels("aspirin")}
    )

    added = [f for f in findings if f.type is FindingType.DRUG_ADDED]
    assert added
    assert added[0].drug_name == "aspirin"
    assert not diff_checker.passed(findings)


def test_a_changed_route_is_critical():
    source = "Give enoxaparin 40 mg subcutaneous once daily."
    rewrite = "Take enoxaparin 40 mg by mouth once daily."
    findings, _, _, _ = diff_checker.compare(source, rewrite, labels=_labels("enoxaparin"))

    changed = [f for f in findings if f.type is FindingType.ROUTE_CHANGED]
    assert changed
    assert changed[0].source_value == "subcutaneous"
    assert changed[0].output_value == "oral"
    assert not diff_checker.passed(findings)


def test_unit_conversion_is_treated_as_equivalent_not_as_a_change():
    """1 g and 1000 mg are the same dose. Flagging that would be noise."""
    source = "Take acetaminophen 1 g by mouth every 6 hours."
    rewrite = "Take acetaminophen 1000 mg by mouth every 6 hours."
    findings, _, _, _ = diff_checker.compare(source, rewrite, labels=_labels("acetaminophen"))

    assert not [f for f in findings if f.type is FindingType.DOSE_CHANGED]


def test_a_brand_to_generic_swap_is_not_reported_as_a_lost_drug():
    """Coumadin becoming warfarin is a correct simplification, not a drug loss."""
    source = "Take Coumadin 5 mg by mouth once daily."
    rewrite = "Take warfarin 5 mg by mouth once daily. Coumadin is the brand name."
    labels = {
        "coumadin": DrugLabel(
            query_name="coumadin",
            generic_names=["warfarin"],
            brand_names=["coumadin"],
            found=True,
        ),
        "warfarin": DrugLabel(
            query_name="warfarin",
            generic_names=["warfarin"],
            brand_names=["coumadin"],
            found=True,
        ),
    }
    findings, _, _, _ = diff_checker.compare(source, rewrite, labels=labels)

    assert not [f for f in findings if f.type is FindingType.DRUG_MISSING]
    assert not [f for f in findings if f.type is FindingType.DRUG_ADDED]


def test_a_lost_warning_is_critical():
    rewrite = (
        "YOUR MEDICINES:\n"
        "Furosemide 40 mg by mouth two times a day for 14 days.\n"
        "Apixaban 5 mg by mouth two times a day.\n"
        "Metoprolol succinate 25 mg by mouth once daily.\n"
        "Atorvastatin 40 mg by mouth at bedtime.\n"
        "Take ibuprofen for pain."
    )
    findings, _, _, _ = diff_checker.compare(SOURCE, rewrite, labels=ALL_DRUGS)

    lost = [f for f in findings if f.type is FindingType.WARNING_LOST]
    assert lost
    assert lost[0].severity is Severity.CRITICAL
    assert not diff_checker.passed(findings)


def test_a_rephrased_warning_counts_as_surviving():
    """The rewrite is supposed to rephrase. Content overlap, not string match."""
    source = "Do not consume alcoholic beverages while taking this medication."
    rewrite = "Do not drink alcohol while you take this medicine."
    findings, _, _, _ = diff_checker.compare(source, rewrite)

    assert not [f for f in findings if f.type is FindingType.WARNING_LOST]


def test_findings_are_downgraded_when_the_drug_cannot_be_verified():
    """Without an FDA match, a missing drug is a warning, not a release blocker.
    Guard does not raise its own confidence on an unverifiable guess."""
    source = "Take Xyzzynol 250 mg by mouth two times a day."
    rewrite = "Take your medicine as directed."
    findings, _, _, _ = diff_checker.compare(source, rewrite, labels={})

    missing = [f for f in findings if f.type is FindingType.DRUG_MISSING]
    assert missing
    assert missing[0].severity is Severity.WARNING
    assert diff_checker.passed(findings)


def test_a_boxed_warning_with_no_caution_in_the_rewrite_raises_a_warning():
    source = "Take warfarin 5 mg by mouth once daily. Watch for unusual bleeding."
    rewrite = "Take warfarin 5 mg by mouth once daily."
    labels = {
        "warfarin": DrugLabel(
            query_name="warfarin",
            generic_names=["warfarin"],
            boxed_warning="WARNING: BLEEDING RISK",
            found=True,
        )
    }
    findings, _, _, _ = diff_checker.compare(source, rewrite, labels=labels)

    boxed = [f for f in findings if f.type is FindingType.BOXED_WARNING_NOT_CONVEYED]
    assert boxed
    assert boxed[0].severity is Severity.WARNING


# ---------------------------------------------------------------------- scoring


def test_score_falls_as_findings_accumulate():
    clean, _, _, _ = diff_checker.compare(SOURCE, GOOD_REWRITE, labels=ALL_DRUGS)
    broken, _, _, _ = diff_checker.compare(
        SOURCE, GOOD_REWRITE.replace("Furosemide 40 mg", "Furosemide 4 mg"), labels=ALL_DRUGS
    )

    assert diff_checker.safety_score(clean) > diff_checker.safety_score(broken)


def test_score_never_goes_negative():
    findings, _, _, _ = diff_checker.compare(SOURCE, "Take your medicine.", labels=ALL_DRUGS)
    assert diff_checker.safety_score(findings) >= 0.0


def test_a_high_score_does_not_override_a_critical_finding():
    """The gate is the critical count, not the number. A document at 94 with one
    critical finding is held."""
    source = "Give enoxaparin 40 mg subcutaneous once daily."
    rewrite = "Take enoxaparin 40 mg by mouth once daily."
    findings, _, _, _ = diff_checker.compare(source, rewrite, labels=_labels("enoxaparin"))

    assert diff_checker.safety_score(findings) > 70
    assert not diff_checker.passed(findings)


def test_findings_are_ordered_critical_first():
    rewrite = GOOD_REWRITE.replace("Furosemide 40 mg", "Furosemide 4 mg")
    findings, _, _, _ = diff_checker.compare(SOURCE, rewrite, labels=ALL_DRUGS)

    ranks = [
        {Severity.CRITICAL: 0, Severity.WARNING: 1, Severity.INFO: 2}[f.severity]
        for f in findings
    ]
    assert ranks == sorted(ranks)


def test_comparison_reports_medication_counts_for_both_sides():
    _, source_records, output_records, counts = diff_checker.compare(
        SOURCE, GOOD_REWRITE, labels=ALL_DRUGS
    )

    assert counts["drugs_in_source"] >= 4
    assert counts["drugs_in_output"] >= 4
    assert source_records and output_records
    assert all(record.fda_verified for record in source_records if record.name in ALL_DRUGS)
