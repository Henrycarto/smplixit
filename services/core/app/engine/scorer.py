"""Reading level measurement.

Two formulas run on every block of text:

  SMOG              counts polysyllabic words across 30 sentences. It is the
                    formula the CDC and AHRQ recommend for patient materials
                    because vocabulary load, not sentence length, is what
                    actually stops a patient from following a drug schedule.

  Flesch-Kincaid    weights average sentence length alongside syllable count.
                    It catches the opposite failure: short words strung into
                    100 word run-on sentences.

The consensus grade is the maximum of the two. Taking the max rather than the
mean means a rewrite cannot pass by gaming one formula, which is exactly what a
model will do if you give it a single number to optimize.

Known limitation, handled explicitly below: SMOG is only defined for samples of
30 or more sentences. Discharge summaries are routinely shorter. textstat
returns a value anyway, extrapolated from whatever is present, and that value
gets noisy under roughly 10 sentences. `score()` reports the count so callers
can weight confidence, and short samples lean on Flesch-Kincaid through the max.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import textstat

from app.schemas import DifficultTerm, ReadingLevel

# SMOG's published formula assumes a 30 sentence sample.
SMOG_MIN_SENTENCES = 30

# Below this, treat any SMOG figure as advisory only.
SMOG_CONFIDENCE_FLOOR = 10

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'-]+")

_RUBRIC_DIR = Path(__file__).parent / "rubrics"


def _load_plain_language_map() -> dict[str, str]:
    """Load the clinical-term-to-plain-language rubric.

    The maintained rubric lives at `rubrics/plain_language_map.json` and is not
    distributed with the repository. A tracked example seed is used when it is
    absent so a clean clone still runs with correct, if narrower, behaviour.

    The rubric drives UI hints and prompt guidance only. It never mutates text
    directly: a wrong substitution in a discharge instruction is a clinical
    safety event, so every swap goes through the model and then through Guard.
    """
    for candidate in ("plain_language_map.json", "plain_language_map.example.json"):
        path = _RUBRIC_DIR / candidate
        if path.is_file():
            with path.open(encoding="utf-8") as handle:
                data = json.load(handle)
            return {str(k).lower(): str(v) for k, v in data.items()}
    return {}


PLAIN_LANGUAGE_MAP: dict[str, str] = _load_plain_language_map()


def _syllables(word: str) -> int:
    return int(textstat.syllable_count(word))


def score(text: str) -> ReadingLevel:
    """Measure one block of text.

    Raises ValueError on empty input rather than returning a misleading zero.
    A grade of 0.0 is a real, meaningful score and must not double as an error.
    """
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("cannot score empty text")

    smog = float(textstat.smog_index(cleaned))
    flesch_kincaid = float(textstat.flesch_kincaid_grade(cleaned))
    reading_ease = float(textstat.flesch_reading_ease(cleaned))

    sentence_count = int(textstat.sentence_count(cleaned))
    word_count = int(textstat.lexicon_count(cleaned, removepunct=True))
    polysyllabic = int(textstat.polysyllabcount(cleaned))

    # Flesch-Kincaid can go slightly negative on very simple text. Clamp to 0,
    # since "grade -1.2" is not a thing a hospital compliance officer can act on.
    smog = max(0.0, smog)
    flesch_kincaid = max(0.0, flesch_kincaid)

    avg_sentence_length = (word_count / sentence_count) if sentence_count else float(word_count)

    return ReadingLevel(
        smog=round(smog, 1),
        flesch_kincaid=round(flesch_kincaid, 1),
        flesch_reading_ease=round(reading_ease, 1),
        consensus_grade=round(max(smog, flesch_kincaid), 1),
        word_count=word_count,
        sentence_count=sentence_count,
        polysyllabic_word_count=polysyllabic,
        avg_sentence_length=round(avg_sentence_length, 1),
    )


def smog_is_reliable(level: ReadingLevel) -> bool:
    """True when the sample is long enough for SMOG to mean what it claims."""
    return level.sentence_count >= SMOG_MIN_SENTENCES


def smog_confidence(level: ReadingLevel) -> str:
    """Three-state confidence label surfaced in the console tooltip."""
    if level.sentence_count >= SMOG_MIN_SENTENCES:
        return "high"
    if level.sentence_count >= SMOG_CONFIDENCE_FLOOR:
        return "moderate"
    return "low"


def meets_target(level: ReadingLevel, target_grade: int, tolerance: float = 0.5) -> bool:
    """Both formulas must clear the target, not just the friendlier one."""
    ceiling = target_grade + tolerance
    return level.smog <= ceiling and level.flesch_kincaid <= ceiling


def rejection_reason(level: ReadingLevel, target_grade: int, tolerance: float = 0.5) -> str | None:
    """Human-readable explanation of why a rewrite attempt failed the gate.

    This string is fed back into the next rewrite prompt, so it is phrased as an
    instruction the model can act on rather than as a bare metric dump.
    """
    if meets_target(level, target_grade, tolerance):
        return None

    ceiling = target_grade + tolerance
    problems: list[str] = []

    if level.smog > ceiling:
        problems.append(
            f"SMOG is {level.smog} against a ceiling of {ceiling}. "
            f"There are still {level.polysyllabic_word_count} words of three or more syllables. "
            "Replace the long words, do not just split the sentences."
        )
    if level.flesch_kincaid > ceiling:
        problems.append(
            f"Flesch-Kincaid is {level.flesch_kincaid} against a ceiling of {ceiling}. "
            f"Average sentence length is {level.avg_sentence_length} words. "
            "Break the long sentences into separate short ones."
        )

    return " ".join(problems)


def find_difficult_terms(text: str, max_terms: int = 25) -> list[DifficultTerm]:
    """Surface the words carrying the reading level, ranked by impact.

    Impact is syllables times occurrences: a four-syllable word used six times
    hurts comprehension more than a six-syllable word used once.
    """
    counts: dict[str, int] = {}
    for match in _WORD_RE.finditer(text):
        word = match.group(0).lower()
        if len(word) < 4:
            continue
        counts[word] = counts.get(word, 0) + 1

    terms: list[DifficultTerm] = []
    for word, occurrences in counts.items():
        syllables = _syllables(word)
        if syllables < 3:
            continue
        terms.append(
            DifficultTerm(
                term=word,
                syllables=syllables,
                occurrences=occurrences,
                plain_language_suggestion=PLAIN_LANGUAGE_MAP.get(word),
            )
        )

    terms.sort(key=lambda t: (t.syllables * t.occurrences, t.syllables), reverse=True)
    return terms[:max_terms]


def terms_removed(original: str, simplified: str, max_terms: int = 25) -> list[DifficultTerm]:
    """Difficult terms present in the source that the rewrite eliminated.

    This is what the console shows under the before/after panel. It is evidence
    the rewrite did vocabulary work, not just sentence chopping.
    """
    remaining = {t.term for t in find_difficult_terms(simplified, max_terms=500)}
    return [t for t in find_difficult_terms(original, max_terms=500) if t.term not in remaining][
        :max_terms
    ]
