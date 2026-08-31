"""Severity assessment and incident lifecycle.

A detector emits boxes every frame; at 25 fps a single tear produces hundreds of
them. Operators need *incidents*, not boxes. This module does three things:

1. Escalates belt joints to ``joint_damage`` when a crack or tear overlaps them,
   which is the specific failure mode the problem statement is about.
2. Scores each detection's severity from its class, size and geometry.
   Longitudinal (tall, narrow) defects escalate fastest because those are the
   ones that propagate into a full rip-through.
3. Confirms a track over several consecutive frames before opening an incident,
   and closes it once the defect leaves the field of view. This is the temporal
   analogue of the false-positive problem Guo et al. flag for small defects.
"""
from __future__ import annotations

import itertools
import logging
import time
from dataclasses import dataclass, field
from typing import Callable

from .types import CLASS_LABELS, Detection, Severity

log = logging.getLogger(__name__)

# Baseline severity per class, before geometry is considered.
BASE_SEVERITY: dict[str, Severity] = {
    "joint_damage": Severity.CRITICAL,
    "tear": Severity.HIGH,
    "hole": Severity.HIGH,
    "crack": Severity.MEDIUM,
    "scratch": Severity.LOW,
    "belt_joint": Severity.INFO,
}

# A joint is escalated when damage touches the splice band at all.
#
# Two earlier attempts got this wrong, both for the same reason: they asked how
# much of one box was inside the other. IoU fails because a splice spans the
# full belt width and a small crack inside it scores near zero. Containment
# fails the other way -- it catches a crack sitting wholly within the band, but
# a tear *propagating out of* the splice is mostly outside it (measured: 0.11),
# and a rip running through one is 0.09. Those are the actual rupture cases and
# both were missed.
#
# What matters physically is simply whether damage meets the splice. A splice is
# a line across the entire belt, so damage anywhere along that line is damage at
# the splice. The only thing to exclude is a one-pixel graze, hence a noise
# floor expressed as a fraction of the band's own area.
JOINT_TOUCH_MIN_FRAC = 0.005
# Fraction of frame height above which a longitudinal defect is rip-through risk.
LONGITUDINAL_HEIGHT_FRAC = 0.45
# Height/width ratio at which a defect counts as longitudinal.
LONGITUDINAL_ASPECT = 3.0
# Fraction of frame area above which any defect is escalated.
LARGE_AREA_FRAC = 0.04

# How many consecutive misses before a confirmed incident is considered over.
MISS_TOLERANCE = 20


def _bump(sev: Severity, steps: int = 1) -> Severity:
    order = [Severity.INFO, Severity.LOW, Severity.MEDIUM,
             Severity.HIGH, Severity.CRITICAL]
    return order[min(len(order) - 1, order.index(sev) + steps)]


def _intersection(a: Detection, b: Detection) -> float:
    """Overlapping area of two boxes, in square pixels."""
    ix1, iy1 = max(a.x1, b.x1), max(a.y1, b.y1)
    ix2, iy2 = min(a.x2, b.x2), min(a.y2, b.y2)
    return max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)


def touches_joint(defect: Detection, joint: Detection) -> bool:
    """Does this defect meet the splice band, beyond a noise-floor graze?"""
    if joint.area <= 0:
        return False
    return _intersection(defect, joint) >= JOINT_TOUCH_MIN_FRAC * joint.area


def assess_joints(detections: list[Detection]) -> list[Detection]:
    """Reclassify belt joints that overlap a crack or tear as joint damage.

    A healthy splice is an expected feature of the belt and should not alarm
    anyone. A splice with a crack running through it is the precise event this
    whole system exists to catch, so it is promoted to its own class.
    """
    joints = [d for d in detections if d.cls == "belt_joint"]
    if not joints:
        return detections

    threats = [d for d in detections if d.cls in ("crack", "tear", "hole")]
    for joint in joints:
        if any(touches_joint(t, joint) for t in threats):
            joint.cls = "joint_damage"
    return detections


def score_severity(det: Detection, frame_w: int, frame_h: int) -> Severity:
    """Assign a severity to one detection from its class and geometry."""
    sev = BASE_SEVERITY.get(det.cls, Severity.LOW)

    fw, fh = max(frame_w, 1), max(frame_h, 1)
    height_frac = det.height / fh
    area_frac = det.area / (fw * fh)
    aspect = det.height / det.width if det.width > 0 else 0.0

    # A healthy joint stays informational no matter how large it is: joints span
    # the full belt width by design, so geometry rules must not fire on them.
    if det.cls == "belt_joint":
        return sev

    if aspect >= LONGITUDINAL_ASPECT and height_frac >= LONGITUDINAL_HEIGHT_FRAC:
        sev = _bump(sev, 2)   # running rip: the worst case
    elif aspect >= LONGITUDINAL_ASPECT and height_frac >= LONGITUDINAL_HEIGHT_FRAC / 2:
        sev = _bump(sev)

    if area_frac >= LARGE_AREA_FRAC:
        sev = _bump(sev)

    return sev


@dataclass
class TrackState:
    """Per-track bookkeeping between the detector and the incident record."""

    track_id: int
    cls: str
    hits: int = 0
    misses: int = 0
    first_frame: int = 0
    last_frame: int = 0
    first_seen: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    max_severity: Severity = Severity.INFO
    max_confidence: float = 0.0
    peak: Detection | None = None
    incident_id: int | None = None


