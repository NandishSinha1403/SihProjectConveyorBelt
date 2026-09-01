# Troubleshooting

Symptoms in the order you are likely to hit them, each with the measurement that
tells you which cause you have. Every number here was measured on this project;
where a figure is machine-specific it says so.

---

## The dashboard shows a camera, but the picture is black or frozen

This has three different causes with three different fixes, and guessing between
them wastes time. Measure first.

**Check whether the camera delivers frames at all**, outside the pipeline:

```python
python3 - <<'EOF'
import cv2, time
for idx in range(4):
    cap = cv2.VideoCapture(idx)
    if not cap.isOpened():
        print(f"index {idx}: not open"); cap.release(); continue
    for _ in range(5): cap.read()          # let it settle
    n, t = 0, time.time()
    while time.time() - t < 3:
        ok, f = cap.read()
        if ok and f is not None: n += 1
    print(f"index {idx}: {int(cap.get(3))}x{int(cap.get(4))}  {n/3:.1f} fps")
    cap.release()
EOF
```

Read the result like this:

| Result | Cause | Fix |
| --- | --- | --- |
| Healthy fps here, bad in the dashboard | The pipeline, not the camera | See *Inference is slow* below |
| Low or erratic fps here too | The camera or its connection | Next section |
| `not open` for every index | Permission, or nothing attached | See *Camera permission* |

An observed example of the middle case: a USB webcam measured **0.6, 2.2 and 9.6
fps across three consecutive runs of the same test**, at 1920×1080, 1280×720 and
640×480 alike, while the built-in camera held a steady **29.7 fps** in the same
process seconds later. Nothing in this codebase can fix that — it is the camera,
its cable, or the port.

**Confirm it with a non-OpenCV app.** Open Photo Booth or QuickTime → New Movie
Recording and select the camera.

- Choppy there too → cable, port, or hardware. Try another port, not through a
  hub, since bus-powered hubs are a common cause.
- Smooth there → macOS drives it fine but OpenCV's AVFoundation path cannot.
  Use a different camera, or an RTSP/IP camera, which has none of these problems.

---

## The camera list shows the wrong cameras, or one that does not exist

`device://N` uses an OpenCV capture index, and **an index is not a camera
identity**. OpenCV assigns indices per process, and they drift when a camera is
plugged in or removed while the backend is running.

Measured on this project: a backend that had been running for an hour offered a
single `device://2` on a machine whose cameras were really at indices 0 and 1 —
a freshly started Python process at the same moment on the same machine saw
`device://0` and `device://1`. The dashboard listed one camera that did not
exist and neither of the two that did.

**Fix:** restart the backend after plugging or unplugging a camera.

```bash
./scripts/stop.sh && ./scripts/start.sh
```

Two further consequences worth knowing:

- **The list is only refreshed when you press Scan.** The Sources page does not
  probe cameras on load.
- **`Camera 0` / `Camera 1` are positional labels, not names.** OpenCV exposes no
  device names, and the operating system's own enumeration order is *not*
  OpenCV's index order — verified on macOS 26, where AVFoundation listed the
  built-in camera first while OpenCV opened the USB camera at index 0. So do not
  assume `Camera 0` is the built-in. Identify a camera by streaming it and
  looking at the picture.

Network cameras avoid all of this: `rtsp://` and `http://` sources have no index
space, so a newly connected IP camera works immediately with no restart.

---

## Camera permission (macOS)

macOS gates camera access behind AVFoundation, and OpenCV can only raise the
permission prompt from the process **main thread**. The backend opens cameras
from worker threads, so the prompt would never appear and the camera would
silently fail to initialise. The backend therefore sets
`OPENCV_AVFOUNDATION_SKIP_AUTH=1` and relies on the terminal already holding
permission.

```bash
python backend/scripts/grant_camera_access.py
```

Approve the prompt and restart the backend. If no prompt appears, enable your
terminal under **System Settings → Privacy & Security → Camera**.

---

## Detections are missing, or far fewer than expected

**Check `ENABLE_CLAHE` first** — it must be `false` unless you retrained with it.
CLAHE is applied to the frame handed to the detector (`app/pipeline/worker.py`),
but it is *not* applied anywhere in `training/`. Turning it on therefore trains
the model on raw pixels and serves it enhanced ones — a preprocessing mismatch
between training and serving. It ships off for this reason; if you inherited an
older `backend/.env`, check it.

Measured with `belt_v1.pt` on this project's own footage:

| | `ENABLE_CLAHE=false` (default) | `ENABLE_CLAHE=true` |
| --- | --- | --- |
| Detections over 150 video frames | **58** | 7 |
| Still images with any detection | **13 / 56** | 11 / 56 |
| Inference time per frame @1080p | **95.6 ms** | 140.9 ms |

An 88% drop in detections on video, and 48% slower. The rationale for CLAHE is
sound in principle — Guo et al. identify dust and low contrast as the dominant
cause of missed detections — but it was never validated against *this* model.

**Fix:** set `ENABLE_CLAHE=false` in `backend/.env`, or turn *Image
preprocessing* off in Settings, which takes effect immediately on the running
stream without a restart. If you want the contrast enhancement, apply CLAHE
during training too so the model sees the same distribution it is served.

**Second thing to check: the model only knows three classes.** `belt_v1.pt` was
trained on `tear`, `hole` and `belt_joint`. `scratch` and `crack` exist in the
class vocabulary but no public training data for them exists, so the model
cannot emit them — see [DATASETS.md](DATASETS.md). `joint_damage` is derived at
runtime from a `belt_joint` that damage touches, not predicted directly.

