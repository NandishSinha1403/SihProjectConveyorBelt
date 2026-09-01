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
    # CLAHE is applied to the frame handed to the detector, but nothing in
    # training/ applies it -- so enabling it trains on raw pixels and serves
    # enhanced ones. Measured with belt_v1.pt on this project's own footage:
    # 58 detections over 150 frames with it off against 7 with it on, and
    # 95.6 ms per frame against 140.9 ms. Off by default until the training
    # pipeline applies the same enhancement; the knob stays because the
    # reasoning behind it is sound (Guo et al. sec 4.1 on dust) and it becomes
    # correct the moment training matches.
    enable_clahe: bool = False
    confirm_frames: int = 5
    # Below this, a detection still renders on the live stream but is never
    # promoted into an incident.
    incident_confidence_threshold: float = 0.50
    # Cap on the MJPEG output rate. At 20 this was the pipeline's bottleneck:
    # capture and inference both ran at 29.9 fps while only 19.0 fps reached the
    # browser. Measured delivery against this value on a 30 fps camera --
    # 20 -> 19.0 fps, 30 -> 27.8 fps, 60 -> 30.4 fps -- so 30 tracks a standard
    # camera and anything above it only buys bandwidth (1.0 MB/s -> 2.0 MB/s).
    max_stream_fps: int = 30
    loop_file_sources: bool = True

    # Persistence (Supabase)
    # Use the transaction pooler host (port 6543): Render's free tier is
    # IPv4-only and Supabase's direct 5432 host resolves to IPv6 only.
    database_url: str = ""
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_bucket: str = "snapshots"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Vercel builds a fresh preview domain per deployment, so an allow-list
    # cannot name them all. This regex is matched in addition to the list.
    cors_origin_regex: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def uploads_dir(self) -> Path:
        return BASE_DIR / "media" / "uploads"

    @property
    def model_file(self) -> Path:
        p = Path(self.model_path)
        return p if p.is_absolute() else BASE_DIR / p


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.uploads_dir.mkdir(parents=True, exist_ok=True)
    return s


settings = get_settings()
