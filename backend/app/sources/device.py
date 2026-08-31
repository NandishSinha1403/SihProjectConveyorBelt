"""Locally attached camera (laptop webcam, USB industrial camera)."""
from __future__ import annotations

import glob
import logging
import os
import sys

# macOS gates camera access behind AVFoundation, and OpenCV can only raise the
# permission prompt from the process main thread. We open cameras from the
# capture thread and from request handlers, so leaving the prompt enabled makes
# OpenCV abort with "can not spin main run loop from other thread" and the
# camera silently never appears. Skipping the prompt means access succeeds
# whenever the host terminal already holds camera permission, and fails
# cleanly (with the guidance below) when it does not.
# Must be set before cv2 is imported.
if sys.platform == "darwin":
    os.environ.setdefault("OPENCV_AVFOUNDATION_SKIP_AUTH", "1")

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from .base import FrameSource, SourceError, SourceInfo

log = logging.getLogger(__name__)

PERMISSION_HINT = (
    "On macOS, grant camera access to the terminal running the backend under "
    "System Settings > Privacy & Security > Camera, then restart it. "
    "Run `python scripts/grant_camera_access.py` to raise the prompt."
    if sys.platform == "darwin"
    else "Check that the device exists and is not in use by another application."
)


class DeviceSource(FrameSource):
    def __init__(self, index: int = 0, width: int = 1280, height: int = 720) -> None:
        self._index = index
        self._requested = (width, height)
        self._cap: cv2.VideoCapture | None = None
        self._info: SourceInfo | None = None

    def open(self) -> SourceInfo:
        cap = cv2.VideoCapture(self._index)
        if not cap.isOpened():
            cap.release()
            raise SourceError(
                f"Could not open camera device {self._index}. {PERMISSION_HINT}"
            )

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._requested[0])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._requested[1])
        # Keep the driver's internal buffer to a single frame so read() always
        # returns what the camera is seeing *now* rather than a stale backlog.
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        fps = cap.get(cv2.CAP_PROP_FPS)
        if not fps or fps <= 0 or fps > 240:
            fps = 30.0

        self._cap = cap
        self._info = SourceInfo(
            uri=f"device://{self._index}",
            kind="device",
            label=f"Camera {self._index}",
            fps=fps,
            width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            is_live=True,
        )
        log.info("Opened device source %s", self._info)
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


def probe_devices(max_index: int = 5) -> list[dict]:
    """Enumerate attached cameras so the UI can offer them in a dropdown.

    OpenCV has no portable device enumeration, so we open each index briefly and
    keep the ones that yield a frame.

    On a cloud host there are no video devices at all, and probing six absent
    indices wastes seconds on every call for a guaranteed empty list. If the
    platform exposes no /dev/video* nodes, say so immediately.
    """
    if sys.platform.startswith("linux") and not glob.glob("/dev/video*"):
        log.info("No video devices present; skipping camera probe")
        return []

    found: list[dict] = []
    for idx in range(max_index + 1):
        cap = cv2.VideoCapture(idx)
        try:
            if cap.isOpened():
                ok, frame = cap.read()
                if ok and frame is not None:
                    found.append({
                        "index": idx,
                        "uri": f"device://{idx}",
                        "label": f"Camera {idx}",
                        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                    })
        except Exception:  # noqa: BLE001 - probing must never take the API down
            log.debug("Probe failed for device index %d", idx, exc_info=True)
        finally:
            cap.release()
    return found
