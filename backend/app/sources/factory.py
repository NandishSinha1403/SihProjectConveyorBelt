"""URI -> FrameSource resolution. The single seam for camera integration.

Adding support for a new camera family means writing one class that implements
FrameSource and adding one branch here. Nothing else in the codebase changes.
See docs/CAMERA_INTEGRATION.md.
"""
from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

from ..config import BASE_DIR, settings
from .base import FrameSource, SourceError
from .device import DeviceSource
from .file import FileSource
from .network import HttpMjpegSource, RtspSource

__all__ = ["from_uri", "SourceError", "describe_uri"]


def from_uri(uri: str) -> FrameSource:
    """Build the appropriate FrameSource for a source URI.

    Supported forms:
        file://media/uploads/belt.mp4     uploaded test video (camera-paced)
        /absolute/path/to/belt.mp4        bare path, treated as a file
        device://0                        local webcam / USB camera
        rtsp://user:pass@host:554/stream  IP / PoE camera
        http://host/mjpg/video.mjpg       MJPEG-over-HTTP camera
    """
    uri = (uri or "").strip()
    if not uri:
        raise SourceError("No source URI configured")

    parsed = urlparse(uri)
    scheme = parsed.scheme.lower()

    if scheme == "device":
        raw = (parsed.netloc or parsed.path.lstrip("/")).strip()
        try:
            index = int(raw)
        except ValueError as exc:
            raise SourceError(f"Invalid camera index in {uri!r}") from exc
        return DeviceSource(index)

    if scheme == "rtsp":
        return RtspSource(uri)

    if scheme in ("http", "https"):
        return HttpMjpegSource(uri)

    if scheme == "file":
        # file://media/uploads/x.mp4 puts "media" in netloc; rejoin the two.
        raw = f"{parsed.netloc}{parsed.path}" if parsed.netloc else parsed.path
        return FileSource(_resolve_media_path(raw), loop=settings.loop_file_sources)

    if not scheme:  # bare filesystem path
        return FileSource(_resolve_media_path(uri), loop=settings.loop_file_sources)

    raise SourceError(f"Unsupported source scheme: {scheme!r}")


def describe_uri(uri: str) -> str:
    """Human-readable label for a URI, with any credentials stripped."""
    parsed = urlparse((uri or "").strip())
    if parsed.scheme in ("rtsp", "http", "https") and "@" in uri:
        _, _, host = uri.rpartition("@")
        return f"{parsed.scheme}://***@{host}"
    if parsed.scheme == "device":
        return f"Camera {parsed.netloc or parsed.path.lstrip('/')}"
    if parsed.scheme == "file" or not parsed.scheme:
        return Path(uri).name
    return uri


def _resolve_media_path(raw: str) -> Path:
    """Resolve a file path and refuse anything outside the backend directory.

    Source URIs can arrive from the API, so a traversal like
    ``file://../../etc/passwd`` must not be able to point the pipeline at an
    arbitrary file on disk.
    """
    path = Path(raw).expanduser()
    resolved = (path if path.is_absolute() else BASE_DIR / path).resolve()
    if not resolved.is_relative_to(BASE_DIR.resolve()):
        raise SourceError("Source path is outside the application directory")
    return resolved
