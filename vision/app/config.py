"""Load the FastAPI vision settings. Never log secret values."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def load_local_env() -> None:
    """Fill missing variables from vision/.env. Existing process values win."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


@dataclass(frozen=True)
class Settings:
    api_key: str
    model_id: str
    base_url: str

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.model_id and self.base_url)

    @property
    def base_host(self) -> str:
        remainder = self.base_url.split("://", 1)[-1]
        return remainder.split("/", 1)[0]


def read_settings() -> Settings:
    load_local_env()
    return Settings(
        api_key=os.environ.get("NEBIUS_API_KEY", "").strip(),
        model_id=os.environ.get("NEBIUS_MODEL_ID", "").strip(),
        base_url=os.environ.get("NEBIUS_BASE_URL", "").strip().rstrip("/"),
    )
