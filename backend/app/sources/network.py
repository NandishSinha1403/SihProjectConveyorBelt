"""Network cameras: RTSP (IP/PoE) and MJPEG-over-HTTP.

Both are handled by OpenCV's FFmpeg backend and differ only in how they are
labelled, but they are kept as separate classes so that RTSP-specific tuning
(transport, latency, reconnect policy) has somewhere obvious to live.
"""
from __future__ import annotations

import logging
import os

import cv2
import numpy as np

from .base import FrameSource, SourceError, SourceInfo

log = logging.getLogger(__name__)

# Prefer TCP for RTSP: on a noisy industrial network UDP packet loss produces
# smeared frames that generate phantom detections.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")


class NetworkSource(FrameSource):
    kind = "rtsp"

    def __init__(self, url: str) -> None:
        self._url = url
        self._cap: cv2.VideoCapture | None = None
        self._info: SourceInfo | None = None

    def open(self) -> SourceInfo:
        cap = cv2.VideoCapture(self._url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            cap.release()
            raise SourceError(f"Could not connect to stream: {self._redacted_url}")

        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not fps or fps <= 0 or fps > 240:
            fps = 25.0

        self._cap = cap
        self._info = SourceInfo(
            uri=self._url,
            kind=self.kind,
            label=self._redacted_url,
            fps=fps,
            width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            is_live=True,
        )
        log.info("Opened %s source %s", self.kind, self._redacted_url)
        return self._info

    def read(self) -> np.ndarray | None:
        if self._cap is None:
            return None
        ok, frame = self._cap.read()
        return frame if ok else None

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    @property
    def info(self) -> SourceInfo:
        if self._info is None:
            raise SourceError("Source has not been opened")
        return self._info

    @property
    def _redacted_url(self) -> str:
        """Strip embedded credentials before the URL reaches a log or the UI."""
        if "@" not in self._url:
            return self._url
        scheme, _, rest = self._url.partition("://")
        _, _, host = rest.rpartition("@")
        return f"{scheme}://***@{host}"


class RtspSource(NetworkSource):
    kind = "rtsp"


class HttpMjpegSource(NetworkSource):
    kind = "http"
