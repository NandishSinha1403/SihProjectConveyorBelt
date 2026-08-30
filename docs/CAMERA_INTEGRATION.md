# Camera Integration

Swapping test footage for a real camera is a configuration change. No code is
edited, nothing is rebuilt, and the detection pipeline, dashboard and incident
history behave identically either way.

## The one thing that matters: `SOURCE_URI`

Every input resolves through a single function,
[`backend/app/sources/factory.py`](../backend/app/sources/factory.py)`::from_uri`.

| URI | Source class | Use |
| --- | --- | --- |
| `file://media/uploads/belt.mp4` | `FileSource` | recorded test footage, paced like a camera |
| `device://0` | `DeviceSource` | laptop webcam, USB industrial camera |
| `rtsp://user:pass@10.0.0.5:554/stream1` | `RtspSource` | IP / PoE camera on a gantry |
| `http://10.0.0.6/mjpg/video.mjpg` | `HttpMjpegSource` | MJPEG-over-HTTP camera |

Three ways to set it:

1. **From the dashboard** — Sources → pick a video, scan for cameras, or paste
   an RTSP URL. Takes effect immediately.
2. **`POST /api/stream/start`** with `{"uri": "rtsp://..."}`.
3. **`backend/.env`** — set `SOURCE_URI=rtsp://…` and the backend starts
   monitoring that camera automatically on boot, so a power cycle at the plant
   resumes unattended.

## Why an uploaded video is a fair stand-in for a camera

The concern with testing against a file is that the model could be handed the
whole video and process it as a batch — which would prove nothing about
real-time behaviour. That cannot happen here:

- **Uploading decodes nothing.** `POST /api/sources/upload` writes bytes to
  `backend/media/uploads/` and returns. No frame is read.
- **Playback is paced by the wall clock.** `FileSource.read()` sleeps against a
  monotonic deadline so a 25 fps video advances at 25 fps of real time.
  A 60-second clip takes 60 seconds.
- **There is no frame queue.** Capture writes into a one-deep slot
  (`LatestFrame`); the inference thread reads whatever is current. If inference
  is slower than the source, the intervening frames are **dropped**, never
  buffered.
- **You can see it happening.** The dashboard's *Frames skipped* counter is
  exactly those dropped frames. A batch process would sit at zero forever.

Tests pinning this behaviour live in
[`backend/tests/test_realtime.py`](../backend/tests/test_realtime.py).

## macOS: camera permission

macOS gates camera access behind AVFoundation, and OpenCV can only raise the
permission prompt from the process **main thread**. The backend opens cameras
from worker threads, so the prompt would never appear and the camera would
silently fail to initialise.

The backend therefore sets `OPENCV_AVFOUNDATION_SKIP_AUTH=1` and relies on the
host terminal already holding camera permission. To grant it once:

```bash
python scripts/grant_camera_access.py
```

Approve the prompt, then restart the backend. If no prompt appears, enable your
terminal under **System Settings → Privacy & Security → Camera**.

## RTSP cameras

- **TCP transport is forced** (`rtsp_transport;tcp`). On a noisy industrial
  network, UDP packet loss produces smeared frames that generate phantom
  detections.
- **The driver buffer is capped at one frame** so `read()` returns what the
  camera sees now, not a stale backlog.
- **Credentials are redacted** from every log line and from the dashboard. A URL
  like `rtsp://admin:hunter2@10.0.0.5:554/s1` is displayed as
  `rtsp://***@10.0.0.5:554/s1`.
- Most IP cameras expose a low-resolution substream
  (often `/stream2` or `?subtype=1`). Prefer it: 720p is plenty for belt
  inspection and costs far less CPU than 4K.

## Adding a camera type OpenCV cannot open

GigE Vision / GenICam industrial cameras need a vendor SDK. Add one class:

```python
# backend/app/sources/genicam.py
from .base import FrameSource, SourceInfo

class GenicamSource(FrameSource):
    def open(self) -> SourceInfo: ...   # acquire the vendor handle
    def read(self):                     # return one BGR ndarray, or None
        ...
    def close(self) -> None: ...
    @property
    def info(self) -> SourceInfo: ...
```

Then add one branch to `from_uri`:

```python
if scheme == "genicam":
    return GenicamSource(parsed.netloc)
```

Nothing else changes. The pipeline, MJPEG stream, incident engine and dashboard
all work through the `FrameSource` interface alone.

## Physical mounting notes

Drawn from Guo et al. (Micromachines 2022, sec. 3.3.3), which surveys deployed
installations:

- Mount the camera **between the upper and lower belt runs, looking up at the
  underside of the carrying belt**. The top surface is buried under ore; the
  underside is clean and is where longitudinal rips are visible first.
- Use a **dedicated light source** beside the camera. Underground there is no
  ambient light at all, which is an advantage: lighting becomes fully
  controllable.
- Dust is the dominant image-quality problem. The CLAHE preprocessing step
  (Settings → Image Preprocessing) is the software mitigation; an infrared or
  multispectral camera is the hardware one, and the paper's sec. 3.3.1 covers
  the trade-offs.
- For belt-position tracking (needed by the digital-twin belt map in a later
  phase), add a **shaft encoder** on the tail pulley, or detect the splice joint
  once per revolution and count frames between sightings.
