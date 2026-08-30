"""Uploaded-video source, played back as if it were a live camera.

This is the heart of the "simulate a camera" requirement. The file lives on the
server, but the pipeline is fed from it one frame at a time on a wall-clock
schedule matching the video's native frame rate. The detector gets no lookahead
and no ability to seek -- a 60-second video takes 60 seconds to process, and if
inference cannot keep up, frames go past unseen exactly as they would with a
real camera.

Pacing lives here rather than in the capture thread so that each source
self-describes its own timing: live sources block on the driver, file sources
block on the clock.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import cv2
import numpy as np

from .base import FrameSource, SourceError, SourceInfo

log = logging.getLogger(__name__)

DEFAULT_FPS = 25.0


class FileSource(FrameSource):
    def __init__(self, path: Path, loop: bool = True) -> None:
        self._path = path
        self._loop = loop
        self._cap: cv2.VideoCapture | None = None
        self._info: SourceInfo | None = None
        self._next_deadline: float = 0.0
        self._frame_interval: float = 1.0 / DEFAULT_FPS

    def open(self) -> SourceInfo:
        if not self._path.exists():
            raise SourceError(f"Video file not found: {self._path}")

        cap = cv2.VideoCapture(str(self._path))
        if not cap.isOpened():
            raise SourceError(f"Could not open video file: {self._path.name}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        # Some containers report 0 or absurd values; fall back to a sane default
        # rather than spinning the capture thread at maximum speed.
        if not fps or fps <= 0 or fps > 240:
            log.warning("Video %s reports fps=%s; defaulting to %s",
                        self._path.name, fps, DEFAULT_FPS)
            fps = DEFAULT_FPS

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

        self._cap = cap
        self._frame_interval = 1.0 / fps
        self._next_deadline = time.monotonic()
        self._info = SourceInfo(
            uri=f"file://{self._path}",
            kind="file",
            label=self._path.name,
            fps=fps,
            width=width,
            height=height,
            is_live=False,
            frame_count=frame_count,
        )
        log.info("Opened file source %s (%dx%d @ %.2f fps, %d frames)",
                 self._path.name, width, height, fps, frame_count)
        return self._info

    def read(self) -> np.ndarray | None:
        cap = self._cap
        if cap is None:
            return None

        # Sleep until this frame is due. The deadline advances by exactly one
        # frame interval each time, so playback tracks the wall clock without
        # accumulating drift from decode time.
        now = time.monotonic()
        delay = self._next_deadline - now
        if delay > 0:
            time.sleep(delay)
        self._next_deadline += self._frame_interval

        # If we have fallen more than a second behind (a slow decode, or the
        # process was descheduled), resynchronise rather than sprinting to catch
        # up -- a burst of frames would defeat the point of real-time pacing.
        if time.monotonic() - self._next_deadline > 1.0:
            log.debug("File source fell behind; resynchronising clock")
            self._next_deadline = time.monotonic() + self._frame_interval

        ok, frame = cap.read()
        if ok:
            return frame

        if self._loop:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = cap.read()
            if ok:
                return frame
        return None

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    @property
    def info(self) -> SourceInfo:
        if self._info is None:
            raise SourceError("Source has not been opened")
        return self._info
