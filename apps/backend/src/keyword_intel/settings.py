from __future__ import annotations

import os
from dataclasses import dataclass


DEFAULT_DB_PATH = "creative_dna.db"
DB_PATH_ENV_KEYS = (
    "CREATIVE_DNA_DB_PATH",
    "KEYWORD_INTEL_DB_PATH",
)


@dataclass(frozen=True)
class Settings:
    db_path: str


def load_settings() -> Settings:
    for env_key in DB_PATH_ENV_KEYS:
        candidate = str(os.getenv(env_key, "")).strip()
        if candidate:
            return Settings(db_path=candidate)
    return Settings(db_path=DEFAULT_DB_PATH)