@dataclass
class Incident:
    """A confirmed defect, from first confirmation to leaving the frame."""

    id: int
    track_id: int
    cls: str
    label: str
    severity: Severity
    confidence: float
    opened_at: float
    closed_at: float | None = None
    first_frame: int = 0
    last_frame: int = 0
    snapshot: str | None = None
    box: list[float] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return (self.closed_at or time.time()) - self.opened_at

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "track_id": self.track_id,
            "cls": self.cls,
            "label": self.label,
            "severity": self.severity.value,
            "confidence": round(self.confidence, 4),
            "opened_at": self.opened_at,
            "closed_at": self.closed_at,
            "duration": round(self.duration, 2),
            "first_frame": self.first_frame,
            "last_frame": self.last_frame,
            "snapshot": self.snapshot,
            "box": [round(v, 5) for v in self.box],
        }


class IncidentEngine:
    """Converts a stream of tracked detections into incident open/update/close.

    Callbacks are invoked from the inference thread; they are expected to be
    cheap and non-blocking (publish to the bus, queue a DB write).
    """

    def __init__(
        self,
        confirm_frames: int = 5,
        on_open: Callable[[Incident, Detection], None] | None = None,
        on_update: Callable[[Incident], None] | None = None,
        on_close: Callable[[Incident], None] | None = None,
    ) -> None:
        self._confirm_frames = max(1, confirm_frames)
        self._on_open = on_open
        self._on_update = on_update
        self._on_close = on_close
        self._tracks: dict[int, TrackState] = {}
        self._ids = itertools.count(1)
        self._open: dict[int, Incident] = {}
        self.counts: dict[str, int] = {}

    def reset(self) -> None:
        for incident in list(self._open.values()):
            self._close(incident)
        self._tracks.clear()
        self._open.clear()
        self.counts.clear()

    @property
    def open_incidents(self) -> list[Incident]:
        return list(self._open.values())

    def process(self, detections: list[Detection], frame_id: int,
                frame_w: int, frame_h: int) -> list[Detection]:
        """Score detections, advance track state, and fire incident callbacks.

        Returns the detections with severity populated.
        """
        assess_joints(detections)
        for det in detections:
            det.severity = score_severity(det, frame_w, frame_h)

        seen: set[int] = set()
        for det in detections:
            if det.track_id is None:
                # Untracked detections still render, but cannot form incidents:
                # without identity we would open a new one every frame.
                continue
            seen.add(det.track_id)
            self._advance(det, frame_id, frame_w, frame_h)

        self._age_unseen(seen)
        return detections

    def _advance(self, det: Detection, frame_id: int,
                 frame_w: int, frame_h: int) -> None:
        track = self._tracks.get(det.track_id)
        if track is None:
            track = TrackState(track_id=det.track_id, cls=det.cls,
                               first_frame=frame_id)
            self._tracks[det.track_id] = track

        track.hits += 1
        track.misses = 0
        track.last_frame = frame_id
        track.last_seen = time.time()

        if det.severity.rank > track.max_severity.rank:
            track.max_severity = det.severity
            track.peak = det
        if det.confidence > track.max_confidence:
            track.max_confidence = det.confidence
            if track.peak is None:
                track.peak = det

        # A joint that later escalates carries the more serious class forward.
        if det.cls != track.cls and det.cls == "joint_damage":
            track.cls = det.cls

        if track.incident_id is None and track.hits >= self._confirm_frames:
            self._open_incident(track, det, frame_w, frame_h)
        elif track.incident_id is not None:
            incident = self._open.get(track.incident_id)
            if incident is not None:
                incident.last_frame = frame_id
                changed = False
                if det.severity.rank > incident.severity.rank:
                    incident.severity, changed = det.severity, True
                if det.cls != incident.cls and det.cls == "joint_damage":
                    incident.cls = det.cls
                    incident.label = CLASS_LABELS.get(det.cls, det.cls)
                    changed = True
                if changed and self._on_update is not None:
                    self._on_update(incident)

    def _open_incident(self, track: TrackState, det: Detection,
                       frame_w: int, frame_h: int) -> None:
        fw, fh = max(frame_w, 1), max(frame_h, 1)
        incident = Incident(
            id=next(self._ids),
            track_id=track.track_id,
            cls=track.cls,
            label=CLASS_LABELS.get(track.cls, track.cls),
            severity=track.max_severity,
            confidence=track.max_confidence,
            opened_at=track.first_seen,
            first_frame=track.first_frame,
            last_frame=track.last_frame,
            box=[det.x1 / fw, det.y1 / fh, det.x2 / fw, det.y2 / fh],
        )
        track.incident_id = incident.id
        self._open[incident.id] = incident
        self.counts[incident.cls] = self.counts.get(incident.cls, 0) + 1
        log.info("Incident #%d opened: %s (%s)",
                 incident.id, incident.label, incident.severity.value)
        if self._on_open is not None:
            self._on_open(incident, det)

    def _age_unseen(self, seen: set[int]) -> None:
        for tid, track in list(self._tracks.items()):
            if tid in seen:
                continue
            track.misses += 1
            if track.misses < MISS_TOLERANCE:
                continue
            if track.incident_id is not None:
                incident = self._open.pop(track.incident_id, None)
                if incident is not None:
                    self._close(incident)
            del self._tracks[tid]

    def _close(self, incident: Incident) -> None:
        incident.closed_at = time.time()
        self._open.pop(incident.id, None)
        log.info("Incident #%d closed after %.1fs", incident.id, incident.duration)
        if self._on_close is not None:
            self._on_close(incident)
