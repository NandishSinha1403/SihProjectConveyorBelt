"""Stream session: owns the source, the two threads, and the incident record.

Exactly one session runs at a time. Starting a new one tears down the old one
first, so a user switching from a test video to a live camera never ends up with
two pipelines fighting over the same slots.
"""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

import cv2

from ..bus import bus
from ..config import settings
from ..sources import FrameSource, SourceError, from_uri
from ..store.db import get_db
from .annotate import draw
from .capture import CaptureThread, LatestFrame
from .detector import Detector, build_detector
from .events import Incident, IncidentEngine
from .types import CLASS_LABELS, Detection, FrameResult

log = logging.getLogger(__name__)


class StreamSession:
    """A running pipeline over one source."""

    def __init__(self, uri: str) -> None:
        self.uri = uri
        self.raw = LatestFrame()
        self.annotated = LatestFrame()
        self.started_at = time.time()
        self.stopped_at: float | None = None
        self.error: str | None = None

        self._source: FrameSource | None = None
        self._capture: CaptureThread | None = None
        self._worker = None
        self._detector: Detector | None = None
        self._db_ids: dict[int, int] = {}   # in-memory incident id -> DB row id
        self._session_id: int | None = None
        self._lock = threading.Lock()

        self.incidents = IncidentEngine(
            confirm_frames=settings.confirm_frames,
            on_open=self._on_incident_open,
            on_update=self._on_incident_update,
            on_close=self._on_incident_close,
        )

    # -- lifecycle -----------------------------------------------------------

    def start(self) -> None:
        from .worker import InferenceWorker  # local import avoids a cycle

        source = from_uri(self.uri)
        info = source.open()          # raises SourceError; caller maps to HTTP 400
        self._source = source

        self._detector = build_detector()
        self._session_id = get_db().start_session(
            source_uri=info.uri, source_kind=info.kind, label=info.label,
            detector=self._detector.name,
        )

        self._capture = CaptureThread(source, self.raw, on_end=self._on_source_end)
        # No burned-in status block: the dashboard's telemetry strip already
        # carries source, frame rate and skip count, and printing them into the
        # frame as well both duplicates the information and covers the belt.
        self._worker = InferenceWorker(
            raw=self.raw,
            annotated=self.annotated,
            detector=self._detector,
            incidents=self.incidents,
            on_result=self._on_result,
        )
        self._capture.start()
        self._worker.start()

        log.info("Session started: %s (%s)", info.label, self._detector.description)
        bus.publish("stream.status", self.status())

    def stop(self) -> None:
        with self._lock:
            if self.stopped_at is not None:
                return
            self.stopped_at = time.time()

        if self._worker is not None:
            self._worker.stop()
        if self._capture is not None:
            self._capture.stop()
        # Join briefly: threads are daemons, so a stuck driver read cannot
        # prevent shutdown, but a clean join avoids a torn final frame.
        for t in (self._worker, self._capture):
            if t is not None and t.is_alive():
                t.join(timeout=2.0)
        if self._source is not None:
            self._source.close()

        self.incidents.reset()

        if self._session_id is not None:
            get_db().end_session(
                self._session_id,
                frames_read=self._capture.frames_read if self._capture else 0,
                frames_processed=self._worker.frames_processed if self._worker else 0,
                frames_skipped=self._worker.frames_skipped if self._worker else 0,
            )

        log.info("Session stopped: %s", self.uri)
        bus.publish("stream.status", self.status())

    @property
    def running(self) -> bool:
        return (self.stopped_at is None
                and self._capture is not None
                and self._capture.is_alive())

    # -- status --------------------------------------------------------------

    def status(self) -> dict:
        info = self._source.info if self._source is not None else None
        capture, worker = self._capture, self._worker
        return {
            "running": self.running,
            "uri": self.uri,
            "label": info.label if info else self.uri,
            "kind": info.kind if info else "unknown",
            "is_live": info.is_live if info else False,
            "source_fps": round(info.fps, 2) if info else 0.0,
            "width": info.width if info else 0,
            "height": info.height if info else 0,
            "detector": self._detector.description if self._detector else "none",
            "started_at": self.started_at,
            "stopped_at": self.stopped_at,
            "uptime": round((self.stopped_at or time.time()) - self.started_at, 1),
            "capture_fps": round(capture.fps, 2) if capture else 0.0,
            "inference_fps": round(worker.fps, 2) if worker else 0.0,
            "inference_ms": round(worker.inference_ms, 1) if worker else 0.0,
            "frames_read": capture.frames_read if capture else 0,
            "frames_processed": worker.frames_processed if worker else 0,
            "frames_skipped": worker.frames_skipped if worker else 0,
            "clahe": settings.enable_clahe,
            "open_incidents": len(self.incidents.open_incidents),
            "counts": dict(self.incidents.counts),
            "error": self.error,
        }

    def status_lines(self) -> list[str]:
        """Compact overlay text, for frames leaving the dashboard.

        Used when a still is exported or the stream is shown on a wall display
        with no surrounding HUD to give it context.
        """
        capture, worker = self._capture, self._worker
        label = self._source.info.label if self._source else self.uri
        if not (capture and worker):
            return [f"SRC {label}"]
        return [
            f"SRC {label}",
            f"CAP {capture.fps:5.1f} fps   INF {worker.fps:5.1f} fps   "
            f"SKIP {worker.frames_skipped}",
        ]

    # -- callbacks -----------------------------------------------------------

    def _on_result(self, result: FrameResult) -> None:
        bus.publish("frame", {
            "frame_id": result.frame_id,
            "timestamp": result.timestamp,
            "width": result.width,
            "height": result.height,
            "detections": [d.to_dict(result.width, result.height)
                           for d in result.detections],
            "inference_ms": round(result.inference_ms, 1),
            "stats": self.status(),
        })

    def _on_incident_open(self, incident: Incident, det: Detection) -> None:
        snapshot = self._save_snapshot(incident, det)
        incident.snapshot = snapshot
        try:
            self._db_ids[incident.id] = get_db().insert_incident(
                self._session_id, incident, snapshot)
        except Exception:  # noqa: BLE001 - never let a DB error kill the pipeline
            log.exception("Failed to persist incident %d", incident.id)
        bus.publish("incident.opened", incident.to_dict())

    def _on_incident_update(self, incident: Incident) -> None:
        row_id = self._db_ids.get(incident.id)
        if row_id is not None:
            try:
                get_db().update_incident(row_id, incident.severity.value,
                                         incident.label, incident.cls)
            except Exception:  # noqa: BLE001
                log.exception("Failed to update incident %d", incident.id)
        bus.publish("incident.updated", incident.to_dict())

    def _on_incident_close(self, incident: Incident) -> None:
        row_id = self._db_ids.pop(incident.id, None)
        if row_id is not None:
            try:
                get_db().close_incident(row_id, incident.closed_at or time.time(),
                                        incident.duration, incident.last_frame)
            except Exception:  # noqa: BLE001
                log.exception("Failed to close incident %d", incident.id)
        bus.publish("incident.closed", incident.to_dict())

    def _on_source_end(self, error: str | None) -> None:
        """Called from the capture thread when the source stops producing."""
        self.error = error
        bus.publish("stream.status", {**self.status(), "running": False,
                                      "ended": True, "error": error})

    def _save_snapshot(self, incident: Incident, det: Detection) -> str | None:
        """Persist a cropped-in still of the defect for the incident record."""
        frame = self.raw.get()
        if frame is None:
            return None
        try:
            image = draw(frame.image, [det])
            name = (f"incident_{int(incident.opened_at)}_{incident.id}_"
                    f"{incident.cls}.jpg")
            path: Path = settings.snapshots_dir / name
            cv2.imwrite(str(path), image, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            return name
        except Exception:  # noqa: BLE001
            log.exception("Failed to write snapshot for incident %d", incident.id)
            return None


class SessionManager:
    """Holds the single active session and serialises start/stop."""

    def __init__(self) -> None:
        self._session: StreamSession | None = None
        self._lock = threading.Lock()

    @property
    def session(self) -> StreamSession | None:
        return self._session

    def start(self, uri: str) -> StreamSession:
        """Switch to a new source, keeping the current one if the new one fails.

        The new session is opened *before* the old one is torn down. A mistyped
        RTSP URL or an unplugged camera then leaves live monitoring running,
        rather than taking down a working feed to replace it with nothing.
        """
        with self._lock:
            session = StreamSession(uri)
            try:
                session.start()
            except Exception:
                # Nothing was swapped in, so the existing session is untouched.
                session.stop()
                raise

            previous = self._session
            self._session = session
            if previous is not None:
                previous.stop()
            return session

    def stop(self) -> None:
        with self._lock:
            if self._session is not None:
                self._session.stop()
                self._session = None

    def status(self) -> dict:
        session = self._session
        if session is None:
            return {"running": False, "uri": None, "label": None,
                    "detector": None, "counts": {}, "frames_skipped": 0,
                    "capture_fps": 0.0, "inference_fps": 0.0}
        return session.status()


manager = SessionManager()
