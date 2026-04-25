"""Capture camera frames and POST them to the unblind laptop receiver.

Setup (two options):
  Direct (same network, no firewall):
      SERVER = "http://10.226.79.96:8080/frame"

  Via ngrok (school/restricted networks):
      1. On the laptop run:  ngrok http 8080
      2. Copy the https URL, e.g. https://abc123.ngrok-free.app
      SERVER = "https://abc123.ngrok-free.app/frame"

Run on phone (Android/Termux):
    pkg install python
    pip install opencv-python-headless requests
    python phone_sender.py

Run on any laptop/computer as a second camera:
    pip install opencv-python requests
    python phone_sender.py
"""

from __future__ import annotations

import sys
import time

import cv2
import requests

# ── configure these ───────────────────────────────────────────────────────────

SERVER  = "http://CHANGE_ME:8080/frame"  # direct IP or ngrok URL
CAMERA  = 0                              # 0 = default cam, 1 = second cam
FPS     = 6                              # frames per second to send
QUALITY = 75                             # JPEG quality 1-100

# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    if "CHANGE_ME" in SERVER:
        sys.exit(
            "Set SERVER in phone_sender.py before running.\n"
            "  Direct:  http://10.226.79.96:8080/frame\n"
            "  ngrok:   https://abc123.ngrok-free.app/frame"
        )

    cap = cv2.VideoCapture(CAMERA)
    if not cap.isOpened():
        sys.exit(f"Cannot open camera {CAMERA}")

    interval = 1.0 / FPS
    encode_params = [cv2.IMWRITE_JPEG_QUALITY, QUALITY]
    session = requests.Session()

    print(f"Sending to {SERVER}  ({FPS} fps)  — Ctrl+C to stop")

    try:
        while True:
            t0 = time.monotonic()

            ok, frame = cap.read()
            if not ok:
                print("Camera read failed, retrying…")
                time.sleep(0.5)
                continue

            ok, buf = cv2.imencode(".jpg", frame, encode_params)
            if not ok:
                continue

            try:
                session.post(
                    SERVER,
                    data=buf.tobytes(),
                    headers={"Content-Type": "image/jpeg"},
                    timeout=2,
                )
            except requests.exceptions.RequestException as exc:
                print(f"Send error: {exc}")

            elapsed = time.monotonic() - t0
            wait = interval - elapsed
            if wait > 0:
                time.sleep(wait)

    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        cap.release()


if __name__ == "__main__":
    main()
