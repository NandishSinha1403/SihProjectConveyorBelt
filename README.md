# Belt Sentinel

**Real-time AI vision monitoring for conveyor belt damage and joint rupture in
iron ore mining.**

A camera watches the belt. A YOLO detector finds tears, holes and joint
ruptures. A control-room dashboard shows the annotated feed, a live alert rail,
a belt health index, and a searchable incident history with photographic
evidence.

Built for the Smart India Hackathon problem statement *"Belt Joint Rupture and
Conveyor Belt Damages in Iron Ore Mining Industry"*. This repository is **Phase
1: the AI vision module**, architected so the IoT sensor layer, predictive
analytics and digital twin attach without rework.

---

## Contents

| | |
| --- | --- |
| [Results](#results) | Measured performance, on footage never trained on |
| [Quick start](#quick-start) | Running it in two commands |
| [Architecture](#architecture) | How the pipeline fits together |
| [The real-time guarantee](#the-real-time-guarantee) | Why a video file is an honest stand-in for a camera |
| [From detections to incidents](#from-detections-to-incidents) | Turning thousands of boxes into a handful of events |
| [Models](#models) | `belt_v1` and `belt_v2`, and when to use each |
| [Training on your own belt](#training-on-your-own-belt) | The labelling and training toolchain |
| [Configuration](#configuration) · [API](#api) · [Deployment](#deployment) | Reference |

---

## Results

Two models ship with this repository. The number that matters is not validation
mAP — it is performance on footage the model has never seen.

### `belt_v2` — specialised to the prototype rig

Measured against a held-out video and a set of photographs, neither used in
training:

| Test | `belt_v1` | **`belt_v2`** |
| --- | --- | --- |
| Long tear (6 stills) | 0 / 6 | **6 / 6** |
| Large hole (4 stills) | 0 / 4 | **4 / 4** |
| Small tear (8 stills) | 1 / 8 | **8 / 8** |
| Hole (7 stills) | 4 / 7 | **6 / 7** |
| Joint rupture (4 stills) | 2 / 4 *(mislabelled `tear`)* | **3 / 4 — correct class** |
| **Total** | **7 / 29** | **27 / 29** |
| Held-out video, 281 frames | 33% of frames, *every box mislabelled* `hole` | **52% of frames**, `hole` and `tear` distinguished |

And the check that matters most for a live demo — 614 frames of running belt,
where the splice passes the camera on every revolution:

```
detections: {'hole': 193, 'tear': 155}
joint_damage fired on 0 frames (0.0%)
```

**Zero false rupture alarms.** The model detects the rupture where the rupture
actually is, and never fires on an intact seam.

### Reproduce it

```bash
python training/evaluate.py --weights backend/models/belt_v2.pt \
  --video "assets/all picture /Movie on 31-08-26 at 6.43 PM.mov"

python training/evaluate.py --weights backend/models/belt_v2.pt --images assets
```

### Honest caveats

- **A detection rate is not accuracy.** It counts frames containing any box.
  Many frames legitimately contain no defect, because defects rotate in and out
  of view. Read 52% as "far more of the belt is now seen correctly", not as a
  miss rate.
- **`joint_damage` is trained on 6 instances of one physical rupture.** It
  reliably detects *that* rupture on *that* belt under *that* lighting, which is
  what a demonstration needs. It is not general joint-rupture detection, and
  should not be described as such.
- **`belt_v2` is deliberately specialised** and is expected to do poorly on
  industrial belt imagery. `belt_v1` remains in the repository for that case;
  see [Models](#models).

---

## Quick start

```bash
pip install -r backend/requirements.txt
./scripts/start.sh
```

Open <http://localhost:5173>, go to **Sources**, and press **Stream**. Or skip a
step:

```bash
./scripts/start.sh --source device://0                          # a camera
./scripts/start.sh --source file://media/uploads/sample.mp4     # a test video
```

Tests: `python -m pytest tests/ -v` in `backend/`.

### Scripts

| Command | Does |
| --- | --- |
| `./scripts/start.sh` | Start both services. Checks dependencies, waits for health, reports URLs. `--backend` for API only, `--source <uri>` to stream immediately. |
| `./scripts/stop.sh` | Graceful SIGTERM, escalating only if ignored. Finds processes by port, so it works even if they were started by hand. |
| `./scripts/status.sh` | One screen: services, stream stats, incident counts, model state, training progress. |
| `./scripts/train.sh` | Train detached. `--fast` for yolo11n/60 epochs. |
| `./scripts/train-watch.sh` | Live training dashboard — progress, ETA, mAP trend, best epoch. |

All honour `NO_COLOR` and drop styling when piped.

It runs with no trained model at all: `DETECTOR=mock` produces synthetic defects
so the pipeline and dashboard are demonstrable before training finishes. The
mock is **scaffolding, not a demo** — it labels itself "SYNTHETIC, not a trained
model" everywhere it appears, and its defects ride the belt's *measured*
direction of travel rather than a hardcoded axis, so it never visibly disagrees
with the footage. `DETECTOR=yolo` removes it entirely.

---

## Architecture

```
                 ┌───────────── FrameSource ─────────────┐
  file:// ──▶    │  FileSource   (paced by wall clock)   │
  device:// ──▶  │  DeviceSource (paced by the driver)   │
  rtsp:// ──▶    │  RtspSource / HttpMjpegSource         │
                 └───────────────────┬───────────────────┘
                                     │  capture thread
                                     ▼
                          ┌──────────────────┐
                          │  LatestFrame     │  one slot, no queue
                          │  (frame N only)  │  ← older frames are dropped
                          └────────┬─────────┘
                                   │  inference thread
                                   ▼
        CLAHE (off) ──▶ YOLO + ByteTrack ──▶ IncidentEngine
                                   │              │
                    annotated frame│              │ open / update / close
                                   ▼              ▼
                          MJPEG stream       EventBus ──▶ WebSocket ──▶ React
                                                  │
                                                  ▼
                                              SQLite + snapshot JPEGs
```

`EventBus` is topic-based publish/subscribe. The vision pipeline is merely its
first publisher — the deferred sensor layer, health scorer and SCADA bridge
attach to the same bus without touching anything above.

### Layout

```
backend/     FastAPI service — sources, pipeline, incident store, REST + WebSocket
frontend/    React + Vite + Tailwind dashboard
training/    Frame extraction, labelling tool, dataset splitting, training, evaluation
docs/        Camera integration, datasets, deployment, troubleshooting, model report
DESIGN.md    The dashboard's design system — source of the tokens in frontend/src/index.css
```

### Documentation

| File | Covers |
| --- | --- |
| [`docs/CAMERA_INTEGRATION.md`](docs/CAMERA_INTEGRATION.md) | Source URIs, adding a camera type, USB vs IP cameras, mounting |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Black or frozen feeds, missing detections, slow inference, CORS |
| [`docs/DATASETS.md`](docs/DATASETS.md) | Public data contents, class mapping, attribution |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Vercel + Render, and the CORS loop |
| [`docs/model_report.md`](docs/model_report.md) | Measured metrics for the shipped weights |
| [`DESIGN.md`](DESIGN.md) | Colour, type and spacing tokens for the dashboard |

---

## The real-time guarantee

The point of this system is monitoring a live feed. Testing against a video file
is only honest if the file is treated *exactly* like a camera — so it is:

| | |
| --- | --- |
| **Uploading decodes nothing** | The file is written to disk and the request returns. No frame is read. |
| **Playback tracks the wall clock** | A 25 fps video advances at 25 fps of real time. A 60-second clip takes 60 seconds. |
| **No frame queue exists** | Capture writes into a one-deep slot. The detector reads whatever is current. |
| **Slow inference drops frames** | Frames arriving while the model is busy are discarded, never buffered. |
| **You can watch it happen** | The *Frames skipped* counter is exactly those dropped frames. A batch process would read zero forever. |

Swapping in a real camera is then a one-line change (`SOURCE_URI=device://0`),
because the file source and the camera source satisfy the same contract.

This is pinned by tests, which exist because the guarantee is easy to break with
an innocuous-looking change — swapping the frame slot for a queue would do it —
and impossible to notice by eye.

---

## From detections to incidents

A detector emits hundreds of boxes for a single tear. Operators need *events*,
so [`app/pipeline/events.py`](backend/app/pipeline/events.py) does three things.

**1. Landmarks are not events.** A belt is a loop, so its splice passes the
camera every revolution. Raising an incident on sight produced hundreds of
identical `Belt Joint / INFO` rows in a single session, burying the tears and
holes an operator actually needs. `belt_joint` is therefore never alarmed on.

What *is* an event is the splice **failing** — separating at the belt edge into
an open wedge. That is `joint_damage`, surfaced as **Belt Joint Rupture** at
CRITICAL, and it is a *directly trained class* rather than something inferred
from geometry. An earlier version derived it from a tear overlapping a healthy
joint band; a measured detection replaced the heuristic and the geometry was
deleted.

**2. Geometry-driven severity.** A long, narrow, longitudinal defect is the
rip-through case and escalates hardest. An isolated scratch stays LOW.

**3. Temporal confirmation.** A track must survive `CONFIRM_FRAMES` consecutive
frames before raising an incident, which suppresses the small-object false
positives Guo et al. identify as the standard failure mode of one-stage
detectors on this task.

Each confirmed incident writes a snapshot JPEG and a database row — evidence for
a maintenance report, and the substrate for the predictive phase.

---

## Models

| | `belt_v1` | `belt_v2` |
| --- | --- | --- |
| Trained on | 1,573 public industrial images | 158 images of this project's rig |
| Classes | `tear` `hole` `belt_joint` | `tear` `hole` `joint_damage` |
| Validation mAP@.5 | 95.1% | 85.6% |
| On the prototype rig | 7 / 29 stills | **27 / 29 stills** |
| Use for | Industrial belt imagery | The prototype rig, and the demonstration |

Switch with `MODEL_PATH` in `backend/.env`. Both remain in the repository
deliberately — a model trained on public industrial imagery does not transfer to
a different belt, and the reverse is equally true.

The gap is a domain shift, not a tuning problem. Lowering confidence from 0.35
to 0.05 moved `belt_v1` from 7/29 only to 12/29, and 1280px input reached the
same. The features were not being extracted at all: this rig is black rubber
where defects read as *bright background showing through*, while the public data
is dusty grey belting where defects are dark-on-dark texture. Close to inverted
problems.

`belt_v2` is `yolo11s` warm-started from `belt_v1.pt` rather than from COCO
weights — the belt-damage features are already present, and adapting them
converges far faster on a few hundred images than relearning would.

---

## Training on your own belt

The toolchain assumes you have footage of your own belt and no labelling budget.
Nothing here requires an account or an upload.

```bash
python training/extract_frames.py     # footage  -> frames worth labelling
python training/label_tool.py         # label them in a local browser page
python training/split_dataset.py      # split by time, not at random
```

Then run [`kaggle_rig.ipynb`](kaggle_rig.ipynb) on a free Kaggle GPU.

### 1. Extract frames

`extract_frames.py` is not an ffmpeg dump. At 30 fps consecutive frames are the
same picture, so it samples sparsely, drops frames too motion-blurred to label
honestly, de-duplicates the survivors, and excludes by name any clip that would
corrupt the run — a duplicate re-encode, a smeared take, and the held-out
field-test video.

### 2. Label

`label_tool.py` serves a single local page: drag a box, `1`/`2`/`3` for the
class, arrow keys to move on. Everything writes straight to disk as YOLO label
files.

It distinguishes three states, and the distinction matters:

- **labelled** — has one or more boxes.
- **negative** — reviewed, genuinely no defect. **Kept**, with an empty label
  file. These are background examples, and they are the cheapest way to stop a
  model firing on clean belt. 54 of this project's 158 images are negatives.
- **excluded** — not wanted at all, e.g. an angle the deployed camera will never
  see. Not copied to the output.

### 3. Label less, by propagating

For a larger set, label a seed and let a model do the rest:

```bash
python training/pick_seed.py                       # ~25 maximally-varied frames
python training/label_tool.py --dir training/data/seed_frames
python training/propagate_labels.py training/data/labelled
```

`pick_seed.py` chooses by farthest-point sampling over image appearance, so the
seed spreads across lighting, view and belt position rather than clustering on
whatever was filmed longest. `propagate_labels.py` trains on the seed and
pre-labels the rest, converting the human's job from *drawing* boxes into
*correcting* them.

### 4. Split by time, not at random

`split_dataset.py` holds out a contiguous tail of the running-belt clip plus a
sample of stills. A random split would put frames 425 and 430 of the same clip
on opposite sides — the same picture — validating the model on data it
effectively trained on and returning a meaningless score.

### Class vocabulary

`tear` · `hole` · `scratch` · `crack` · `belt_joint` · `joint_damage`

Public datasets name these inconsistently ("Large Tear", "rip", "splice"), so
[`training/classes.py`](training/classes.py) maps every dialect onto these six.
Unmapped labels are reported rather than silently dropped.

The rig model trains on three of them. A healthy joint is not a defect and is
not labelled. `scratch` and `crack` are excluded because no examples exist — a
model advertising a class it was never shown cannot predict it, and a dead class
in the UI looks like a capability the system does not have.

### Hardware notes

**Batch size is the whole story on 8 GB.** At `--batch 16` a run needs 4.3 GB
and starts paging: ~18 min/epoch. At `--batch 8` it needs 2.4 GB and stays
resident: ~4 min/epoch. Five times faster for one flag, so `scripts/train.sh`
defaults to 8 and warns if you raise it on a small machine.

**Train on a hosted GPU.** [`kaggle_rig.ipynb`](kaggle_rig.ipynb) (rig data) and
[`kaggle_runner.ipynb`](kaggle_runner.ipynb) (public data) both run on Kaggle's
free T4 ×2. Use **Save Version → Save & Run All (Commit)** — a committed run
executes on a separate machine and survives closing the laptop, where an
interactive session dies on an idle disconnect. Both verify their prerequisites
in a preflight cell that fails in seconds rather than after two hours, and both
push the trained weights back to this repository so a run is never stranded in
an output panel.

**macOS 26 note.** Ultralytics validates datasets via
`matplotlib.font_manager.findSystemFonts()`, which on macOS 26 crashes with
`KeyError: '_items'` (the `system_profiler` JSON schema changed) and is slow
even when it works. `training/_env.py` pre-seeds the font cache to sidestep both.

---

## Configuration

All in `backend/.env` (see `.env.example`):

| Key | Default | Notes |
| --- | --- | --- |
| `SOURCE_URI` | *(empty)* | Auto-start this source on boot |
| `DETECTOR` | `mock` | `mock` or `yolo` |
| `MODEL_PATH` | `models/belt_v1.pt` | `belt_v2.pt` for the rig-specialised model |
| `DEVICE` | `auto` | `auto` picks CUDA, then MPS, then CPU |
| `CONF_THRESHOLD` | `0.35` | Below the paper's 0.50 — catches early wear |
| `IOU_THRESHOLD` | `0.45` | NMS overlap threshold |
| `IMG_SIZE` | `640` | Detector input size; capture resolution is independent |
| `ENABLE_CLAHE` | `false` | Contrast enhancement — **off by default, see below** |
| `CONFIRM_FRAMES` | `5` | Frames before a track becomes an incident |
| `MAX_STREAM_FPS` | `30` | MJPEG output cap; does not affect inference |
| `LOOP_FILE_SOURCES` | `true` | Restart a video file when it ends |
| `CORS_ORIGINS` | `localhost:5173` | Comma-separated allow-list |
| `CORS_ORIGIN_REGEX` | *(empty)* | For Vercel's per-deployment preview domains |

Confidence, IoU, CLAHE, confirmation frames and the stream cap are also tunable
live from the dashboard's Settings page.

**Why CLAHE is off.** It is applied to the frame given to the detector, but
nothing in `training/` applies it — so enabling it trains the model on raw
pixels and serves it enhanced ones. Measured with `belt_v1.pt` on this project's
footage:

| | `ENABLE_CLAHE=false` | `ENABLE_CLAHE=true` |
| --- | --- | --- |
| Detections over 150 frames | **58** | 7 |
| Stills with any detection | **13 / 56** | 11 / 56 |
| Inference per frame @1080p | **95.6 ms** | 140.9 ms |

An 88% drop in detections, and 48% slower. The reasoning behind CLAHE is sound —
Guo et al. identify dust and low contrast as the dominant cause of missed
detections — so the knob stays, and becomes the right default the moment
`training/` applies the same enhancement.

---

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/sources/videos` | Test videos on the server |
| `POST /api/sources/upload` | Store a test video (no decoding) |
| `DELETE /api/sources/videos/{name}` | Remove a stored video |
| `GET /api/sources/thumbnail/{name}` | First frame of a stored video |
| `GET /api/sources/devices` | Enumerate attached cameras |
| `POST /api/stream/start` · `POST /api/stream/stop` | Control the pipeline |
| `GET /api/stream/status` | Source, FPS, frames skipped, open incidents |
| `GET /api/stream/mjpeg` | Live annotated video (`?annotate=0` for clean) |
| `GET /api/stream/snapshot` | Single current frame as JPEG |
| `WS /ws/events` | Detections, incidents, pipeline stats |
| `GET /api/incidents` | Filterable incident history |
| `GET /api/incidents/summary` | Aggregates for the belt-health gauge |
| `GET /api/incidents/{id}/snapshot` | Photographic evidence for one incident |
| `GET /api/incidents/export.csv` | Maintenance report export |
| `GET /api/settings` · `PATCH /api/settings` | Read and change runtime knobs |
| `GET /api/health` | Service and stream status |

Interactive documentation at <http://localhost:8000/docs>.

---

## Deployment

Frontend on Vercel, API on Render — both free tiers, both configured in the
repository ([`vercel.json`](vercel.json), [`render.yaml`](render.yaml)). Full
steps and the CORS loop are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

One number to set expectations. Render's free instance is 512 MB and **0.1
vCPU**, with no GPU:

| Where | Per frame | Throughput |
| --- | --- | --- |
| M2 laptop (Apple GPU) | ~35 ms | **~25 fps** |
| One full CPU core | 83 ms | ~12 fps |
| Render free tier | ~830 ms | **~1.2 fps** |

The deployment is the right thing to put in a submission form. It is not where
to run a demonstration — that belongs on a laptop, which is also the honest
topology, since a cloud container cannot see a camera.

---

## Roadmap

Phase 1 is complete. The seams for what follows are already in place:

| Next | Hooks into | Effort |
| --- | --- | --- |
| **Belt-position digital twin** — pin defects to a belt coordinate via frame count × belt speed, so the same tear is visibly the same tear each revolution | `FrameSource` already exposes a monotonic `frame_id` | ~1 day |
| **Defect growth → RUL** — measure a tear across revolutions, fit a growth curve, predict days to critical | The `incidents` table is the training corpus | ~2 days |
| **Maintenance work orders** — critical incident → PDF with snapshot, position, recommended action | Incident schema is already report-shaped | ~½ day |
| **Simulated IoT sensor layer** — vibration/temp/load/speed over the same bus, with injectable fault scenarios | `bus.py` is topic-based pub/sub | ~1 day |
| **Belt misalignment detection** — classical edge detection on belt edges; no training data needed | New pipeline stage beside the detector | ~1 day |
| **Unsupervised anomaly fallback** — PatchCore on belt texture, for damage types with no class | Runs alongside the detector | ~2 days |
| **SCADA / OPC-UA bridge** — expose incidents as OPC-UA nodes, emergency stop on CRITICAL | Another bus subscriber | ~2–3 days |

---

## References

Guo, X.; Liu, X.; Zhou, H.; Stanislawski, R.; Królczyk, G.; Li, Z.
*Belt Tear Detection for Coal Mining Conveyors.* **Micromachines** 2022, 13, 449.
<https://doi.org/10.3390/mi13030449>

Their benchmark measured YOLOv5m at 82.5% mAP@.5 and 128 FPS against Faster
R-CNN's 86.4% at 7.4 FPS on a 1,092-image belt dataset — which is why this uses
a one-stage detector. `evaluate.py` prints your numbers beside theirs.

## Licence note

Ultralytics YOLO is AGPL-3.0. Suitable for academic and competition use; it
requires review before any commercial deployment. The `mock` detector path has
no such dependency.
