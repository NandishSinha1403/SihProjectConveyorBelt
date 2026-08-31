"""Tests for the real-time guarantees of the capture pipeline.

The central claim of this system is that an uploaded video is processed the way
a live camera would be: paced by the wall clock, with no lookahead, and with
frames dropped rather than queued when inference cannot keep up. These tests
exist because that claim is easy to break with an innocuous-looking change
(swapping the frame slot for a queue would do it) and impossible to notice by
eye.

    python -m pytest tests/ -v
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.pipeline.capture import CaptureThread, LatestFrame  # noqa: E402
from app.pipeline.detector import Detector, MockDetector  # noqa: E402
from app.pipeline.events import IncidentEngine, assess_joints, score_severity  # noqa: E402
from app.pipeline.types import Detection, Severity  # noqa: E402
from app.sources.base import FrameSource, SourceInfo  # noqa: E402


class FakeSource(FrameSource):
    """A synthetic source that emits frames at a fixed rate, like a file would."""

    def __init__(self, fps: float, total: int) -> None:
        self._fps, self._total = fps, total
        self._n = 0
        self._next = 0.0

    def open(self) -> SourceInfo:
        self._next = time.monotonic()
        return self.info

    def read(self):
        if self._n >= self._total:
            return None
        delay = self._next - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        self._next += 1.0 / self._fps
        self._n += 1
        return np.zeros((64, 64, 3), dtype=np.uint8)

    def close(self) -> None:
        pass

    @property
    def info(self) -> SourceInfo:
        return SourceInfo(uri="fake://", kind="file", label="fake", fps=self._fps,
                          width=64, height=64, is_live=False, frame_count=self._total)


class SlowDetector(Detector):
    """A detector deliberately slower than the source frame rate."""

    name = "slow"

    def __init__(self, delay: float) -> None:
        self._delay = delay
        self.calls = 0

    def detect(self, frame):
        time.sleep(self._delay)
        self.calls += 1
        return []


# -- the frame slot ----------------------------------------------------------

def test_slot_holds_only_the_newest_frame():
    """A backlog must never form: late readers see the newest frame, not a queue."""
    slot = LatestFrame()
    for i in range(1, 11):
        slot.set(np.zeros((2, 2, 3), np.uint8), i)
    assert slot.get().id == 10, "slot must discard superseded frames"


def test_slot_wait_times_out():
    """wait_for_new must return so worker loops can re-check their stop flags."""
    slot = LatestFrame()
    started = time.monotonic()
    assert slot.wait_for_new(0, timeout=0.2) is None
    assert 0.15 < time.monotonic() - started < 0.6


# -- pacing ------------------------------------------------------------------

def test_capture_is_paced_by_the_wall_clock():
    """A 2-second source must take ~2 seconds -- not race through at CPU speed."""
    fps, seconds = 25.0, 2.0
    source = FakeSource(fps=fps, total=int(fps * seconds))
    source.open()
    slot = LatestFrame()

    thread = CaptureThread(source, slot)
    started = time.monotonic()
    thread.start()
    thread.join(timeout=10)
    elapsed = time.monotonic() - started

    assert thread.frames_read == int(fps * seconds)
    assert seconds * 0.85 < elapsed < seconds * 1.4, (
        f"playback took {elapsed:.2f}s; expected ~{seconds}s. "
        "The source is not being paced in real time."
    )


# -- drop-frame behaviour ----------------------------------------------------

def test_slow_inference_drops_frames_instead_of_queueing():
    """The core guarantee.

    With a source at 30 fps and a detector at ~10 fps, roughly two of every three
    frames must go unprocessed. If instead they were queued, the worker would
    process every frame and simply fall further and further behind -- which is
    batch processing of a file, not monitoring of a live feed.
    """
    from app.pipeline.worker import InferenceWorker

    fps, seconds = 30.0, 2.0
    source = FakeSource(fps=fps, total=int(fps * seconds))
    source.open()
    raw, annotated = LatestFrame(), LatestFrame()

    detector = SlowDetector(delay=0.1)          # ~10 fps
    worker = InferenceWorker(raw, annotated, detector, IncidentEngine())
    capture = CaptureThread(source, raw)

    worker.start()
    capture.start()
    capture.join(timeout=10)
    time.sleep(0.3)
    worker.stop()
    worker.join(timeout=5)

    assert capture.frames_read >= 50, "source did not produce enough frames"
    assert worker.frames_skipped > 0, (
        "no frames were skipped: the pipeline is queueing frames instead of "
        "dropping them, so it is not behaving like a live camera"
    )
    # Processed + skipped should account for essentially every captured frame.
    accounted = worker.frames_processed + worker.frames_skipped
    assert accounted >= capture.frames_read - 5
    # And the worker must be far behind the source, not keeping pace with it.
    assert worker.frames_processed < capture.frames_read * 0.6


def test_worker_survives_a_detector_exception():
    """One bad frame must not take the stream down."""
    from app.pipeline.worker import InferenceWorker

    class Exploding(Detector):
        name = "boom"

        def __init__(self):
            self.calls = 0

        def detect(self, frame):
            self.calls += 1
            if self.calls == 2:
                raise RuntimeError("synthetic detector failure")
            return []

    raw, annotated = LatestFrame(), LatestFrame()
    detector = Exploding()
    worker = InferenceWorker(raw, annotated, detector, IncidentEngine())
    worker.start()

    for i in range(1, 6):
        raw.set(np.zeros((32, 32, 3), np.uint8), i)
        time.sleep(0.05)
    worker.stop()
    worker.join(timeout=5)

    assert detector.calls >= 4, "worker stopped after the failing frame"


# -- severity ----------------------------------------------------------------

def test_longitudinal_tear_is_critical():
    """A long, narrow rip is the rip-through case and must escalate hardest."""
    long_tear = Detection("tear", 0.9, 600, 40, 640, 660)
    short_tear = Detection("tear", 0.9, 600, 40, 640, 120)
    assert score_severity(long_tear, 1280, 720) is Severity.CRITICAL
    assert score_severity(short_tear, 1280, 720).rank < Severity.CRITICAL.rank


def test_healthy_joint_stays_informational():
    """Joints span the full belt by design; size alone must not alarm."""
    joint = Detection("belt_joint", 0.95, 0, 100, 1280, 180)
    assert score_severity(joint, 1280, 720) is Severity.INFO


def test_cracked_joint_escalates_to_joint_damage():
    """The specific failure mode this project targets."""
    joint = Detection("belt_joint", 0.95, 0, 100, 1280, 180, track_id=1)
    crack = Detection("crack", 0.8, 400, 110, 460, 170, track_id=2)
    assess_joints([joint, crack])
    assert joint.cls == "joint_damage"
    assert score_severity(joint, 1280, 720) is Severity.CRITICAL


def test_distant_defect_does_not_escalate_a_joint():
    joint = Detection("belt_joint", 0.95, 0, 100, 1280, 180, track_id=1)
    scratch = Detection("scratch", 0.6, 400, 500, 460, 560, track_id=2)
    assess_joints([joint, scratch])
    assert joint.cls == "belt_joint"


# -- incident lifecycle ------------------------------------------------------

def test_incident_requires_confirmation_over_several_frames():
    """A one-frame blip must not raise an alarm."""
    opened = []
    engine = IncidentEngine(confirm_frames=4, on_open=lambda i, d: opened.append(i))
    det = lambda: Detection("tear", 0.9, 600, 40, 640, 660, track_id=5)  # noqa: E731

    for frame in range(1, 4):
        engine.process([det()], frame, 1280, 720)
    assert opened == [], "incident opened before the confirmation threshold"

    engine.process([det()], 4, 1280, 720)
    assert len(opened) == 1
    assert opened[0].severity is Severity.CRITICAL


def test_incident_closes_when_the_defect_leaves_frame():
    opened, closed = [], []
    engine = IncidentEngine(confirm_frames=2,
                            on_open=lambda i, d: opened.append(i),
                            on_close=closed.append)
    for frame in range(1, 4):
        engine.process([Detection("hole", 0.9, 10, 10, 60, 60, track_id=9)],
                       frame, 1280, 720)
    assert len(opened) == 1

    for frame in range(4, 40):
        engine.process([], frame, 1280, 720)
    assert len(closed) == 1
    assert closed[0].closed_at is not None


def test_untracked_detections_never_open_incidents():
    """Without a track id there is no identity, so every frame would re-open one."""
    opened = []
    engine = IncidentEngine(confirm_frames=1, on_open=lambda i, d: opened.append(i))
    for frame in range(1, 20):
        engine.process([Detection("tear", 0.9, 10, 10, 60, 600)], frame, 1280, 720)
    assert opened == []


# -- source resolution -------------------------------------------------------

@pytest.mark.parametrize("uri,expected", [
    ("device://0", "DeviceSource"),
    ("rtsp://user:pw@10.0.0.5:554/s1", "RtspSource"),
    ("http://10.0.0.6/mjpg/video.mjpg", "HttpMjpegSource"),
    ("file://media/uploads/x.mp4", "FileSource"),
])
def test_uri_resolves_to_the_right_source(uri, expected):
    from app.sources import from_uri
    assert type(from_uri(uri)).__name__ == expected


def test_path_traversal_is_rejected():
    from app.sources import SourceError, from_uri
    with pytest.raises(SourceError):
        from_uri("file://../../../etc/passwd")


def test_rtsp_credentials_are_never_exposed():
    """Camera passwords must not reach logs or the dashboard."""
    from app.sources import describe_uri
    label = describe_uri("rtsp://admin:hunter2@10.0.0.5:554/stream1")
    assert "hunter2" not in label
    assert "10.0.0.5" in label


def test_mock_detector_emits_every_class():
    detector = MockDetector()
    frame = np.zeros((540, 960, 3), np.uint8)
    seen = set()
    now = time.monotonic()
    for step in range(600):
        detector._t0 = now - step * 0.1     # sweep 60 simulated seconds
        seen.update(d.cls for d in detector.detect(frame))
    assert seen == {"tear", "hole", "scratch", "crack", "belt_joint"}


# -- session management ------------------------------------------------------

def test_failed_start_leaves_the_running_stream_alone(tmp_path, monkeypatch):
    """A mistyped camera URL must not take down live monitoring.

    The new source is opened before the old session is torn down, so a failure
    to open leaves the existing stream running.
    """
    from app.pipeline import session as session_mod

    manager = session_mod.SessionManager()

    class FakeSession:
        def __init__(self, uri):
            self.uri = uri
            self.stopped = False

        def start(self):
            if "bad" in self.uri:
                raise RuntimeError("could not open")

        def stop(self):
            self.stopped = True

    monkeypatch.setattr(session_mod, "StreamSession", FakeSession)

    good = manager.start("file://good.mp4")
    assert manager.session is good

    with pytest.raises(RuntimeError):
        manager.start("device://bad")

    assert manager.session is good, "the working stream was torn down"
    assert not good.stopped


def test_successful_start_replaces_and_stops_the_previous_session(monkeypatch):
    from app.pipeline import session as session_mod

    manager = session_mod.SessionManager()

    class FakeSession:
        def __init__(self, uri):
            self.uri = uri
            self.stopped = False

        def start(self):
            pass

        def stop(self):
            self.stopped = True

    monkeypatch.setattr(session_mod, "StreamSession", FakeSession)

    first = manager.start("file://a.mp4")
    second = manager.start("file://b.mp4")

    assert manager.session is second
    assert first.stopped, "the replaced session was left running"


# -- belt motion estimation --------------------------------------------------

def _scrolling_clip(direction: str, steps: int = 40):
    """Synthesise a scrolling textured surface moving in a known direction."""
    import cv2

    rng = np.random.default_rng(3)
    strip = cv2.GaussianBlur(
        rng.integers(0, 255, (600, 600), dtype=np.uint8).astype(np.uint8), (0, 0), 2
    )
    frames = []
    for i in range(steps):
        shift = i * 5
        if direction == "down":
            view = np.take(strip, range(-shift, -shift + 200), axis=0, mode="wrap")
        elif direction == "up":
            view = np.take(strip, range(shift, shift + 200), axis=0, mode="wrap")
        elif direction == "right":
            view = np.take(strip, range(-shift, -shift + 200), axis=1, mode="wrap")
        else:
            view = np.take(strip, range(shift, shift + 200), axis=1, mode="wrap")
        frames.append(cv2.cvtColor(view[:200, :200], cv2.COLOR_GRAY2BGR))
    return frames


@pytest.mark.parametrize("direction,axis,sign", [
    ("down", "y", +1),
    ("up", "y", -1),
    ("right", "x", +1),
    ("left", "x", -1),
])
def test_belt_motion_direction_is_measured_not_assumed(direction, axis, sign):
    """Belt travel must be recovered from the imagery, in any orientation.

    A hardcoded direction produces overlays that visibly disagree with the
    footage the moment the camera is mounted differently.
    """
    from app.pipeline.detector import BeltMotionEstimator

    estimator = BeltMotionEstimator()
    for frame in _scrolling_clip(direction):
        estimator.update(frame)

    dx, dy = estimator.direction
    assert estimator.confident, "not enough motion samples were accepted"

    dominant, other = (dy, dx) if axis == "y" else (dx, dy)
    assert abs(dominant) > abs(other) * 2, (
        f"expected motion along {axis}, got dx={dx:.2f} dy={dy:.2f}"
    )
    assert dominant * sign > 0, f"direction is inverted: dx={dx:.2f} dy={dy:.2f}"


def test_belt_motion_defaults_before_it_has_evidence():
    """With no motion seen, fall back to the common vertical mounting."""
    from app.pipeline.detector import BeltMotionEstimator

    estimator = BeltMotionEstimator()
    assert estimator.direction == (0.0, 1.0)
    assert not estimator.confident

    still = np.zeros((120, 120, 3), np.uint8)
    for _ in range(20):
        estimator.update(still)
    # A static image must not be mistaken for motion in some arbitrary direction.
    assert not estimator.confident


def test_mock_defects_travel_along_the_measured_belt_direction():
    """Synthetic defects must ride the belt, not a direction baked into code."""
    from app.pipeline.detector import MockDetector

    detector = MockDetector()
    frames = _scrolling_clip("down", steps=60)
    for frame in frames[:40]:
        detector.detect(frame)

    now = time.monotonic()
    paths: dict[int, list[tuple[float, float]]] = {}
    for step in range(100):
        detector._t0 = now - step * 0.1
        for det in detector.detect(frames[step % len(frames)]):
            centre = ((det.x1 + det.x2) / 2, (det.y1 + det.y2) / 2)
            paths.setdefault(det.track_id, []).append(centre)

    moved = [p for p in paths.values() if len(p) > 5]
    assert moved, "no synthetic defect persisted long enough to measure"

    for path in moved:
        dx = path[-1][0] - path[0][0]
        dy = path[-1][1] - path[0][1]
        assert abs(dy) > abs(dx), (
            f"defect travelled across the belt rather than along it "
            f"(dx={dx:.0f}, dy={dy:.0f})"
        )


# -- tracker lifecycle -------------------------------------------------------

def test_detector_reset_does_not_break_tracking():
    """reset() must not leave the tracker unusable.

    Ultralytics guards tracker setup with `hasattr(predictor, "trackers")`, so
    assigning None satisfies the check, skips registration, and every later call
    either raises or returns boxes with no ids. The second case is the dangerous
    one: detections still draw, but nothing has an identity, so the incident
    engine discards them all and the alert feed stays silently empty.

    Skipped when no trained weights are installed.
    """
    from app.config import settings

    if not settings.model_file.exists():
        pytest.skip("no trained weights installed")

    from app.pipeline.detector import YoloDetector

    detector = YoloDetector()
    assert detector.tracking_ok, "tracking unavailable — is lapx installed?"

    rng = np.random.default_rng(0)
    frame = rng.integers(0, 255, (480, 640, 3), dtype=np.uint8).astype(np.uint8)

    detector.reset()
    for _ in range(3):
        detector.detect(frame)

    predictor = getattr(detector._model, "predictor", None)
    assert predictor is not None
    assert getattr(predictor, "trackers", None) is not None, (
        "reset() left predictor.trackers unusable"
    )


def test_incident_engine_discards_untracked_detections_loudly():
    """Document the coupling that made the tracker bug invisible.

    Detections without a track id are dropped on purpose — without identity the
    engine would open a fresh incident every frame. That makes a broken tracker
    present as 'everything works, but no alerts', which is why
    YoloDetector verifies tracking at startup.
    """
    opened = []
    engine = IncidentEngine(confirm_frames=2, on_open=lambda i, d: opened.append(i))

    for frame_id in range(1, 30):
        engine.process(
            [Detection("tear", 0.9, 100, 10, 140, 400, track_id=None)],
            frame_id, 1280, 720,
        )
    assert opened == [], "untracked detections must not open incidents"

    for frame_id in range(1, 5):
        engine.process(
            [Detection("tear", 0.9, 100, 10, 140, 400, track_id=42)],
            frame_id, 1280, 720,
        )
    assert len(opened) == 1, "tracked detections must open exactly one incident"
