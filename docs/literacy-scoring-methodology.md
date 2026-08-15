# Literacy scoring methodology

## The claim this document supports

Smplixit tells a hospital that a discharge summary written at grade 16 now reads at grade 5. That claim appears on a screen a compliance officer looks at, and it has to survive being questioned. This document is how it is measured and where the measurement is weak.

## Two formulas, and why not one

### SMOG

SMOG (Simple Measure of Gobbledygook, McLaughlin 1969) counts words of three or more syllables across a 30 sentence sample.

```
grade = 1.0430 * sqrt(polysyllables * (30 / sentences)) + 3.1291
```

It measures vocabulary load. This is the formula the CDC and AHRQ recommend for patient materials, and the reason is specific: what stops a patient following a medication schedule is not sentence length, it is encountering `anticoagulation` and `thromboembolic prophylaxis` and deciding the document is not for them.

SMOG is also the stricter formula. It was calibrated against 100 percent comprehension, where most readability formulas target 50 to 75 percent. For a document whose failure mode is a patient taking the wrong dose, calibrating against full comprehension is the correct choice.

### Flesch-Kincaid

```
grade = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59
```

It weights average sentence length alongside syllable count, and it catches the opposite failure: short common words strung into a 60 word sentence with four clauses.

### The consensus grade

```python
consensus_grade = max(smog, flesch_kincaid)
```

The maximum, not the mean. This is the single most important decision in the scoring layer.

A rewrite engine optimizes whatever it is scored on. Given one number, it will find the cheapest path to that number. Averaging two formulas creates that path: chop every sentence to six words, leave the vocabulary untouched, and Flesch-Kincaid collapses far enough to drag the mean under target while SMOG stays at grade 14. The output reads as staccato clinical jargon and scores as grade 6.

Taking the maximum closes it. Both formulas have to clear the target independently, so the only way through is to do both kinds of work: replace the long words and shorten the sentences.

`services/core/tests/test_scorer.py` locks this in as a test, because it is the property most likely to be lost in a well-meaning refactor.

## Acceptance

```python
def meets_target(level, target_grade, tolerance=0.5):
    ceiling = target_grade + tolerance
    return level.smog <= ceiling and level.flesch_kincaid <= ceiling
```

Default target is grade 6. Default tolerance is 0.5 grades.

Grade 6 comes from the AMA and NIH recommendation for patient education material, which lands at grade 6 or below. It is not arbitrary: US adult literacy survey data puts a large fraction of adults at or below basic health literacy, and grade 6 is roughly where that population can read a document without help.

The configured floor is grade 3. Below that, output starts reading as condescending to an adult and, more importantly, starts dropping clinical nouns that have no simpler equivalent. The ceiling is grade 12, above which the exercise has no point.

The 0.5 tolerance absorbs measurement noise from the syllable counter, not policy slack. Syllable counting in English is heuristic, and a single hyphenated drug name can move a short document by a few tenths.

## Known limitations

These are stated plainly because a methodology document that only lists strengths is not useful in a due diligence conversation.

### SMOG needs 30 sentences and discharge summaries are shorter

SMOG's published formula assumes a 30 sentence sample. Below that the library extrapolates, and the result gets noisy under about 10 sentences. A medication list of six lines will produce a SMOG figure, and that figure should not be trusted on its own.

Handled explicitly. `scorer.score` reports `sentence_count`, and `smog_confidence` returns:

| Sentences | Confidence |
| --- | --- |
| 30 or more | high |
| 10 to 29 | moderate |
| under 10 | low |

Short samples effectively lean on Flesch-Kincaid through the max. The console surfaces the confidence in a tooltip rather than hiding it.

### Readability formulas do not measure comprehension

They measure surface features: syllables, sentence length, word frequency. They do not know whether a sentence is ambiguous, whether the order of instructions is followable, or whether a patient will act correctly.

"Take the blue one when the other one runs out" scores at roughly grade 3 and is unusable. Nothing in this scoring layer will flag it.

This is the honest boundary of the measurement, and it is why Guard exists as a separate check on content rather than as another number in the score. The grade badge says the language is simple. Guard says the content survived. Neither one alone is sufficient, and the product does not claim otherwise.

### Numbers and abbreviations distort syllable counts

`40 mg` and `BID` are not words, and syllable estimation on them is meaningless. Both formulas absorb some noise from a dense medication list. Documents that are mostly medication tables score lower than they read.

### English only

SMOG and Flesch-Kincaid are calibrated for English. They are not applied to translated output, and Poly does not report a grade for translated text. Reporting an English-calibrated grade on a Spanish document would be a fabricated number.

The defensible claim is narrower and is the one the product makes: the English source was simplified to a measured grade, and the translation preserved that simplified text faithfully, with medication terms verified byte-for-byte.

## What the scorer surfaces beyond the grade

`find_difficult_terms` ranks the words carrying the reading level by impact:

```
impact = syllables * occurrences
```

A four-syllable word used six times hurts comprehension more than a six-syllable word used once. The ranking drives the console hint list and feeds the rewrite prompt, so the pipeline works on the words that actually matter rather than on whatever appears first.

`terms_removed` diffs the difficult vocabulary between source and output. It is the evidence that the rewrite did vocabulary work rather than sentence chopping, and it is displayed under the before and after panel for exactly that reason.

## The plain-language rubric

`services/core/app/engine/rubrics/plain_language_map.json` maps clinical terms to plain equivalents: `dyspnea` to `shortness of breath`, `hypertension` to `high blood pressure`.

The rubric never mutates text. It informs the rewrite prompt and populates console hints, and every substitution then passes through Guard. A wrong automatic substitution in a discharge instruction is a clinical safety event, and a lookup table is not a safe place to make that decision unsupervised.

The maintained rubric is not distributed with the repository. A tracked example seed ships alongside it so a clean clone runs with correct, if narrower, behaviour.

## Verifying the claims

```bash
cd services/core && pytest tests/test_scorer.py -v
```

Ten tests. The ones that matter:

- Clinical text scores higher than plain text. If this ever inverts, the badge is lying.
- `consensus_grade` equals the maximum of the two formulas.
- `meets_target` fails when only one formula clears.
- `rejection_reason` names the failing formula and carries the measured number, because that string is fed back into the next rewrite pass.
- Empty input raises rather than returning zero, since 0.0 is a real score and must not double as an error.
- SMOG confidence degrades on short samples.

## References

- McLaughlin, G.H. (1969). SMOG grading: a new readability formula. *Journal of Reading* 12(8).
- Kincaid, J.P. et al. (1975). Derivation of new readability formulas for Navy enlisted personnel. Research Branch Report 8-75.
- Centers for Disease Control and Prevention. *Simply Put: A guide for creating easy-to-understand materials*.
- Agency for Healthcare Research and Quality. *Health Literacy Universal Precautions Toolkit*, 2nd edition.
- National Center for Education Statistics. *National Assessment of Adult Literacy*, health literacy component.
