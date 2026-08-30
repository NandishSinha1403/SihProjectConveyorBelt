"""Frame capture: a single-slot buffer and the thread that fills it.

The whole real-time guarantee rests on :class:`LatestFrame`. It holds exactly
one frame. Writers overwrite unconditionally; readers take whatever is current.
Because there is no queue, a backlog can never form: if the detector is slower
than the source, frames are *dropped*, exactly as they would be with a physical
camera. That is what makes an uploaded video an honest stand-in for a live feed.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass

import numpy as np

from ..sources.base import FrameSource, SourceError

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Frame:
    id: int
    timestamp: float
    image: np.ndarray


class LatestFrame:
    """A one-deep, lock-guarded frame slot with a wait-for-new primitive."""

    def __init__(self) -> None:
        self._frame: Frame | None = None
        self._cond = threading.Condition()

    def set(self, image: np.ndarray, frame_id: int, timestamp: float | None = None) -> None:
        with self._cond:
            self._frame = Frame(frame_id, timestamp or time.time(), image)
            self._cond.notify_all()

    def get(self) -> Frame | None:
        with self._cond:
            return self._frame

    def wait_for_new(self, last_id: int, timeout: float = 1.0) -> Frame | None:
        """Block until a frame newer than ``last_id`` is available.

        Returns None on timeout so callers can re-check their stop flags rather
        than blocking forever on a dead source.
        """
        deadline = time.monotonic() + timeout
        with self._cond:
            while self._frame is None or self._frame.id <= last_id:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._cond.wait(remaining)
            return self._frame

    def clear(self) -> None:
        with self._cond:
            self._frame = None


class CaptureThread(threading.Thread):
    """Pulls frames from a FrameSource into a LatestFrame slot, forever.

    The thread itself does no pacing: file sources block on the clock inside
    their own ``read()``, live sources block on the camera driver. Either way
    this loop runs at the source's true rate.
    """

    def __init__(self, source: FrameSource, slot: LatestFrame,
                 on_end: callable | None = None) -> None:
        super().__init__(name="capture", daemon=True)
        self._source = source
        self._slot = slot
        self._on_end = on_end
        self._stop = threading.Event()

        self.frames_read = 0
        self.fps = 0.0
        self.error: str | None = None
        self._fps_window: list[float] = []

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        log.info("Capture thread started for %s", self._source.info.label)
        consecutive_failures = 0
        try:
            while not self._stop.is_set():
                try:
                    frame = self._source.read()
                except SourceError as exc:
                    self.error = str(exc)
                    log.error("Capture failed: %s", exc)
                    break

                if frame is None:
                    consecutive_failures += 1
                    # A live camera can hiccup; tolerate a short gap before
                    # declaring the source dead. A file source that returns
                    # None has genuinely ended (looping is handled internally).
                    if not self._source.info.is_live or consecutive_failures > 30:
                        log.info("Source %s ended", self._source.info.label)
                        break
                    time.sleep(0.05)
                    continue

                consecutive_failures = 0
                self.frames_read += 1
                self._slot.set(frame, self.frames_read)
                self._tick_fps()
        finally:
            self._source.close()
            log.info("Capture thread stopped after %d frames", self.frames_read)
            if self._on_end is not None:
                try:
                    self._on_end(self.error)
                except Exception:  # noqa: BLE001
                    log.debug("Capture on_end callback failed", exc_info=True)

    def _tick_fps(self) -> None:
        """Rolling FPS over the last ~2 seconds of arrivals."""
        now = time.monotonic()
        self._fps_window.append(now)
        cutoff = now - 2.0
        while self._fps_window and self._fps_window[0] < cutoff:
            self._fps_window.pop(0)
        span = self._fps_window[-1] - self._fps_window[0]
        self.fps = (len(self._fps_window) - 1) / span if span > 0 else 0.0
