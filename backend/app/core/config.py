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
    max_upload_mb: int = 20

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


class RetrievalSettings(BaseSettings):
    """Retrieval settings. Override with PAPERCAST_RETRIEVAL_<KEY>."""

    model_config = SettingsConfigDict(
        env_prefix="PAPERCAST_RETRIEVAL_", env_file=".env", extra="ignore"
    )

    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_query_prefix: str = ""
    embedding_batch_size: int = 32
    embedding_device: str = "cpu"

    k: int = 5  # passages per query (workbook Table 7.4)
    candidates: int = 50  # results taken from each of dense and lexical search
    dense_weight: float = 0.7  # lexical weight is 1 minus this
    section_filter: bool = True
    floor: float = 0.10  # candidates below this fused score are dropped
    dedup_threshold: float = 0.9  # word-set Jaccard
    exclude_sections: list[str] = ["references", "bibliography"]
    bm25_k1: float = 1.5
    bm25_b: float = 0.75
    cache_size: int = 8  # indexes kept in memory
    index_root: Path = BASE_DIR / "data" / "indexes"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings


@lru_cache
def get_retrieval_settings() -> RetrievalSettings:
    return RetrievalSettings()
