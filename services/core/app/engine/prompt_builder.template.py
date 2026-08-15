"""Reference prompt builder.

This is the tracked template. `prompt_builder.py`, the module the service
actually imports, is not distributed with this repository: the tuned rule set,
the correction phrasing, and the term-substitution policy are proprietary.

Copy this file to `prompt_builder.py` (or run `npm run bootstrap:engine`) to get
a working service. The template produces correct, safe output. It does not
reproduce the tuned pipeline's convergence behaviour, so expect it to need more
passes to reach a low target grade.

Interface contract that `prompt_builder.py` must satisfy:

    SYSTEM_PROMPT: str
    build_initial_prompt(*, discharge_summary, target_grade, preserve_terms,
                         difficult_terms) -> list[dict[str, str]]
    build_refinement_prompt(*, discharge_summary, previous_output, target_grade,
                            failure_reason, attempt, preserve_terms,
                            difficult_terms) -> list[dict[str, str]]

Both return a chat-style message list. Both must be pure functions with no I/O.
"""

from __future__ import annotations

from app.schemas import DifficultTerm

SYSTEM_PROMPT = """You rewrite hospital discharge instructions for patients.

This is a translation task, not a summary. Every instruction in the source must
survive into the output.

Rules:

1. Reproduce every medication name exactly as spelled in the source. Do not add
   one, drop one, or swap a brand name for a generic name.
2. Reproduce every dose, frequency, duration, and date exactly. Do not round or
   convert units.
3. Keep every warning and restriction as its own short sentence.
4. Reproduce every appointment, phone number, and address exactly.
5. Add nothing clinical that is not in the source.
6. If a term cannot be simplified without changing its meaning, keep it and add
   a short plain-language definition in parentheses.

Style: address the patient as "you", one idea per sentence, short common words,
active voice, plain ALL CAPS headings followed by a colon, "- " for list items.
Plain text only. Never use em dashes.

Return only the rewritten instructions with no preamble."""


def _format_preserve_terms(preserve_terms: list[str]) -> str:
    if not preserve_terms:
        return ""
    joined = "\n".join(f"  - {term}" for term in preserve_terms)
    return f"\nThese terms must appear exactly as written:\n{joined}\n"


def _format_difficult_terms(terms: list[DifficultTerm]) -> str:
    if not terms:
        return ""
    joined = "\n".join(f"  - {term.term}" for term in terms[:15])
    return f"\nThese words raise the reading level. Replace or explain them:\n{joined}\n"


def build_initial_prompt(
    *,
    discharge_summary: str,
    target_grade: int,
    preserve_terms: list[str] | None = None,
    difficult_terms: list[DifficultTerm] | None = None,
) -> list[dict[str, str]]:
    user_prompt = (
        f"Rewrite the discharge summary below for an adult reading at grade "
        f"{target_grade}. The result is measured on both the SMOG and the "
        f"Flesch-Kincaid scale and must score at or below grade {target_grade} "
        f"on each.\n"
        f"{_format_preserve_terms(preserve_terms or [])}"
        f"{_format_difficult_terms(difficult_terms or [])}"
        f'\nDISCHARGE SUMMARY:\n"""\n{discharge_summary}\n"""'
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def build_refinement_prompt(
    *,
    discharge_summary: str,
    previous_output: str,
    target_grade: int,
    failure_reason: str,
    attempt: int,
    preserve_terms: list[str] | None = None,
    difficult_terms: list[DifficultTerm] | None = None,
) -> list[dict[str, str]]:
    user_prompt = (
        f"The previous rewrite missed the target reading level.\n"
        f"\nMeasured result: {failure_reason}\n"
        f"\nThis is attempt {attempt}. Rewrite again at grade {target_grade} or "
        f"lower on both scales. Keep every medication, number, warning, and "
        f"appointment exactly as it appears in the original source.\n"
        f"{_format_preserve_terms(preserve_terms or [])}"
        f"{_format_difficult_terms(difficult_terms or [])}"
        f'\nORIGINAL SOURCE:\n"""\n{discharge_summary}\n"""\n'
        f'\nPREVIOUS REWRITE:\n"""\n{previous_output}\n"""'
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
