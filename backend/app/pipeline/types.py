"""Shared value types for the detection pipeline."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

# Unified class vocabulary. Public datasets label these inconsistently
# ("Large Tear", "rip", "belt_joint"...); training/merge_datasets.py maps them
# all onto these six names so the runtime only ever sees this vocabulary.
CLASS_NAMES: tuple[str, ...] = (
    "tear",
    "hole",
    "scratch",
    "crack",
    "belt_joint",
    "joint_damage",
)

# Human-facing copy, used by the UI and by generated maintenance reports.
CLASS_LABELS: dict[str, str] = {
    "tear": "Tear",
    "hole": "Hole / Puncture",
    "scratch": "Scratch",
    "crack": "Crack",
    "belt_joint": "Belt Joint",
    # A healthy splice passing the camera is not an event -- it does that once
    # per belt revolution. A splice that has *separated* is the failure this
    # project exists to catch, so it carries the problem statement's own name.
    "joint_damage": "Belt Joint Rupture",
}


class Severity(str, Enum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    @property
    def rank(self) -> int:
        return _SEVERITY_RANK[self]


_SEVERITY_RANK = {
    Severity.INFO: 0,
    Severity.LOW: 1,
    Severity.MEDIUM: 2,
    Severity.HIGH: 3,
    Severity.CRITICAL: 4,
}


@dataclass
class Detection:
    """One detected defect in one frame."""

    cls: str
    confidence: float
    # Pixel coordinates in the source frame.
    x1: float
    y1: float
    x2: float
    y2: float
    track_id: int | None = None
    severity: Severity = Severity.INFO

    @property
    def width(self) -> float:
        return max(0.0, self.x2 - self.x1)

    @property
    def height(self) -> float:
        return max(0.0, self.y2 - self.y1)

    @property
    def area(self) -> float:
        return self.width * self.height

    def to_dict(self, frame_w: int, frame_h: int) -> dict:
        """Serialise with normalised coordinates so the client can scale freely."""
        fw, fh = max(frame_w, 1), max(frame_h, 1)
        return {
            "cls": self.cls,
            "label": CLASS_LABELS.get(self.cls, self.cls),
            "confidence": round(self.confidence, 4),
            "severity": self.severity.value,
            "track_id": self.track_id,
            "box": [
                round(self.x1 / fw, 5), round(self.y1 / fh, 5),
                round(self.x2 / fw, 5), round(self.y2 / fh, 5),
            ],
            "box_px": [round(self.x1), round(self.y1), round(self.x2), round(self.y2)],
        }


@dataclass
class FrameResult:
    """Everything the worker produced for a single processed frame."""

    frame_id: int
    timestamp: float
    width: int
    height: int
    detections: list[Detection] = field(default_factory=list)
    inference_ms: float = 0.0
    frames_skipped: int = 0
