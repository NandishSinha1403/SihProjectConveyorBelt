"""The inference thread.

Reads whatever frame is current, runs the detector, and writes an annotated
frame back out. Crucially it does *not* consume a queue: between two iterations
the capture thread may have produced ten frames, and nine of them are simply
never seen. ``frames_skipped`` records exactly how many, and the dashboard
displays it -- it is the visible proof that this is real-time processing of a
live feed rather than batch processing of a file.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable

from ..config import settings
from .annotate import draw, draw_status
from .capture import LatestFrame
from .detector import Detector
from .events import IncidentEngine
from .preprocess import enhance
from .types import FrameResult

log = logging.getLogger(__name__)

# Cap on how often per-frame detection payloads go out over the WebSocket. The
# UI cannot usefully render faster than this and the bandwidth is wasted.
EVENT_HZ = 10.0


class InferenceWorker(threading.Thread):
    def __init__(
        self,
        raw: LatestFrame,
        annotated: LatestFrame,
        detector: Detector,
        incidents: IncidentEngine,
        on_result: Callable[[FrameResult], None] | None = None,
        status_lines: Callable[[], list[str]] | None = None,
    ) -> None:
        super().__init__(name="inference", daemon=True)
        self._raw = raw
        self._annotated = annotated
        self._detector = detector
        self._incidents = incidents
        self._on_result = on_result
        self._status_lines = status_lines
        self._stop = threading.Event()

        self.frames_processed = 0
        self.frames_skipped = 0
        self.fps = 0.0
        self.inference_ms = 0.0
        self.last_result: FrameResult | None = None

        self._last_frame_id = 0
        self._last_event = 0.0
        self._fps_window: list[float] = []

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        log.info("Inference worker started (%s)", self._detector.description)
        self._detector.reset()
        self._incidents.reset()

        while not self._stop.is_set():
            frame = self._raw.wait_for_new(self._last_frame_id, timeout=0.5)
            if frame is None:
                continue  # timed out; loop back and re-check the stop flag

            # Everything between the last processed id and this one went past
            # unseen -- exactly as frames would with a physical camera.
            self.frames_skipped += max(0, frame.id - self._last_frame_id - 1)
            self._last_frame_id = frame.id

            try:
                self._process(frame)
            except Exception:  # noqa: BLE001 - one bad frame must not kill the stream
                log.exception("Inference failed on frame %d", frame.id)

        log.info("Inference worker stopped after %d frames (%d skipped)",
                 self.frames_processed, self.frames_skipped)

    def _process(self, frame) -> None:
        image = frame.image
        h, w = image.shape[:2]

        started = time.perf_counter()
        source = enhance(image) if settings.enable_clahe else image
        detections = self._detector.detect(source)
        self.inference_ms = (time.perf_counter() - started) * 1000.0

        detections = self._incidents.process(detections, frame.id, w, h)

        self.frames_processed += 1
        self._tick_fps()

        result = FrameResult(
            frame_id=frame.id,
            timestamp=frame.timestamp,
            width=w,
            height=h,
            detections=detections,
            inference_ms=self.inference_ms,
            frames_skipped=self.frames_skipped,
        )
        self.last_result = result

        overlay = draw(image, detections)
        if self._status_lines is not None:
            draw_status(overlay, self._status_lines())
        self._annotated.set(overlay, frame.id, frame.timestamp)

        now = time.monotonic()
        if self._on_result is not None and now - self._last_event >= 1.0 / EVENT_HZ:
            self._last_event = now
            self._on_result(result)

    def _tick_fps(self) -> None:
        now = time.monotonic()
        self._fps_window.append(now)
        cutoff = now - 2.0
        while self._fps_window and self._fps_window[0] < cutoff:
            self._fps_window.pop(0)
        span = self._fps_window[-1] - self._fps_window[0]
        self.fps = (len(self._fps_window) - 1) / span if span > 0 else 0.0
