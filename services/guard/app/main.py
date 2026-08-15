"""Smplixit Guard service entrypoint."""

from __future__ import annotations

import logging
from collections import OrderedDict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.config import get_settings
from app.engine.fda_client import FDAClient
from app.routers import validate

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.fda = FDAClient(settings)
    # Recent verdicts for the console detail drawer. Bounded, and not the
    # durable record: Core's audit tables are.
    app.state.results = OrderedDict()

    logger.info(
        "%s %s ready, openFDA at %s, api key %s",
        settings.service_name,
        __version__,
        settings.openfda_base_url,
        "configured" if settings.openfda_api_key else "not set (240 req/min limit)",
    )
    try:
        yield
    finally:
        await app.state.fda.aclose()


app = FastAPI(
    title="Smplixit Guard",
    description=(
        "Cross-references rewritten patient instructions against openFDA drug "
        "label data to prove no medication instruction was lost or distorted."
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

app.include_router(validate.router)


@app.get("/health", tags=["ops"])
async def health() -> dict[str, object]:
    """Liveness only. Does not call openFDA, so a third-party outage cannot
    cause the orchestrator to restart a healthy container."""
    return {
        "status": "ok",
        "service": settings.service_name,
        "version": __version__,
        "environment": settings.environment,
        "cache": app.state.fda.cache_stats() if hasattr(app.state, "fda") else {},
    }


@app.get("/ready", tags=["ops"])
async def ready() -> JSONResponse:
    """Readiness, including a real openFDA reachability check.

    Reported as degraded rather than down. Guard still validates without
    openFDA: findings are downgraded from critical to warning and the response
    carries fda_available=false, which Core surfaces to the clinician.
    """
    reachable = await app.state.fda.ping()
    return JSONResponse(
        status_code=200,
        content={
            "service": settings.service_name,
            "openfda_reachable": reachable,
            "mode": "full" if reachable else "degraded",
        },
    )
