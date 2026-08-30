"""Frame source abstraction.

Every video input -- an uploaded test file, a USB webcam, an RTSP camera on a
gantry above the belt -- implements this same three-method interface. The rest
of the system never learns which one it is talking to, which is what makes
swapping a test video for a real camera a config change rather than a rewrite.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class SourceInfo:
    uri: str
    kind: str            # "file" | "device" | "rtsp" | "http"
    label: str
    fps: float
    width: int
    height: int
    is_live: bool        # True => pull as fast as the driver delivers
    frame_count: int = 0  # 0 for live sources


class FrameSource(abc.ABC):
    """A source of frames, read strictly one at a time.

    Implementations must never buffer ahead. `read()` returns the frame that is
    current *now*; there is no seeking and no lookahead. This is what makes an
    uploaded file behave exactly like a camera.
    """

    @abc.abstractmethod
    def open(self) -> SourceInfo:
        """Acquire the underlying capture. Raises SourceError on failure."""

    @abc.abstractmethod
    def read(self) -> np.ndarray | None:
        """Return the next frame, or None when the source has ended."""

    @abc.abstractmethod
    def close(self) -> None:
        """Release the underlying capture. Must be idempotent."""

    @property
    @abc.abstractmethod
    def info(self) -> SourceInfo: ...


class SourceError(RuntimeError):
    """Raised when a source cannot be opened or has failed irrecoverably."""
