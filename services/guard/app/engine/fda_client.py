"""openFDA drug label integration.

Two jobs:

  1. VERIFY. Confirm that a token the extractor guessed at is actually a drug
     before it is allowed to raise a finding. This is what keeps the false
     positive rate low enough for clinicians to keep trusting the panel.

  2. ENRICH. Pull the boxed warning, the interaction text, and the official
     dosage and administration section for every confirmed drug, so Guard can
     tell whether a warning the label considers mandatory survived the rewrite.

Rate limits, and why the cache exists: openFDA allows 240 requests per minute
per IP without a key, 240 per minute and 240,000 per day with one. A single
discharge summary can name a dozen drugs, and a busy ward generates hundreds of
rewrites an hour. Without caching, Guard becomes the bottleneck and then the
outage. Drug labels change on the order of months, so a long TTL costs nothing.

Failure posture: openFDA being unreachable is not a reason to pass a document.
`lookup` returns None on failure and the caller treats an unverifiable drug as
unverified, which downgrades the finding to a warning rather than suppressing
it. Guard never upgrades its own confidence because a dependency was down.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import Settings

logger = logging.getLogger(__name__)


@dataclass
class DrugLabel:
    """The subset of an openFDA label Guard actually uses."""

    query_name: str
    generic_names: list[str] = field(default_factory=list)
    brand_names: list[str] = field(default_factory=list)
    boxed_warning: str | None = None
    warnings: list[str] = field(default_factory=list)
    drug_interactions: list[str] = field(default_factory=list)
    dosage_and_administration: list[str] = field(default_factory=list)
    route: list[str] = field(default_factory=list)
    found: bool = True

    @property
    def has_boxed_warning(self) -> bool:
        return bool(self.boxed_warning)

    @property
    def all_names(self) -> set[str]:
        return {name.lower() for name in (self.generic_names + self.brand_names)}


@dataclass
class _CacheEntry:
    label: DrugLabel | None
    expires_at: float


class FDAClient:
    """Async openFDA client with an in-process TTL cache.

    The cache is per-process on purpose. A shared Redis would be the right call
    at multi-region scale, but it adds an operational dependency and a PHI
    adjacency review for data that is public, immutable, and cheap to refetch.
    Documented here so the tradeoff is a decision rather than an oversight.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.openfda_base_url,
            timeout=settings.openfda_timeout_seconds,
            headers={"User-Agent": "Smplixit-Guard/0.1"},
        )
        self._cache: dict[str, _CacheEntry] = {}
        # openFDA throttles by IP. Bound our own concurrency so a large batch
        # degrades into a queue rather than into a wall of 429s.
        self._semaphore = asyncio.Semaphore(settings.openfda_max_concurrency)

    async def aclose(self) -> None:
        await self._client.aclose()

    # --------------------------------------------------------------- lookups

    async def lookup(self, drug_name: str) -> DrugLabel | None:
        """Fetch one label. Returns None when openFDA could not be reached.

        A drug that openFDA does not know is a DrugLabel with found=False, which
        is a different thing from None and the caller must treat it differently.
        """
        key = drug_name.lower().strip()
        if not key:
            return None

        cached = self._cache.get(key)
        if cached and cached.expires_at > time.monotonic():
            return cached.label

        async with self._semaphore:
            try:
                label = await self._fetch(key)
            except Exception as exc:  # noqa: BLE001 - network boundary
                logger.warning("openFDA lookup failed for %s: %s", key, exc)
                return None

        self._cache[key] = _CacheEntry(
            label=label,
            expires_at=time.monotonic() + self._settings.openfda_cache_ttl_seconds,
        )
        return label

    async def lookup_many(self, drug_names: list[str]) -> dict[str, DrugLabel | None]:
        """Fetch several labels concurrently, bounded by the semaphore."""
        unique = sorted({name.lower().strip() for name in drug_names if name.strip()})
        labels = await asyncio.gather(*(self.lookup(name) for name in unique))
        return dict(zip(unique, labels, strict=True))

    @retry(
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _fetch(self, drug_name: str) -> DrugLabel:
        # Search generic and brand name fields together. A discharge summary
        # mixes both freely, often in the same sentence.
        escaped = drug_name.replace('"', "")
        query = (
            f'openfda.generic_name:"{escaped}"'
            f'+OR+openfda.brand_name:"{escaped}"'
            f'+OR+openfda.substance_name:"{escaped}"'
        )
        params: dict[str, str] = {"search": query, "limit": "1"}
        if self._settings.openfda_api_key:
            params["api_key"] = self._settings.openfda_api_key

        response = await self._client.get("/drug/label.json", params=params)

        # openFDA answers "no such drug" with 404 and a NOT_FOUND body. That is
        # a valid answer, not an error.
        if response.status_code == 404:
            return DrugLabel(query_name=drug_name, found=False)
        if response.status_code == 429:
            raise httpx.NetworkError("openFDA rate limit reached")
        response.raise_for_status()

        results = response.json().get("results", [])
        if not results:
            return DrugLabel(query_name=drug_name, found=False)

        return self._parse(drug_name, results[0])

    @staticmethod
    def _parse(query_name: str, record: dict) -> DrugLabel:
        openfda = record.get("openfda", {}) or {}

        def _section(key: str) -> list[str]:
            value = record.get(key, [])
            return [str(item).strip() for item in value if str(item).strip()]

        boxed = _section("boxed_warning")

        return DrugLabel(
            query_name=query_name,
            generic_names=[name.lower() for name in openfda.get("generic_name", [])],
            brand_names=[name.lower() for name in openfda.get("brand_name", [])],
            boxed_warning=boxed[0] if boxed else None,
            warnings=_section("warnings") or _section("warnings_and_cautions"),
            drug_interactions=_section("drug_interactions"),
            dosage_and_administration=_section("dosage_and_administration"),
            route=[route.lower() for route in openfda.get("route", [])],
        )

    # ------------------------------------------------------------ diagnostics

    def cache_stats(self) -> dict[str, int]:
        now = time.monotonic()
        live = sum(1 for entry in self._cache.values() if entry.expires_at > now)
        return {"entries": len(self._cache), "live": live}

    async def ping(self) -> bool:
        """Cheap reachability check for the readiness probe."""
        try:
            response = await self._client.get(
                "/drug/label.json",
                params={"search": 'openfda.generic_name:"aspirin"', "limit": "1"},
            )
            return response.status_code < 500
        except Exception:  # noqa: BLE001 - probe must never raise
            return False
