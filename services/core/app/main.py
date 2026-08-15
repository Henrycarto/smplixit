"""Smplixit Core service entrypoint."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.config import get_settings
from app.db import Database
from app.routers import simplify
from app.schemas import ErrorResponse

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Build the long-lived clients once per process.

    The rewrite engine holds pooled HTTP connections to the model provider and
    to Guard. Constructing it per request would add a TLS handshake to every
    rewrite and exhaust the connection pool under load.
    """
    from app.engine.rewriter import RewriteEngine

    app.state.engine = RewriteEngine(settings)

    database: Database | None = None
    try:
        database = Database(settings)
        if settings.db_auto_create:
            await database.create_all()
    except Exception:  # noqa: BLE001 - the service is useful without history
        logger.exception("database unavailable, continuing without job history")
        database = None
    app.state.database = database

    logger.info(
        "%s %s ready, target grade %s, guard at %s",
        settings.service_name,
        __version__,
        settings.default_target_grade,
        settings.guard_service_url,
    )

    try:
        yield
    finally:
        await app.state.engine.aclose()
        if app.state.database is not None:
            await app.state.database.dispose()


app = FastAPI(
    title="Smplixit Core",
    description=(
        "Rewrites clinical discharge summaries to a target reading grade and "
        "measures the result with SMOG and Flesch-Kincaid."
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

app.include_router(simplify.router)


@app.get("/health", tags=["ops"])
async def health() -> dict[str, object]:
    """Liveness probe. Intentionally cheap: no model call, no database round trip."""
    return {
        "status": "ok",
        "service": settings.service_name,
        "version": __version__,
        "environment": settings.environment,
        "default_target_grade": settings.default_target_grade,
        "persistence": getattr(app.state, "database", None) is not None,
    }


@app.get("/ready", tags=["ops"])
async def ready() -> JSONResponse:
    """Readiness probe. Reports dependency state without failing the container.

    Guard being down is reported here so the load balancer and the on-call
    dashboard can see it, but Core still serves: a rewrite simply comes back as
    needs_review instead of completed.
    """
    engine_ready = getattr(app.state, "engine", None) is not None
    payload = {
        "engine": engine_ready,
        "persistence": getattr(app.state, "database", None) is not None,
    }
    code = 200 if engine_ready else 503
    return JSONResponse(status_code=code, content=payload)


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=ErrorResponse(error="invalid_input", detail=str(exc)).model_dump(),
    )
