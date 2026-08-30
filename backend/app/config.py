"""Application configuration, loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Video source
    source_uri: str = ""

    # Detector
    detector: str = "mock"          # mock | yolo
    model_path: str = "models/belt_v1.pt"
    device: str = "auto"            # auto | mps | cuda | cpu
    conf_threshold: float = 0.35
    iou_threshold: float = 0.45
    img_size: int = 640

    # Pipeline
    enable_clahe: bool = True
    confirm_frames: int = 5
    max_stream_fps: int = 20
    loop_file_sources: bool = True

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def uploads_dir(self) -> Path:
        return BASE_DIR / "media" / "uploads"

    @property
    def snapshots_dir(self) -> Path:
        return BASE_DIR / "media" / "snapshots"

    @property
    def db_path(self) -> Path:
        return BASE_DIR / "data" / "conveyor.db"

    @property
    def model_file(self) -> Path:
        p = Path(self.model_path)
        return p if p.is_absolute() else BASE_DIR / p


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.uploads_dir.mkdir(parents=True, exist_ok=True)
    s.snapshots_dir.mkdir(parents=True, exist_ok=True)
    s.db_path.parent.mkdir(parents=True, exist_ok=True)
    return s


settings = get_settings()
