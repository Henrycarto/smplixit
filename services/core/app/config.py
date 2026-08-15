"""Runtime configuration for Smplixit Core.

Everything is environment driven so the same image runs in local Docker and in
ECS Fargate with no code change. Defaults are chosen to be safe in local dev,
never to be silently correct in production.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Service identity
    service_name: str = "smplixit-core"
    environment: str = "local"
    log_level: str = "INFO"

    # OpenAI
    openai_api_key: str = "unset"
    openai_model: str = "gpt-4o"
    openai_timeout_seconds: float = 90.0
    # Low temperature: clinical rewriting is a precision task, not a creative one.
    openai_temperature: float = 0.2

    # Rewrite policy
    default_target_grade: int = 6
    # Grades below 3 produce output that reads as condescending to adults and
    # tends to drop necessary clinical nouns. Grades above 12 defeat the point.
    min_target_grade: int = 3
    max_target_grade: int = 12
    max_rewrite_attempts: int = 3
    # A rewrite is accepted if both scores land within this many grades of target.
    grade_tolerance: float = 0.5
    max_input_chars: int = 40_000

    # Guard integration
    guard_service_url: str = "http://localhost:8003"
    guard_timeout_seconds: float = 30.0
    # If Guard is unreachable, a rewrite is returned as needs_review rather than
    # released. Fail closed: an unvalidated instruction sheet is a liability.
    guard_required: bool = True

    # Persistence
    database_url: str = "postgresql+asyncpg://smplixit:smplixit@localhost:5432/smplixit"
    db_echo: bool = False
    # Local dev convenience. Production uses migrations, not create_all.
    db_auto_create: bool = True

    # CORS
    allowed_origins: str = "http://localhost:3000"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
