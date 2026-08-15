"""Persistence for rewrite jobs and the audit trail.

Two tables:

  rewrite_jobs   one row per simplification request, holding the source text,
                 the released text, both measured reading levels, and the Guard
                 verdict. This is what the dashboard reads.

  audit_events   append-only. One row per state change on a job, including every
                 rejected rewrite attempt. Nothing in this table is ever updated
                 or deleted. A hospital's compliance officer needs to be able to
                 reconstruct exactly what was shown to a patient and why.

Retention is a customer policy decision and is enforced by a scheduled job, not
by the application. See docs/architecture.md.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import Settings


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _new_id() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class RewriteJob(Base):
    __tablename__ = "rewrite_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    status: Mapped[str] = mapped_column(String(32), index=True)

    patient_id: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    encounter_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    clinician_id: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)

    original_text: Mapped[str] = mapped_column(Text)
    simplified_text: Mapped[str] = mapped_column(Text)

    target_grade: Mapped[int] = mapped_column(Integer)
    original_smog: Mapped[float] = mapped_column(Float)
    original_flesch_kincaid: Mapped[float] = mapped_column(Float)
    original_grade: Mapped[float] = mapped_column(Float)
    simplified_smog: Mapped[float] = mapped_column(Float)
    simplified_flesch_kincaid: Mapped[float] = mapped_column(Float)
    simplified_grade: Mapped[float] = mapped_column(Float)

    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    safety_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    guard_passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    review_reasons: Mapped[list] = mapped_column(JSON, default=list)

    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )


class AuditEvent(Base):
    """Append-only. No update path exists on this model by design."""

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    job_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("rewrite_jobs.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    actor: Mapped[str | None] = mapped_column(String(128), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Database:
    """Thin lifecycle wrapper so main.py does not touch SQLAlchemy directly."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._engine = create_async_engine(
            settings.database_url,
            echo=settings.db_echo,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=5,
        )
        self._sessionmaker = async_sessionmaker(self._engine, expire_on_commit=False)

    @property
    def sessionmaker(self) -> async_sessionmaker[AsyncSession]:
        return self._sessionmaker

    async def create_all(self) -> None:
        """Local dev convenience. Production schema changes go through migrations."""
        async with self._engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def dispose(self) -> None:
        await self._engine.dispose()
