"""Runtime configuration for Smplixit Poly."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    service_name: str = "smplixit-poly"
    environment: str = "local"
    log_level: str = "INFO"

    deepl_api_key: str = "unset"
    # Free tier keys only work against the free host. Sending a free key to the
    # pro host returns 403, which reads like a bad key and wastes an hour.
    deepl_api_host: str = "https://api-free.deepl.com"
    deepl_timeout_seconds: float = 60.0
    # Optional account glossary, applied on top of the ignore-tag protection.
    deepl_glossary_id: str | None = None

    # A translation that loses a protected term is never returned as releasable.
    fail_on_lost_terms: bool = True

    max_input_chars: int = 40_000
    max_batch_targets: int = 12

    allowed_origins: str = "http://localhost:3000"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
