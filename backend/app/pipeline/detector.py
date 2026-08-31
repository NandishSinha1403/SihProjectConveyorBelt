"""Defect detectors.

Two implementations behind one interface:

* :class:`YoloDetector`  -- Ultralytics YOLO fine-tuned on conveyor belt damage.
* :class:`MockDetector`  -- deterministic synthetic defects, so the streaming
  pipeline, dashboard and incident engine are fully testable before any weights
  exist. Selected with DETECTOR=mock.

Both return tracked detections: a stable ``track_id`` per physical defect across
frames, which the incident engine uses to collapse thousands of per-frame boxes
into a handful of meaningful events.
"""
from __future__ import annotations

import abc
import logging
import math
import time

import cv2
import numpy as np

from ..config import settings
from .types import CLASS_NAMES, Detection

log = logging.getLogger(__name__)


class Detector(abc.ABC):
    name: str = "detector"

    @abc.abstractmethod
    def detect(self, frame: np.ndarray) -> list[Detection]:
        """Detect defects in one frame. Must not mutate ``frame``."""

    def reset(self) -> None:
        """Clear tracking state. Called when a new stream session starts."""

    @property
    def description(self) -> str:
        return self.name


class BeltMotionEstimator:
    """Estimates which way the belt is travelling, from the imagery itself.

    Uses phase correlation between consecutive downscaled greyscale frames to
    recover the dominant translation, then accumulates it so a few noisy
    estimates cannot flip the answer. Cheap: a few hundred microseconds on a
    64x64 crop.

    This is used by the mock detector so its synthetic defects travel along the
    belt's real direction of motion rather than an axis baked into the code --
    a fixed direction looks obviously wrong the moment the footage runs a
    different way.

    It is also the groundwork for the belt-position digital twin, which needs
    the same measurement to convert frame counts into belt travel.
    """

    SIZE = 64          # correlation window; belt motion is a global translation
    MIN_MAGNITUDE = 0.15   # px/frame below which motion is treated as noise

    def __init__(self) -> None:
        self._previous: np.ndarray | None = None
        self._accum = np.zeros(2, dtype=np.float64)
        self.samples = 0
        # phaseCorrelate assumes a periodic signal; without a window the frame
        # edges act as a step discontinuity and produce a spurious peak. Belt
        # rubber also has strong directional grain, which without windowing
        # correlates against itself and reports motion across the belt that is
        # not there.
        self._window = cv2.createHanningWindow((self.SIZE, self.SIZE), cv2.CV_32F)

    def reset(self) -> None:
        self._previous = None
        self._accum[:] = 0.0
        self.samples = 0

    def update(self, frame: np.ndarray) -> None:
        try:
            small = cv2.resize(frame, (self.SIZE, self.SIZE))
            if small.ndim == 3:
                small = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            current = small.astype(np.float32)

            if self._previous is not None:
                (dx, dy), response = cv2.phaseCorrelate(
                    self._previous, current, self._window)
                magnitude = math.hypot(dx, dy)
                # Ignore near-still frames: their direction is pure noise and
                # would drag the running estimate around.
                if magnitude >= self.MIN_MAGNITUDE and response > 0.05:
                    self._accum += (dx, dy)
                    self.samples += 1

            self._previous = current
        except cv2.error:
            log.debug("Belt motion estimation failed", exc_info=True)

    @property
    def direction(self) -> tuple[float, float]:
        """Unit vector of belt travel in frame coordinates.

        Falls back to top-to-bottom before enough evidence has accumulated,
        which is the usual camera orientation for a belt viewed from above or
        below along its run.
        """
        if self.samples < 5:
            return (0.0, 1.0)
        norm = float(np.linalg.norm(self._accum))
        if norm < 1e-6:
            return (0.0, 1.0)
        return tuple(self._accum / norm)

    @property
    def confident(self) -> bool:
        return self.samples >= 5


