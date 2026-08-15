"""DeepL integration with medical terminology preservation.

The problem this module solves: a general purpose translation engine will
happily translate "Coumadin" into a local common noun, convert "5 mg" into a
locally formatted number, or render "twice daily" as an approximation. Any one
of those is a dosing error in a document a patient will follow unsupervised.

The mechanism: before sending text to DeepL, every token that must survive
byte-for-byte is wrapped in an XML tag that DeepL is told to ignore. DeepL
translates around the protected spans and returns them untouched. The tags are
stripped on the way out.

Protected by default:
  - Every term supplied by the caller, which in practice is the drug list Guard
    extracted from the source document
  - Numbers with units, for example "40 mg", "2.5 mL", "98.6 F"
  - Bare integers and decimals
  - Times and dates
  - Phone numbers
  - Anything already inside a protection tag

What this does not do: it does not protect free-text instructions, which is the
point. "Take one tablet by mouth every morning" must be translated. Only the
tokens where a paraphrase changes the clinical meaning are frozen.
"""

from __future__ import annotations

import html
import logging
import re

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import Settings

logger = logging.getLogger(__name__)

PROTECT_TAG = "keep"

# Ordered by specificity. The first pattern to claim a span wins, so
# "40 mg" is protected as one unit rather than as a bare number plus stray text.
_PROTECTION_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Dose with unit: 40 mg, 2.5 mL, 0.125 mcg, 100 units, 5mg
    re.compile(
        r"\b\d+(?:[.,]\d+)?\s?"
        r"(?:mg|mcg|g|kg|mL|ml|L|IU|units?|tablets?|capsules?|puffs?|drops?|"
        r"mmHg|mEq|mmol|%)\b",
        re.IGNORECASE,
    ),
    # Temperature: 100.4 F, 38 C
    re.compile(r"\b\d+(?:\.\d+)?\s?°?\s?[FC]\b"),
    # Clock time: 8:00 AM, 20:30
    re.compile(r"\b\d{1,2}:\d{2}\s?(?:[AaPp]\.?[Mm]\.?)?\b"),
    # Date: 03/14/2026, 2026-03-14
    re.compile(r"\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b"),
    # North American phone number
    re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),
    # Standalone number, including ranges written with a hyphen
    re.compile(r"\b\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)?\b"),
)

_TAG_RE = re.compile(rf"</?{PROTECT_TAG}>")


class DeepLError(RuntimeError):
    """Raised when DeepL returns an error the caller needs to see."""


class ProtectionResult:
    """Text prepared for translation, plus what was frozen in it."""

    __slots__ = ("text", "protected_terms")

    def __init__(self, text: str, protected_terms: list[str]) -> None:
        self.text = text
        self.protected_terms = protected_terms


def protect(text: str, terms: list[str] | None = None) -> ProtectionResult:
    """Wrap every span that must survive translation in an ignore tag."""
    terms = terms or []
    protected: list[str] = []

    # Caller-supplied terms first. Longest first so "insulin glargine" is claimed
    # before the substring "insulin" can split it in two.
    for term in sorted({t.strip() for t in terms if t.strip()}, key=len, reverse=True):
        pattern = re.compile(rf"(?<![<\w]){re.escape(term)}(?![\w>])", re.IGNORECASE)

        def _wrap_term(match: re.Match[str]) -> str:
            protected.append(match.group(0))
            return f"<{PROTECT_TAG}>{match.group(0)}</{PROTECT_TAG}>"

        text = pattern.sub(_wrap_term, text)

    # Then the numeric and structural patterns.
    for pattern in _PROTECTION_PATTERNS:

        def _wrap_span(match: re.Match[str]) -> str:
            span = match.group(0)
            protected.append(span)
            return f"<{PROTECT_TAG}>{span}</{PROTECT_TAG}>"

        text = _protect_outside_tags(text, pattern, _wrap_span)

    return ProtectionResult(text=text, protected_terms=protected)


def _protect_outside_tags(text: str, pattern: re.Pattern[str], repl) -> str:
    """Apply a pattern only to spans that are not already protected.

    Without this, "40 mg" inside an already tagged drug name would get a second
    nested tag, and DeepL rejects nested ignore tags.
    """
    segments = re.split(rf"(<{PROTECT_TAG}>.*?</{PROTECT_TAG}>)", text, flags=re.DOTALL)
    for index, segment in enumerate(segments):
        if segment.startswith(f"<{PROTECT_TAG}>"):
            continue
        segments[index] = pattern.sub(repl, segment)
    return "".join(segments)


def unprotect(text: str) -> str:
    """Strip protection tags and undo the entity encoding DeepL applies."""
    return html.unescape(_TAG_RE.sub("", text))


def verify_preservation(translated: str, protected_terms: list[str]) -> list[str]:
    """Return the protected terms that did not survive.

    Called on every translation. A non-empty result means the output cannot be
    released, because something DeepL was told to leave alone came back changed.
    """
    missing: list[str] = []
    for term in protected_terms:
        if term not in translated:
            missing.append(term)
    return missing


class DeepLClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.deepl_api_host,
            timeout=settings.deepl_timeout_seconds,
            headers={"Authorization": f"DeepL-Auth-Key {settings.deepl_api_key}"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    @retry(
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def translate(
        self,
        *,
        text: str,
        target_lang: str,
        source_lang: str = "EN",
        preserve_terms: list[str] | None = None,
        glossary_id: str | None = None,
    ) -> tuple[str, list[str], list[str]]:
        """Translate one document.

        Returns (translated_text, protected_terms, terms_that_did_not_survive).
        The caller decides what to do about the third element. This client does
        not decide on its own that a partial result is good enough.
        """
        prepared = protect(text, preserve_terms)

        payload: dict[str, object] = {
            "text": [prepared.text],
            "target_lang": target_lang,
            "source_lang": source_lang,
            # XML handling is what makes ignore_tags work at all.
            "tag_handling": "xml",
            "ignore_tags": [PROTECT_TAG],
            # Patient instructions are addressed directly to the patient. In
            # languages with a T-V distinction, the formal register is what a
            # hospital document uses.
            "formality": "prefer_more",
            # Preserve the line structure. The rewrite puts one medication per
            # line and DeepL will otherwise reflow them into a paragraph.
            "split_sentences": "nonewlines",
            "preserve_formatting": True,
        }
        if glossary_id:
            payload["glossary_id"] = glossary_id

        try:
            response = await self._client.post("/v2/translate", json=payload)
        except httpx.HTTPError as exc:
            raise DeepLError(f"DeepL request failed: {exc}") from exc

        if response.status_code == 456:
            raise DeepLError("DeepL character quota exhausted for this billing period")
        if response.status_code == 403:
            raise DeepLError("DeepL rejected the API key")
        if response.status_code == 429:
            raise DeepLError("DeepL rate limit reached, retry shortly")
        if response.status_code >= 400:
            raise DeepLError(f"DeepL returned {response.status_code}: {response.text[:300]}")

        translations = response.json().get("translations", [])
        if not translations:
            raise DeepLError("DeepL returned no translations")

        translated = unprotect(translations[0]["text"])
        missing = verify_preservation(translated, prepared.protected_terms)

        if missing:
            logger.warning(
                "%s protected term(s) did not survive translation to %s",
                len(missing),
                target_lang,
            )

        return translated, prepared.protected_terms, missing

    async def usage(self) -> dict[str, int]:
        """Character quota, surfaced on the ops dashboard before a bulk run."""
        response = await self._client.get("/v2/usage")
        response.raise_for_status()
        return response.json()
