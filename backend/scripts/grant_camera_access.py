"""Raise the macOS camera permission prompt for this terminal.

The backend opens cameras from worker threads, and macOS only allows the
AVFoundation authorisation prompt to be raised from a process's main thread.
This script does nothing but open camera 0 on the main thread, which triggers
the prompt once. After granting access, the terminal (and anything launched
from it, including the backend) can use the camera.

    python scripts/grant_camera_access.py
"""
from __future__ import annotations

import sys

import cv2


def main() -> int:
    if sys.platform != "darwin":
        print("This helper is only needed on macOS.")
        return 0

    print("Opening camera 0 — approve the permission prompt if one appears…")
    cap = cv2.VideoCapture(0)
    try:
        if not cap.isOpened():
            print(
                "\nCould not open the camera.\n"
                "Open System Settings > Privacy & Security > Camera and enable "
                "access for your terminal application, then run this again."
            )
            return 1

        ok, frame = cap.read()
        if not ok or frame is None:
            print("Camera opened but returned no frame. Is another app using it?")
            return 1

        h, w = frame.shape[:2]
        print(f"Camera access granted. Captured a {w}x{h} frame.")
        print("The backend can now use device://0. Restart it if it is running.")
        return 0
    finally:
        cap.release()


if __name__ == "__main__":
    raise SystemExit(main())