**Third: the confidence threshold.** `CONF_THRESHOLD` defaults to 0.35,
deliberately below the paper's 0.50 so early wear is caught. Raising it trades
recall for precision.

---

## Detections appear but no incidents are raised

A detection becomes an incident only after it survives `CONFIRM_FRAMES`
consecutive frames (default 5) **and** carries a tracking id. If tracking is
unavailable, every detection is discarded by the incident engine, the video
still shows boxes, and the alert rail stays silent with no error anywhere.

The detector checks for this explicitly at startup and logs loudly. Look for:

```
Object tracking is unavailable (...). Detections will still be drawn, but no
incidents can be raised
```

**Fix:** `pip install lapx` — it is ByteTrack's assignment solver and is already
in `requirements.txt`. The dashboard also shows `TRACKING UNAVAILABLE` beside the
detector name when this happens.

If tracking *is* working, the other cause is the incident bar. A detection
below `INCIDENT_CONFIDENCE_THRESHOLD` (default 0.50) is drawn and streamed but
never advanced into a track, so it stays a box forever. This is deliberate —
the detector runs at 0.35 so marginal wear is visible without becoming a
maintenance record — but it means a run of low-confidence detections produces
boxes and no incidents, with nothing logged to explain it. Check the confidence
on the boxes you are seeing, and lower the threshold from **Settings** if the
bar is genuinely too high for your footage.

---

## Inference is slow, or the stream lags

Check `inference_ms` and `frames_skipped` in the telemetry strip, or:

```bash
curl -s localhost:8000/api/stream/status | python3 -m json.tool
```

Frames being skipped is **not** a fault — it is the design. Capture writes into a
one-deep slot and the detector reads whatever is current, so when inference is
slower than the source, frames are dropped rather than queued. That is what makes
a file source behave like a camera.

What actually costs time, measured on an M2:

| | Cost |
| --- | --- |
| Capture resolution 1080p vs 720p | 140.9 ms → 57.1 ms per frame |
| CLAHE at 1080p | ~45 ms per frame |
| YOLO at `IMG_SIZE=640` on MPS | ~30 ms per frame |

`DeviceSource` requests 1280×720 by default for exactly this reason: the detector
runs at 640px regardless, so 1080p costs bandwidth and CLAHE time for no gain in
what the model sees.

**To watch the camera without paying for inference at all**, press **O** in the
Live Monitor to cycle the overlay to *Browser* or *Off*. Those serve the raw
frame slot, which the capture thread fills directly — no YOLO, no CLAHE, no
annotation.

---

## The backend will not start, or the model will not load

`build_detector()` falls back to `MockDetector` rather than refusing to start, so
a broken model shows up as obviously synthetic detections labelled *"SYNTHETIC,
not a trained model"* rather than a dead server. Check the log for:

```
Falling back to MockDetector: ...
```

Common causes: `MODEL_PATH` pointing at weights that are not there, or
`ultralytics`/`torch` not installed. `DETECTOR=mock` is the deliberate
no-model path and needs neither.

---

## The dashboard cannot reach the API

The browser console shows CORS errors, or the WebSocket never connects.

- `CORS_ORIGINS` must list the exact origin the dashboard is served from,
  including port and scheme.
- On Vercel, every deployment gets a fresh preview domain, so an allow-list
  cannot name them all — set `CORS_ORIGIN_REGEX` instead. See
  [DEPLOYMENT.md](DEPLOYMENT.md).
- In local development, leave `VITE_API_BASE` unset so paths stay relative and
  Vite's proxy handles them.

---

## The 3D Model tab says OFFLINE while the rig is running

The tab renders the model fine, but the telemetry panel reads `OFFLINE`, the
red interlock banner is stuck on, and the belt never moves.

**This failure is silent by design, which makes it confusing.** The feed hook
swallows its query error (`if (!error && data)`), so a rejected request looks
exactly like a rig that is powered off: no row ever arrives, `lastUpdatedAt`
stays null, and the offline ticker holds `connected: false`. Nothing is logged.

Work through it in this order.

**1. Is the key valid?** Ask the REST API directly, substituting your own
project URL and anon key:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://<ref>.supabase.co/rest/v1/readings?select=*&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

`200` means the credentials are good. `401` (`{"message":"Invalid API key"}`)
means they are not — and this is the most common cause, because the key is a
long opaque string where `1` and `l` are easy to confuse when retyped by hand.
Copy it, never transcribe it.

**2. Is it the right `.env`?** Vite reads **`frontend/.env`**, not
`backend/.env`. Updating the key in the backend file changes nothing for the
browser; the two must be kept in step by hand. Vite also only exposes variables
prefixed `VITE_`, and **only reads `.env` at startup** — restart the dev server
after editing it.

**3. Is the node actually posting?** Poll the newest row and watch whether the
id advances:

```bash
curl -s "https://<ref>.supabase.co/rest/v1/readings?select=id,created_at\
&device=eq.belt-monitor-1&order=created_at.desc&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

A climbing `id` means the rig is alive and the fault is in the browser. A
frozen one means the node has stopped or lost Wi-Fi.

**4. Does the device id match?** The hook filters on `device=eq.belt-monitor-1`
(`DEVICE_ID` in `frontend/src/lib/rig/useLiveBeltFeed.ts`). Rows written under
any other device name are invisible to it, and the query succeeds with zero
rows — indistinguishable from an offline rig.

### It flickers OFFLINE and back

Different problem. `OFFLINE_AFTER_MS` is 5 s, but the node's posting is bursty
— gaps of 15 s or more have been measured on a healthy rig. Every gap longer
than the threshold trips the banner. Raise `OFFLINE_AFTER_MS` in
`useLiveBeltFeed.ts` to comfortably exceed the worst gap you actually observe
in step 3.
