"""Medication extraction from clinical and plain-language text.

The extractor has to work on both sides of a rewrite, which is harder than it
sounds. The source says:

    "Furosemide 40 mg PO BID"

The rewrite says:

    "Take furosemide 40 mg by mouth two times a day"

Those are the same instruction. A naive string diff reports the whole line as
changed. This module normalizes both into a comparable structure: name, dose,
unit, route, frequency.

Three detection strategies run together, because no single one is sufficient:

  1. LEXICON     a curated list of common generics and brands. Precise, but it
                 cannot know about a drug approved last month.

  2. MORPHOLOGY  generic stems the FDA assigns by drug class. Everything ending
                 in -pril is an ACE inhibitor, everything in -statin is a
                 statin. This catches drugs the lexicon has never seen.

  3. CONTEXT     any token immediately followed by a dose pattern is a candidate.
                 "Xyzzytol 40 mg" is a drug even if nothing else recognizes it.

Candidates from strategies 2 and 3 are verified against openFDA before they are
allowed to raise a finding. Strategy 1 hits are trusted directly. That keeps the
false positive rate low enough that clinicians do not learn to ignore the panel,
which is the failure mode that kills every clinical alerting system.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ---------------------------------------------------------------- vocabulary

# FDA generic stems. Each implies a drug class, so a token carrying one is a
# medication with high probability regardless of whether we have seen it before.
GENERIC_STEMS: tuple[str, ...] = (
    "afil",      # PDE5 inhibitors
    "arin",      # heparins
    "azepam",    # benzodiazepines
    "azole",     # antifungals
    "barbital",  # barbiturates
    "caine",     # local anesthetics
    "cillin",    # penicillins
    "cycline",   # tetracyclines
    "dipine",    # calcium channel blockers
    "dronate",   # bisphosphonates
    "floxacin",  # fluoroquinolones
    "gliptin",   # DPP-4 inhibitors
    "glitazone", # thiazolidinediones
    "iramine",   # antihistamines
    "mab",       # monoclonal antibodies
    "micin",     # aminoglycosides
    "mycin",     # macrolides
    "nacin",     # muscarinic antagonists
    "olol",      # beta blockers
    "oxacin",    # quinolones
    "parin",     # low molecular weight heparins
    "prazole",   # proton pump inhibitors
    "pril",      # ACE inhibitors
    "profen",    # NSAIDs
    "sartan",    # angiotensin receptor blockers
    "semide",    # loop diuretics
    "setron",    # antiemetics
    "statin",    # HMG-CoA reductase inhibitors
    "terol",     # beta-2 agonists
    "thiazide",  # thiazide diuretics
    "tidine",    # H2 blockers
    "triptan",   # migraine agents
    "vastatin",  # statins
    "vir",       # antivirals
    "xaban",     # factor Xa inhibitors
    "zosin",     # alpha blockers
)

# High-frequency medications in discharge instructions. Not exhaustive by
# design: this is the precision layer, openFDA is the recall layer.
COMMON_MEDICATIONS: frozenset[str] = frozenset(
    {
        "acetaminophen", "tylenol", "paracetamol",
        "ibuprofen", "advil", "motrin",
        "naproxen", "aleve",
        "aspirin",
        "warfarin", "coumadin",
        "apixaban", "eliquis",
        "rivaroxaban", "xarelto",
        "clopidogrel", "plavix",
        "heparin", "enoxaparin", "lovenox",
        "metformin", "glucophage",
        "insulin", "lantus", "humalog", "novolog", "levemir", "tresiba",
        "glipizide", "glyburide",
        "lisinopril", "enalapril", "ramipril",
        "losartan", "valsartan",
        "amlodipine", "nifedipine", "diltiazem",
        "metoprolol", "atenolol", "carvedilol", "propranolol",
        "furosemide", "lasix", "bumetanide", "torsemide",
        "hydrochlorothiazide", "spironolactone",
        "atorvastatin", "lipitor", "simvastatin", "zocor", "rosuvastatin", "crestor",
        "levothyroxine", "synthroid",
        "omeprazole", "prilosec", "pantoprazole", "protonix", "famotidine", "pepcid",
        "amoxicillin", "augmentin", "azithromycin", "zithromax",
        "cephalexin", "keflex", "ciprofloxacin", "cipro", "levofloxacin", "levaquin",
        "doxycycline", "clindamycin", "metronidazole", "flagyl",
        "nitrofurantoin", "macrobid", "trimethoprim", "sulfamethoxazole", "bactrim",
        "prednisone", "prednisolone", "methylprednisolone", "dexamethasone",
        "albuterol", "ventolin", "proair", "fluticasone", "flovent",
        "montelukast", "singulair", "tiotropium", "spiriva",
        "gabapentin", "neurontin", "pregabalin", "lyrica",
        "sertraline", "zoloft", "fluoxetine", "prozac", "escitalopram", "lexapro",
        "citalopram", "celexa", "bupropion", "wellbutrin", "trazodone",
        "duloxetine", "cymbalta", "venlafaxine", "effexor",
        "alprazolam", "xanax", "lorazepam", "ativan", "clonazepam", "klonopin",
        "zolpidem", "ambien",
        "oxycodone", "percocet", "hydrocodone", "norco", "vicodin",
        "morphine", "tramadol", "ultram", "hydromorphone", "dilaudid",
        "ondansetron", "zofran", "promethazine", "phenergan",
        "amiodarone", "digoxin",
        "allopurinol", "colchicine",
        "tamsulosin", "flomax", "finasteride",
        "alendronate", "fosamax",
        "levetiracetam", "keppra", "phenytoin", "dilantin", "lamotrigine", "lamictal",
        "nitroglycerin", "isosorbide",
        "potassium", "magnesium", "calcium", "ferrous",
        "docusate", "senna", "polyethylene",
    }
)

# Route markers. Left side is what appears in text, right side is normalized.
ROUTE_TERMS: dict[str, str] = {
    "po": "oral",
    "by mouth": "oral",
    "orally": "oral",
    "oral": "oral",
    "sublingual": "sublingual",
    "under the tongue": "sublingual",
    "sl": "sublingual",
    "iv": "intravenous",
    "intravenous": "intravenous",
    "into a vein": "intravenous",
    "im": "intramuscular",
    "intramuscular": "intramuscular",
    "into the muscle": "intramuscular",
    "subcutaneous": "subcutaneous",
    "subcutaneously": "subcutaneous",
    "sq": "subcutaneous",
    "subq": "subcutaneous",
    "under the skin": "subcutaneous",
    "topical": "topical",
    "topically": "topical",
    "on the skin": "topical",
    "inhaled": "inhaled",
    "inhalation": "inhaled",
    "by inhaler": "inhaled",
    "rectal": "rectal",
    "rectally": "rectal",
    "pr": "rectal",
    "ophthalmic": "ophthalmic",
    "in the eye": "ophthalmic",
    "in your eye": "ophthalmic",
    "otic": "otic",
    "in the ear": "otic",
    "in your ear": "otic",
    "nasal": "nasal",
    "in the nose": "nasal",
    "transdermal": "transdermal",
    "patch": "transdermal",
}

# Frequency markers, clinical shorthand and plain language, both normalized to
# doses per day. This is what makes "BID" and "two times a day" comparable.
FREQUENCY_TERMS: dict[str, tuple[str, float | None]] = {
    "qd": ("once daily", 1),
    "daily": ("once daily", 1),
    "once daily": ("once daily", 1),
    "once a day": ("once daily", 1),
    "one time a day": ("once daily", 1),
    "every day": ("once daily", 1),
    "every morning": ("once daily", 1),
    "qam": ("once daily", 1),
    "at bedtime": ("once daily", 1),
    "qhs": ("once daily", 1),
    "nightly": ("once daily", 1),
    "every night": ("once daily", 1),
    "bid": ("twice daily", 2),
    "twice daily": ("twice daily", 2),
    "twice a day": ("twice daily", 2),
    "two times a day": ("twice daily", 2),
    "every 12 hours": ("twice daily", 2),
    "tid": ("three times daily", 3),
    "three times a day": ("three times daily", 3),
    "three times daily": ("three times daily", 3),
    "every 8 hours": ("three times daily", 3),
    "qid": ("four times daily", 4),
    "four times a day": ("four times daily", 4),
    "four times daily": ("four times daily", 4),
    "every 6 hours": ("four times daily", 4),
    "every 4 hours": ("every 4 hours", 6),
    "every other day": ("every other day", 0.5),
    "weekly": ("weekly", 0.143),
    "once a week": ("weekly", 0.143),
    "prn": ("as needed", None),
    "as needed": ("as needed", None),
    "when needed": ("as needed", None),
}

# Ordinary English words that collide with an FDA generic stem. Without this,
# "This lowers your cholesterol" reports cholesterol as a medication the rewrite
# invented, because it ends in -terol like albuterol and salmeterol. One false
# critical finding on a correct rewrite is enough to make a clinician stop
# reading the panel, so collisions get an explicit deny list rather than a
# tolerance threshold.
STEM_COLLISIONS: frozenset[str] = frozenset(
    {
        "cholesterol",
        "sterol",
        "mandarin",
        "margarin",
        "margarine",
        "cabin",
        "captain",
        "certain",
        "curtain",
        "fountain",
        "mountain",
        "souvenir",
        "elixir",
        "reservoir",
        "behavior",
        "senior",
        "junior",
        "warrior",
        "interior",
        "exterior",
        "superior",
        "inferior",
        "prior",
        "savior",
    }
)

DOSE_UNITS: tuple[str, ...] = (
    "mg", "mcg", "g", "kg", "ml", "l", "iu", "unit", "units",
    "tablet", "tablets", "capsule", "capsules", "puff", "puffs",
    "drop", "drops", "meq", "mmol", "patch", "patches", "spray", "sprays",
)

# ------------------------------------------------------------------ patterns

# Longest unit first, so "units" is matched before "unit" and "ml" before "l".
_UNIT_ALTERNATION = "|".join(sorted(DOSE_UNITS, key=len, reverse=True))

_DOSE_RE = re.compile(
    rf"(?P<value>\d+(?:[.,]\d+)?)\s*(?P<unit>{_UNIT_ALTERNATION})\b",
    re.IGNORECASE,
)

_WORD_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9'-]{3,}\b")

# A token directly followed by a dose is a drug candidate regardless of lexicon.
_CONTEXT_RE = re.compile(
    rf"\b(?P<name>[A-Za-z][A-Za-z0-9'-]{{3,}})\s+(?P<value>\d+(?:[.,]\d+)?)\s*"
    rf"(?P<unit>{_UNIT_ALTERNATION})\b",
    re.IGNORECASE,
)

# Words that sit next to a dose but are not drugs.
_CONTEXT_STOPWORDS: frozenset[str] = frozenset(
    {
        "take", "taking", "took", "give", "given", "giving", "inject", "injecting",
        "apply", "applying", "use", "using", "swallow", "chew", "dose", "doses",
        "dosage", "total", "about", "approximately", "than", "over", "under",
        "with", "and", "the", "your", "this", "that", "each", "every", "another",
        "additional", "extra", "half", "whole", "weight", "weigh", "gained",
        "gain", "lose", "lost", "limit", "less", "more", "least", "most", "only",
        "drink", "eat", "salt", "sodium", "water", "fluid", "fluids", "day",
        "days", "week", "weeks", "hour", "hours", "time", "times", "one", "two",
        "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    }
)


@dataclass
class MedicationMention:
    """One medication as it appears in one document."""

    name: str                     # normalized lowercase
    surface_form: str             # exactly as written
    dose_value: float | None = None
    dose_unit: str | None = None
    route: str | None = None
    frequency: str | None = None
    frequency_per_day: float | None = None
    duration: str | None = None
    context: str = ""             # the sentence it was found in
    detection: str = "lexicon"    # lexicon | morphology | context
    verified: bool = False        # confirmed against openFDA

    @property
    def dose_string(self) -> str | None:
        if self.dose_value is None or self.dose_unit is None:
            return None
        value = int(self.dose_value) if self.dose_value.is_integer() else self.dose_value
        return f"{value} {self.dose_unit}"

    def signature(self) -> str:
        """Comparison key. Deliberately excludes surface form and context."""
        return "|".join(
            [
                self.name,
                self.dose_string or "no-dose",
                self.route or "no-route",
                self.frequency or "no-frequency",
            ]
        )


@dataclass
class ExtractionResult:
    mentions: list[MedicationMention] = field(default_factory=list)
    unverified_candidates: list[str] = field(default_factory=list)

    @property
    def names(self) -> set[str]:
        return {mention.name for mention in self.mentions}

    def by_name(self) -> dict[str, list[MedicationMention]]:
        grouped: dict[str, list[MedicationMention]] = {}
        for mention in self.mentions:
            grouped.setdefault(mention.name, []).append(mention)
        return grouped


# ---------------------------------------------------------------- extraction


def _split_sentences(text: str) -> list[str]:
    """Split on sentence enders and on newlines.

    Newlines matter as much as periods here. The rewrite puts one medication per
    line without terminal punctuation, so splitting on periods alone merges two
    drugs into one context window and their doses get crossed.
    """
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    return [part.strip() for part in parts if part.strip()]


def _looks_like_medication(token: str) -> tuple[bool, str]:
    lowered = token.lower().strip("'-")
    if lowered in COMMON_MEDICATIONS:
        return True, "lexicon"
    if lowered in STEM_COLLISIONS:
        return False, ""
    if len(lowered) >= 6 and lowered.endswith(GENERIC_STEMS):
        return True, "morphology"
    return False, ""


def _find_dose(segment: str, after: int = 0) -> tuple[float | None, str | None]:
    match = _DOSE_RE.search(segment, after)
    if not match:
        return None, None
    raw = match.group("value").replace(",", ".")
    try:
        value = float(raw)
    except ValueError:  # pragma: no cover - regex guarantees a number
        return None, None
    return value, match.group("unit").lower()


def _find_route(segment: str) -> str | None:
    lowered = segment.lower()
    # Longest phrase first so "by mouth" beats a bare "mouth" substring hit.
    for term in sorted(ROUTE_TERMS, key=len, reverse=True):
        if re.search(rf"(?<![a-z]){re.escape(term)}(?![a-z])", lowered):
            return ROUTE_TERMS[term]
    return None


def _find_frequency(segment: str) -> tuple[str | None, float | None]:
    lowered = segment.lower()
    for term in sorted(FREQUENCY_TERMS, key=len, reverse=True):
        if re.search(rf"(?<![a-z]){re.escape(term)}(?![a-z])", lowered):
            return FREQUENCY_TERMS[term]
    return None, None


def _find_duration(segment: str) -> str | None:
    match = re.search(
        r"\bfor\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+"
        r"(day|days|week|weeks|month|months)\b",
        segment,
        re.IGNORECASE,
    )
    return match.group(0).lower() if match else None


def extract(text: str) -> ExtractionResult:
    """Pull every medication mention out of one document."""
    result = ExtractionResult()
    seen_signatures: set[str] = set()
    candidates: set[str] = set()

    for sentence in _split_sentences(text):
        # Strategy 1 and 2: lexicon and morphology over every word.
        for word_match in _WORD_RE.finditer(sentence):
            token = word_match.group(0)
            is_drug, detection = _looks_like_medication(token)
            if not is_drug:
                continue

            dose_value, dose_unit = _find_dose(sentence, word_match.end())
            if dose_value is None:
                dose_value, dose_unit = _find_dose(sentence)
            frequency, per_day = _find_frequency(sentence)

            mention = MedicationMention(
                name=token.lower().strip("'-"),
                surface_form=token,
                dose_value=dose_value,
                dose_unit=dose_unit,
                route=_find_route(sentence),
                frequency=frequency,
                frequency_per_day=per_day,
                duration=_find_duration(sentence),
                context=sentence,
                detection=detection,
                verified=detection == "lexicon",
            )
            if mention.signature() not in seen_signatures:
                seen_signatures.add(mention.signature())
                result.mentions.append(mention)

        # Strategy 3: anything sitting immediately in front of a dose.
        for context_match in _CONTEXT_RE.finditer(sentence):
            name = context_match.group("name").lower().strip("'-")
            # A lab value reads exactly like a dose. "cholesterol 200 mg" is a
            # result, not a prescription.
            if name in _CONTEXT_STOPWORDS or name in DOSE_UNITS or name in STEM_COLLISIONS:
                continue
            is_known, _ = _looks_like_medication(name)
            if is_known:
                continue  # already captured above

            frequency, per_day = _find_frequency(sentence)
            mention = MedicationMention(
                name=name,
                surface_form=context_match.group("name"),
                dose_value=float(context_match.group("value").replace(",", ".")),
                dose_unit=context_match.group("unit").lower(),
                route=_find_route(sentence),
                frequency=frequency,
                frequency_per_day=per_day,
                duration=_find_duration(sentence),
                context=sentence,
                detection="context",
                verified=False,
            )
            if mention.signature() not in seen_signatures:
                seen_signatures.add(mention.signature())
                result.mentions.append(mention)
                candidates.add(name)

    result.unverified_candidates = sorted(candidates)
    return result


def extract_warnings(text: str) -> list[str]:
    """Pull out sentences that carry a restriction or a stop condition.

    These are tracked separately from medications because losing one is its own
    category of failure. "Do not drink alcohol with this medicine" disappearing
    from a rewrite is not a dosing error, it is a missing contraindication.
    """
    warning_markers = (
        "do not", "don't", "never", "avoid", "stop taking", "stop the",
        "call 911", "call your doctor", "call the clinic", "go to the emergency",
        "seek immediate", "seek emergency", "warning", "caution", "allergic",
        "allergy", "should not", "must not", "cannot", "unsafe", "danger",
        "if you experience", "if you notice", "watch for", "side effect",
    )
    warnings: list[str] = []
    for sentence in _split_sentences(text):
        lowered = sentence.lower()
        if any(marker in lowered for marker in warning_markers):
            warnings.append(sentence)
    return warnings
