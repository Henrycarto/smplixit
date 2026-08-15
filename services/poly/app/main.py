"""Smplixit Poly service entrypoint."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import get_settings
from app.engine import language_registry
from app.engine.deepl_client import DeepLClient
from app.routers import translate

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.deepl = DeepLClient(settings)
    counts = language_registry.counts()
    logger.info(
        "%s %s ready, %s languages (%s machine translated, %s review required)",
        settings.service_name,
        __version__,
        counts["total"],
        counts["machine_translated"],
        counts["requires_human_review"],
    )
    try:
        yield
    finally:
        await app.state.deepl.aclose()


app = FastAPI(
    title="Smplixit Poly",
    description=(
        "Translates simplified patient instructions while holding medication "
        "names, dosages, and numbers byte-for-byte."
    ),
    version=__version__,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(translate.router)


@app.get("/health", tags=["ops"])
async def health() -> dict[str, object]:
    counts = language_registry.counts()
    return {
        "status": "ok",
        "service": settings.service_name,
        "version": __version__,
        "environment": settings.environment,
        "languages": counts,
    }
