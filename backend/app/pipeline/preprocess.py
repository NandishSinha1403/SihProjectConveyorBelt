"""Image preprocessing for dusty, low-contrast underground imagery.

Guo et al. (Micromachines 2022, sec. 4.1) identify uneven brightness and low
contrast from coal/ore dust as the dominant cause of missed detections. CLAHE on
the luminance channel restores local contrast on belt texture without amplifying
noise the way a global histogram equalisation would.
"""
from __future__ import annotations

import cv2
import numpy as np

# Modest clip limit: aggressive values turn belt-surface grain into
# tear-shaped artefacts and cost precision.
_clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))


def enhance(frame: np.ndarray) -> np.ndarray:
    """Apply CLAHE to the L channel of a BGR frame."""
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    lab = cv2.merge((_clahe.apply(l), a, b))
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
