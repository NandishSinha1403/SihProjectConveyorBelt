"""Draws detections onto frames for the annotated MJPEG stream.

Colours are severity-driven rather than class-driven: an operator glancing at a
control-room screen needs to know *how bad*, not *what kind*, in the first
half-second.
"""
from __future__ import annotations

import cv2
import numpy as np

from .types import CLASS_LABELS, Detection, Severity

# BGR, tuned to read clearly against dark grey belt rubber.
SEVERITY_COLORS: dict[Severity, tuple[int, int, int]] = {
    Severity.INFO: (176, 176, 176),
    Severity.LOW: (222, 196, 96),
    Severity.MEDIUM: (64, 190, 250),
    Severity.HIGH: (48, 128, 255),
    Severity.CRITICAL: (60, 60, 245),
}

_FONT = cv2.FONT_HERSHEY_SIMPLEX


def draw(frame: np.ndarray, detections: list[Detection]) -> np.ndarray:
    """Return a copy of ``frame`` with boxes and labels drawn on it."""
    out = frame.copy()
    h, w = out.shape[:2]
    scale = max(0.4, min(w, h) / 1400)
    thickness = max(1, int(round(scale * 3)))

    for det in detections:
        color = SEVERITY_COLORS.get(det.severity, SEVERITY_COLORS[Severity.LOW])
        x1, y1 = int(det.x1), int(det.y1)
        x2, y2 = int(det.x2), int(det.y2)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, thickness)

        label = f"{CLASS_LABELS.get(det.cls, det.cls)} {det.confidence:.2f}"
        (tw, th), base = cv2.getTextSize(label, _FONT, scale, thickness)

        # Keep the tag inside the frame when a defect touches the top edge.
        ty = y1 - 4 if y1 - th - base - 4 >= 0 else y2 + th + base + 4
        ty = int(np.clip(ty, th + base + 2, h - 2))
        tx = int(np.clip(x1, 0, max(0, w - tw - 6)))

        cv2.rectangle(out, (tx, ty - th - base - 2), (tx + tw + 6, ty), color, -1)
        cv2.putText(out, label, (tx + 3, ty - base), _FONT, scale,
                    (20, 20, 20), thickness, cv2.LINE_AA)

    return out


def draw_status(frame: np.ndarray, lines: list[str]) -> np.ndarray:
    """Burn a small status block into the bottom-left of the frame.

    Useful when the stream is viewed outside the dashboard (a wall display, or a
    saved clip) and the surrounding HUD is not there to give context.
    """
    h = frame.shape[0]
    y = h - 10 - 18 * (len(lines) - 1)
    for line in lines:
        cv2.putText(frame, line, (12, y), _FONT, 0.5, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(frame, line, (12, y), _FONT, 0.5, (235, 235, 235), 1, cv2.LINE_AA)
        y += 18
    return frame


def placeholder(width: int = 960, height: int = 540,
                message: str = "No active stream") -> np.ndarray:
    """A dark frame shown when nothing is streaming, so the <img> never breaks."""
    img = np.full((height, width, 3), 18, dtype=np.uint8)
    (tw, th), _ = cv2.getTextSize(message, _FONT, 0.8, 2)
    cv2.putText(img, message, ((width - tw) // 2, (height + th) // 2),
                _FONT, 0.8, (140, 140, 140), 2, cv2.LINE_AA)
    return img
