"""Application configuration.

Settings load from environment variables (and an optional `.env` file). Never
hard-code secrets — see `.env.example`. (NFR-6: secrets stay out of source.)
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "PaperCast"
    environment: str = "development"

    # Where uploads and generated artifacts land during local dev.
    storage_dir: Path = BASE_DIR / "storage"
    data_dir: Path = BASE_DIR / "data"

    # CORS origins for the Next.js dev server.
    cors_origins: list[str] = ["http://localhost:3000"]

    # Placeholders for real services — wired up per-feature later.
    redis_url: str = "redis://localhost:6379/0"
    database_url: str = "sqlite:///./data/papercast.db"

    # Model/provider keys live in the environment, not here.
    llm_api_key: str = ""
    tts_api_key: str = ""

    def ensure_dirs(self) -> None:
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.data_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings
