"""Supported target languages.

Two tiers, and the distinction is deliberate.

TIER 1, machine translated. DeepL covers these natively. Poly translates them
    on demand and returns the result as releasable.

TIER 2, review required. DeepL does not support these targets. They are still
    listed because they are among the most common limited-English-proficiency
    languages in United States hospital systems, and a hospital's language
    access obligations under Section 1557 of the Affordable Care Act do not stop
    at the edge of a vendor's language list.

    For Tier 2, Poly does not silently fall back to a weaker engine and present
    the output as finished. It returns the request marked `requires_human_review`
    with the simplified English attached, which is what a hospital interpreter
    services desk actually needs. Emitting an unreviewed machine translation of
    a medication schedule into a language the engine does not support is the
    kind of thing that produces a patient safety event and a lawsuit.

Tier 1 count is what DeepL supports today. Tier 2 is maintained against the
Office of Minority Health language access data and hospital interpreter request
volume. Together they cover 50+ languages.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Tier(str, Enum):
    MACHINE = "machine_translated"
    REVIEW_REQUIRED = "requires_human_review"


@dataclass(frozen=True)
class Language:
    code: str          # Code used by Poly's API, BCP 47 style
    deepl_code: str | None  # Target code sent to DeepL, None for Tier 2
    name: str          # English name
    native_name: str   # Endonym, shown in the console picker
    tier: Tier
    rtl: bool = False  # Right to left, drives the PDF export layout


_TIER_1: tuple[Language, ...] = (
    Language("ar", "AR", "Arabic", "العربية", Tier.MACHINE, rtl=True),
    Language("bg", "BG", "Bulgarian", "български", Tier.MACHINE),
    Language("cs", "CS", "Czech", "čeština", Tier.MACHINE),
    Language("da", "DA", "Danish", "dansk", Tier.MACHINE),
    Language("de", "DE", "German", "Deutsch", Tier.MACHINE),
    Language("el", "EL", "Greek", "Ελληνικά", Tier.MACHINE),
    Language("en-gb", "EN-GB", "English (UK)", "English (UK)", Tier.MACHINE),
    Language("en-us", "EN-US", "English (US)", "English (US)", Tier.MACHINE),
    Language("es", "ES", "Spanish", "Español", Tier.MACHINE),
    Language("et", "ET", "Estonian", "eesti", Tier.MACHINE),
    Language("fi", "FI", "Finnish", "suomi", Tier.MACHINE),
    Language("fr", "FR", "French", "Français", Tier.MACHINE),
    Language("he", "HE", "Hebrew", "עברית", Tier.MACHINE, rtl=True),
    Language("hu", "HU", "Hungarian", "magyar", Tier.MACHINE),
    Language("id", "ID", "Indonesian", "Bahasa Indonesia", Tier.MACHINE),
    Language("it", "IT", "Italian", "Italiano", Tier.MACHINE),
    Language("ja", "JA", "Japanese", "日本語", Tier.MACHINE),
    Language("ko", "KO", "Korean", "한국어", Tier.MACHINE),
    Language("lt", "LT", "Lithuanian", "lietuvių", Tier.MACHINE),
    Language("lv", "LV", "Latvian", "latviešu", Tier.MACHINE),
    Language("nb", "NB", "Norwegian", "norsk bokmål", Tier.MACHINE),
    Language("nl", "NL", "Dutch", "Nederlands", Tier.MACHINE),
    Language("pl", "PL", "Polish", "polski", Tier.MACHINE),
    Language("pt-br", "PT-BR", "Portuguese (Brazil)", "Português (Brasil)", Tier.MACHINE),
    Language("pt-pt", "PT-PT", "Portuguese (Portugal)", "Português (Portugal)", Tier.MACHINE),
    Language("ro", "RO", "Romanian", "română", Tier.MACHINE),
    Language("ru", "RU", "Russian", "Русский", Tier.MACHINE),
    Language("sk", "SK", "Slovak", "slovenčina", Tier.MACHINE),
    Language("sl", "SL", "Slovenian", "slovenščina", Tier.MACHINE),
    Language("sv", "SV", "Swedish", "svenska", Tier.MACHINE),
    Language("th", "TH", "Thai", "ไทย", Tier.MACHINE),
    Language("tr", "TR", "Turkish", "Türkçe", Tier.MACHINE),
    Language("uk", "UK", "Ukrainian", "Українська", Tier.MACHINE),
    Language("vi", "VI", "Vietnamese", "Tiếng Việt", Tier.MACHINE),
    Language("zh-hans", "ZH-HANS", "Chinese (Simplified)", "简体中文", Tier.MACHINE),
    Language("zh-hant", "ZH-HANT", "Chinese (Traditional)", "繁體中文", Tier.MACHINE),
)

# High-volume LEP languages in United States hospital systems that DeepL does
# not target. Ordered roughly by national interpreter request volume.
_TIER_2: tuple[Language, ...] = (
    Language("tl", None, "Tagalog", "Tagalog", Tier.REVIEW_REQUIRED),
    Language("ht", None, "Haitian Creole", "Kreyòl Ayisyen", Tier.REVIEW_REQUIRED),
    Language("so", None, "Somali", "Soomaali", Tier.REVIEW_REQUIRED),
    Language("hmn", None, "Hmong", "Hmoob", Tier.REVIEW_REQUIRED),
    Language("am", None, "Amharic", "አማርኛ", Tier.REVIEW_REQUIRED),
    Language("ti", None, "Tigrinya", "ትግርኛ", Tier.REVIEW_REQUIRED),
    Language("om", None, "Oromo", "Afaan Oromoo", Tier.REVIEW_REQUIRED),
    Language("sw", None, "Swahili", "Kiswahili", Tier.REVIEW_REQUIRED),
    Language("ne", None, "Nepali", "नेपाली", Tier.REVIEW_REQUIRED),
    Language("my", None, "Burmese", "မြန်မာ", Tier.REVIEW_REQUIRED),
    Language("kar", None, "S'gaw Karen", "ကညီ", Tier.REVIEW_REQUIRED),
    Language("bn", None, "Bengali", "বাংলা", Tier.REVIEW_REQUIRED),
    Language("gu", None, "Gujarati", "ગુજરાતી", Tier.REVIEW_REQUIRED),
    Language("hi", None, "Hindi", "हिन्दी", Tier.REVIEW_REQUIRED),
    Language("pa", None, "Punjabi", "ਪੰਜਾਬੀ", Tier.REVIEW_REQUIRED),
    Language("ur", None, "Urdu", "اردو", Tier.REVIEW_REQUIRED, rtl=True),
    Language("fa", None, "Persian (Farsi)", "فارسی", Tier.REVIEW_REQUIRED, rtl=True),
    Language("prs", None, "Dari", "دری", Tier.REVIEW_REQUIRED, rtl=True),
    Language("ps", None, "Pashto", "پښتو", Tier.REVIEW_REQUIRED, rtl=True),
    Language("ku", None, "Kurdish (Kurmanji)", "Kurmancî", Tier.REVIEW_REQUIRED),
    Language("km", None, "Khmer", "ខ្មែរ", Tier.REVIEW_REQUIRED),
    Language("lo", None, "Lao", "ລາວ", Tier.REVIEW_REQUIRED),
    Language("chk", None, "Chuukese", "Chuuk", Tier.REVIEW_REQUIRED),
    Language("mh", None, "Marshallese", "Kajin M̧ajeļ", Tier.REVIEW_REQUIRED),
    Language("sm", None, "Samoan", "Gagana Samoa", Tier.REVIEW_REQUIRED),
    Language("to", None, "Tongan", "Lea faka-Tonga", Tier.REVIEW_REQUIRED),
    Language("nv", None, "Navajo", "Diné bizaad", Tier.REVIEW_REQUIRED),
    Language("sq", None, "Albanian", "Shqip", Tier.REVIEW_REQUIRED),
    Language("bs", None, "Bosnian", "bosanski", Tier.REVIEW_REQUIRED),
    Language("hy", None, "Armenian", "Հայերեն", Tier.REVIEW_REQUIRED),
)

LANGUAGES: tuple[Language, ...] = _TIER_1 + _TIER_2

_BY_CODE: dict[str, Language] = {language.code: language for language in LANGUAGES}

# Common aliases a caller might send. Mapped rather than rejected, because an
# EHR sending "zh" or "pt" should not get a 400 for it.
_ALIASES: dict[str, str] = {
    "en": "en-us",
    "zh": "zh-hans",
    "zh-cn": "zh-hans",
    "zh-tw": "zh-hant",
    "pt": "pt-br",
    "no": "nb",
    "fil": "tl",
    "far": "fa",
    "per": "fa",
}


def normalize(code: str) -> str:
    """Lowercase, swap underscores for hyphens, resolve aliases."""
    normalized = code.strip().lower().replace("_", "-")
    return _ALIASES.get(normalized, normalized)


def get(code: str) -> Language | None:
    return _BY_CODE.get(normalize(code))


def is_supported(code: str) -> bool:
    return normalize(code) in _BY_CODE


def machine_translatable(code: str) -> bool:
    language = get(code)
    return language is not None and language.tier is Tier.MACHINE


def all_languages() -> list[Language]:
    """Tier 1 first, each tier alphabetical by English name."""
    tier_1 = sorted((lang for lang in LANGUAGES if lang.tier is Tier.MACHINE), key=lambda x: x.name)
    tier_2 = sorted(
        (lang for lang in LANGUAGES if lang.tier is Tier.REVIEW_REQUIRED), key=lambda x: x.name
    )
    return tier_1 + tier_2


def counts() -> dict[str, int]:
    return {
        "total": len(LANGUAGES),
        "machine_translated": sum(1 for lang in LANGUAGES if lang.tier is Tier.MACHINE),
        "requires_human_review": sum(
            1 for lang in LANGUAGES if lang.tier is Tier.REVIEW_REQUIRED
        ),
    }
