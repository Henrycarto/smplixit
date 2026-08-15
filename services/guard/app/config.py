"""Runtime configuration for Smplixit Guard."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    service_name: str = "smplixit-guard"
    environment: str = "local"
    log_level: str = "INFO"

    openfda_base_url: str = "https://api.fda.gov"
    # Optional. Without a key openFDA allows 240 requests per minute per IP.
    openfda_api_key: str = ""
    openfda_timeout_seconds: float = 20.0
    openfda_max_concurrency: int = 5
    # Drug labels change on the order of months. Six hours is conservative.
    openfda_cache_ttl_seconds: int = 21_600

    max_input_chars: int = 40_000
    # Results are held in memory for the console detail view. Production stores
    # them in Core's audit tables instead of here.
    result_cache_size: int = 500

    allowed_origins: str = "http://localhost:3000"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