class MockDetector(Detector):
    """Synthetic detections for development, before a trained model exists.

    Produces a handful of defects that ride the belt and persist for many
    frames, so tracking, incident confirmation and severity escalation are all
    exercised realistically.

    Defects travel along the belt's *measured* direction of motion rather than a
    hardcoded axis, so the overlay stays consistent with whatever footage or
    camera is connected. This is scaffolding only -- it exists so the streaming
    pipeline and dashboard are testable before training completes, and is
    replaced entirely by setting DETECTOR=yolo.
    """

    name = "mock"

    def __init__(self, seed: int = 7) -> None:
        self._rng = np.random.default_rng(seed)
        self._t0 = time.monotonic()
        self._motion = BeltMotionEstimator()
        self._specs = [
            # (class, period_s, base_conf, along_frac, across_frac, offset_frac)
            #   along_frac  = extent along the direction of belt travel
            #   across_frac = extent across the belt
            #   offset_frac = position across the belt, 0..1
            ("tear", 11.0, 0.88, 0.58, 0.030, 0.30),
            ("scratch", 7.0, 0.71, 0.070, 0.090, 0.62),
            ("hole", 17.0, 0.83, 0.110, 0.075, 0.44),
            ("belt_joint", 23.0, 0.93, 0.075, 0.960, 0.50),
            ("crack", 13.0, 0.66, 0.140, 0.055, 0.78),
        ]

    def reset(self) -> None:
        self._t0 = time.monotonic()
        self._motion.reset()

    def detect(self, frame: np.ndarray) -> list[Detection]:
        h, w = frame.shape[:2]
        self._motion.update(frame)

        # Belt travel direction, and the perpendicular (across-belt) axis.
        ax, ay = self._motion.direction
        px, py = -ay, ax

        t = time.monotonic() - self._t0
        out: list[Detection] = []

        for idx, (cls, period, conf, along, across, offset) in enumerate(self._specs):
            phase = (t % period) / period
            # Visible for the middle ~55% of the cycle, so defects genuinely
            # enter and leave the frame.
            if not (0.15 < phase < 0.70):
                continue

            # Travel from just before one edge to just past the opposite one,
            # measured along the belt's actual direction of motion.
            travel = (phase - 0.15) / 0.55
            along_pos = travel * 1.4 - 0.2                  # -0.2 .. 1.2
            across_pos = offset + 0.015 * math.sin(t * 1.3 + idx)

            # Compose the centre from the two belt-relative axes. Centred at
            # (0.5, 0.5) so the motion axis passes through the frame middle.
            cx = 0.5 + (along_pos - 0.5) * ax + (across_pos - 0.5) * px
            cy = 0.5 + (along_pos - 0.5) * ay + (across_pos - 0.5) * py

            # Box extents follow the same axes, so a longitudinal tear stays
            # longitudinal whichever way the belt runs.
            half_w = 0.5 * (abs(along * ax) + abs(across * px))
            half_h = 0.5 * (abs(along * ay) + abs(across * py))

            x1 = (cx - half_w) * w
            x2 = (cx + half_w) * w
            y1 = (cy - half_h) * h
            y2 = (cy + half_h) * h

            # Skip defects that have travelled out of frame.
            if x2 <= 0 or y2 <= 0 or x1 >= w or y1 >= h:
                continue

            jitter = float(self._rng.normal(0, 0.015))
            out.append(Detection(
                cls=cls,
                confidence=float(np.clip(conf + jitter, 0.30, 0.99)),
                x1=max(0.0, x1), y1=max(0.0, y1),
                x2=min(float(w), x2), y2=min(float(h), y2),
                # Stable synthetic track id per defect per cycle.
                track_id=idx * 1000 + int(t // period),
            ))

        return [d for d in out if d.width > 1 and d.height > 1]

    @property
    def description(self) -> str:
        axis = "measuring" if not self._motion.confident else (
            "%.0f°" % math.degrees(math.atan2(*reversed(self._motion.direction)))
        )
        return (f"MockDetector — SYNTHETIC, not a trained model "
                f"(belt direction: {axis})")


class YoloDetector(Detector):
    """Ultralytics YOLO with ByteTrack, fine-tuned on conveyor belt damage."""

    name = "yolo"

    def __init__(self) -> None:
        from ultralytics import YOLO  # imported lazily: heavy, and optional

        weights = settings.model_file
        if not weights.exists():
            raise FileNotFoundError(
                f"Model weights not found at {weights}. Train one with "
                f"training/train.py, or set DETECTOR=mock to run without a model."
            )

        self._device = _resolve_device(settings.device)
        self._model = YOLO(str(weights))
        self._names: dict[int, str] = dict(self._model.names)
        log.info("Loaded YOLO weights %s on %s (classes: %s)",
                 weights.name, self._device, list(self._names.values()))

        unknown = set(self._names.values()) - set(CLASS_NAMES)
        if unknown:
            log.warning("Model emits classes outside the known vocabulary: %s", unknown)

        self.tracking_ok = True
        self._warmup()
        self._verify_tracking()

    def _verify_tracking(self) -> None:
        """Confirm the tracker actually assigns ids, and say so loudly if not.

        Without ids the incident engine cannot tell one frame's tear from the
        next one's, so it discards every detection and the system looks alive
        while producing no alerts at all. That failure is invisible unless it is
        checked for explicitly, so it is checked for explicitly.
        """
        import numpy as np

        probe = np.random.default_rng(0).integers(
            0, 255, (settings.img_size, settings.img_size, 3), dtype=np.uint8
        ).astype("uint8")
        try:
            for _ in range(2):
                self._model.track(
                    probe, imgsz=settings.img_size, conf=0.01,
                    device=self._device, persist=True,
                    tracker="bytetrack.yaml", verbose=False,
                )
            self.tracking_ok = True
        except Exception as exc:  # noqa: BLE001
            self.tracking_ok = False
            log.error(
                "Object tracking is unavailable (%s: %s). Detections will still "
                "be drawn, but no incidents can be raised because defects "
                "cannot be followed between frames. Install the tracker "
                "dependency:  pip install lapx",
                type(exc).__name__, exc,
            )

    def _warmup(self) -> None:
        """Run one dummy inference so the first real frame isn't 3s slow."""
        blank = np.zeros((settings.img_size, settings.img_size, 3), dtype=np.uint8)
        try:
            self._model.predict(blank, imgsz=settings.img_size,
                                device=self._device, verbose=False)
        except Exception:  # noqa: BLE001 - warmup failure is not fatal
            log.debug("Detector warmup failed", exc_info=True)

    def reset(self) -> None:
        """Drop ByteTrack state so track ids restart with each stream session.

        The attribute must be *deleted*, not set to None. Ultralytics guards
        tracker setup with ``hasattr(predictor, "trackers") and persist``, so a
        None value satisfies the check, tracker registration is skipped, and
        every later call fails with "'NoneType' object is not subscriptable" --
        or silently returns boxes with no ids, which is worse: detections still
        render, but nothing has an identity, so the incident engine discards
        them all and the alert feed stays empty for no visible reason.
        """
        predictor = getattr(self._model, "predictor", None)
        if predictor is None:
            return
        try:
            if hasattr(predictor, "trackers"):
                del predictor.trackers
        except Exception:  # noqa: BLE001
            log.debug("Could not reset tracker state", exc_info=True)

    def detect(self, frame: np.ndarray) -> list[Detection]:
        results = self._model.track(
            frame,
            imgsz=settings.img_size,
            conf=settings.conf_threshold,
            iou=settings.iou_threshold,
            device=self._device,
            persist=True,          # carry track ids across calls
            tracker="bytetrack.yaml",
            verbose=False,
        )
        if not results:
            return []

        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return []

        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        clss = boxes.cls.cpu().numpy().astype(int)
        ids = (boxes.id.cpu().numpy().astype(int)
               if boxes.id is not None else [None] * len(clss))

        out: list[Detection] = []
        for (x1, y1, x2, y2), conf, cid, tid in zip(xyxy, confs, clss, ids):
            out.append(Detection(
                cls=self._names.get(int(cid), str(cid)),
                confidence=float(conf),
                x1=float(x1), y1=float(y1), x2=float(x2), y2=float(y2),
                track_id=None if tid is None else int(tid),
            ))
        return out

    @property
    def description(self) -> str:
        base = f"YOLO {settings.model_file.name} on {self._device}"
        return base if self.tracking_ok else f"{base} — TRACKING UNAVAILABLE"


def _resolve_device(preference: str) -> str:
    if preference and preference != "auto":
        return preference
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
    except Exception:  # noqa: BLE001
        log.debug("Torch device probe failed", exc_info=True)
    return "cpu"


def build_detector() -> Detector:
    """Construct the configured detector, falling back to mock on failure.

    A missing or broken model must degrade to a running system with obviously
    fake detections rather than a server that will not start.
    """
    choice = (settings.detector or "mock").lower()
    if choice == "mock":
        return MockDetector()
    try:
        return YoloDetector()
    except Exception as exc:  # noqa: BLE001
        log.error("Falling back to MockDetector: %s", exc)
        return MockDetector()
