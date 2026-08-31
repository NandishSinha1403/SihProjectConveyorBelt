# Belt Sentinel — Intelligent Conveyor Belt Health Monitor

Real-time AI vision monitoring for conveyor belt damage and joint rupture in
iron ore mining.

A camera watches the belt; a YOLO detector finds **tears, holes, scratches,
cracks and belt joints**; a control-room dashboard shows the annotated feed, a
live alert rail, a belt health index and a searchable incident history with
photographic evidence.

Built for the SIH problem statement *"Belt Joint Rupture and Conveyor Belt
Damages in Iron Ore Mining Industry"*. This repository is **Phase 1: the AI
vision module**, architected so the IoT sensor layer, predictive analytics and
digital twin slot in without rework.

---

## Quick start

```bash
pip install -r backend/requirements.txt
python backend/scripts/make_sample_video.py   # synthetic belt footage to test with

./scripts/start.sh                            # backend + frontend, with health checks
```

Open <http://localhost:5173>, go to **Sources**, and press **Stream** on
`sample_belt.mp4`. Or skip a step:

```bash
./scripts/start.sh --source file://media/uploads/sample_belt.mp4
./scripts/start.sh --source device://0        # straight to a camera
```

### Scripts

| Command | Does |
| --- | --- |
| `./scripts/start.sh` | Start both services. Checks dependencies, waits for health, reports URLs. `--backend` for API only, `--source <uri>` to begin streaming immediately. |
| `./scripts/stop.sh` | Graceful SIGTERM, escalating only if ignored. Finds processes by port, so it works even if they were started by hand. `--all` also stops training. |
| `./scripts/status.sh` | One screen: services, live stream stats, incident counts, model state, training progress. |
| `./scripts/train.sh` | Train detached. `--fast` for yolo11n/60 epochs, `--data` to fetch and merge datasets first. |
| `./scripts/train-watch.sh` | Live training dashboard — progress, ETA, mAP trend, losses, best epoch. `-1` renders once and exits. |

All of them honour `NO_COLOR` and drop styling when piped.

It runs out of the box with no trained model: `DETECTOR=mock` produces synthetic
defects so the entire pipeline is demonstrable before training finishes. The
mock is **scaffolding, not a demo** — it labels itself "SYNTHETIC, not a trained
model" everywhere it appears, and its defects ride the belt's *measured*
direction of travel rather than a hardcoded axis, so it never visibly disagrees
with the footage. Set `DETECTOR=yolo` once you have weights and it is gone.

---

## The real-time guarantee

The point of this system is monitoring a live feed. Testing against a video file
is only honest if the file is treated *exactly* like a camera — so it is:

| | |
| --- | --- |
| **Uploading decodes nothing** | The file is written to disk and the request returns. No frame is read. |
| **Playback tracks the wall clock** | A 25 fps video advances at 25 fps of real time. A 60-second clip takes 60 seconds. |
| **No frame queue exists** | Capture writes into a one-deep slot. The detector reads whatever is current. |
| **Slow inference drops frames** | Frames that arrive while the model is busy are discarded, never buffered. |
| **You can watch it happen** | The *Frames skipped* counter is exactly those dropped frames. A batch process would read zero forever. |

Swapping in a real camera is then a one-line change (`SOURCE_URI=device://0`),
because the file source and the camera source satisfy the same contract.

This is pinned by tests — `python -m pytest tests/ -v` in `backend/`.

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
             CLAHE ──▶ YOLO + ByteTrack ──▶ IncidentEngine
                                   │              │
                    annotated frame│              │ open / update / close
                                   ▼              ▼
                          MJPEG stream       EventBus ──▶ WebSocket ──▶ React
                                                  │
                                                  ▼
                                              SQLite + snapshot JPEGs
```

**`EventBus`** is a topic-based pub/sub. The vision pipeline is just its first
publisher — the deferred sensor layer, health scorer and SCADA bridge attach to
the same bus without touching any of the above.

### Layout

```
backend/    FastAPI service — sources, pipeline, incident store, REST + WebSocket
frontend/   React + Vite + Tailwind dashboard
training/   Dataset download, class unification, training, evaluation
docs/       Camera integration guide, model report
```

---

## From boxes to incidents

A detector emits hundreds of boxes for a single tear. Operators need events, so
[`app/pipeline/events.py`](backend/app/pipeline/events.py) does three things:

1. **Joint rupture assessment.** A healthy splice is a normal feature of the
   belt and stays informational. A splice with a crack or tear *inside* it is
   reclassified as `joint_damage` and escalated to CRITICAL — the exact failure
   mode this project targets. (Containment ratio, not IoU: joint boxes span the
   full belt width, so a small crack inside one scores an IoU near zero.)
2. **Geometry-driven severity.** A long, narrow, longitudinal defect is the
   rip-through case and escalates hardest. An isolated scratch stays LOW.
3. **Temporal confirmation.** A track must survive N consecutive frames before it
   raises an incident, which suppresses the small-object false positives Guo et
   al. identify as the standard failure mode of one-stage detectors on this task.

Each confirmed incident writes a snapshot JPEG and a database row — evidence for
a maintenance report, and the substrate for the predictive phase.

---

## Training a model

```bash
pip install roboflow ultralytics
./scripts/train.sh --data          # fetch, merge, and train yolo11s
./scripts/train-watch.sh           # watch it live
python training/evaluate.py        # writes docs/model_report.md
```

Then set `DETECTOR=yolo` in `backend/.env` and `./scripts/stop.sh && ./scripts/start.sh`.

**Training publishes itself.** On success, `train.py` installs the weights to
`backend/models/belt_v1.pt` and runs `scripts/publish-model.sh`, which commits
the model, a metrics file and the training plots and pushes them — so an
overnight run is never left stranded on one machine. The Kaggle notebook does
the same via a `GITHUB_TOKEN` secret. Opt out with `--no-publish`.

The publish script stages **only** model artefacts by explicit path, never
`git add -A`, so it cannot sweep up unrelated work in progress. If the remote
has moved on it rebases and retries once; if it still cannot push, the model is
left committed locally and it tells you.

Step by step, if you prefer:

```bash
python training/download_dataset.py --list      # what is available
python training/download_dataset.py             # needs ROBOFLOW_API_KEY
python training/merge_datasets.py               # unify class names, merge, split
python training/train.py --model yolo11s.pt     # 640px, MPS/CUDA/CPU
```

No Roboflow account? Download any YOLO-format dataset by hand and run
`python training/import_dataset.py <zip-or-folder>` instead.

**Class vocabulary** — `tear`, `hole`, `scratch`, `crack`, `belt_joint`,
`joint_damage`. Public datasets name these inconsistently ("Large Tear", "rip",
"splice"), so [`training/classes.py`](training/classes.py) maps every dialect
onto these six; unmapped labels are reported rather than silently dropped.

**What the public data currently supports: three classes.** The available
datasets (1,573 images, 2,844 annotations) contain `tear`, `hole` and
`belt_joint` only — no `scratch` or `crack` examples exist. `merge_datasets.py`
therefore **excludes empty classes from the emitted dataset**: a model
advertising a class it was never shown cannot predict it, and a dead class in
the UI looks like a capability the system does not have. `joint_damage` is the
deliberate exception — it is derived at runtime from a `belt_joint` overlapping
a tear or hole, which is a real inference rather than a placeholder.

`belt_joint` is also under-represented at 18:1. Since joint rupture is the
headline of the problem statement, labelling joints in your own footage is the
highest-value data work available. See [`docs/DATASETS.md`](docs/DATASETS.md)
for the full breakdown, attribution and the unmapped labels worth reconsidering.

**Hardware note — batch size is the whole story on 8 GB.** At `--batch 16` the
run needs 4.3 GB and starts paging: ~18 min/epoch. At `--batch 8` it needs
2.4 GB and stays resident: ~4 min/epoch. Five times faster for one flag, so
`scripts/train.sh` defaults to 8 and warns if you raise it on a small machine.

Measured on an M2/8 GB: `yolo11n` × 60 epochs ≈ 6 hours. `yolo11s` is the
better model — the paper's benchmark was a mid-size one-stage detector — but at
~17 hours for 60 epochs here it is not a sensible local job.

**Train `yolo11s` on a hosted GPU instead:**

| Notebook | Platform |
| --- | --- |
| [`kaggle_runner.ipynb`](kaggle_runner.ipynb) | Kaggle, T4 ×2 — clones this repo, reads the Roboflow key from Kaggle Secrets, attempts DDP across both cards and falls back to one |
| [`training/colab_train.ipynb`](training/colab_train.ipynb) | Google Colab, single T4 — self-contained, no repo clone |

Both fetch and merge the data with the identical class mapping, train, evaluate
against the paper's baseline, and hand back a `best.pt` for `backend/models/`.
Expect roughly 1–2 hours for 120 epochs.

**macOS 26 note.** Ultralytics validates datasets via
`matplotlib.font_manager.findSystemFonts()`, which on macOS 26 crashes with
`KeyError: '_items'` (the `system_profiler` JSON schema changed) — and is
extremely slow even when it works. `training/_env.py` pre-seeds Ultralytics'
font cache to sidestep both; it is imported automatically by `train.py` and
`evaluate.py`.

**Benchmark.** Guo et al. measured YOLOv5m at **82.5% mAP@.5, 128 FPS** against
Faster R-CNN's 86.4% at 7.4 FPS on a 1092-image belt dataset — which is why this
uses a one-stage detector. `evaluate.py` prints your numbers beside theirs.

---

## Deploying

Frontend on Vercel, API on Render — both free tiers, both configured in the
repo ([`vercel.json`](vercel.json), [`render.yaml`](render.yaml)). Full steps
and the CORS loop are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

One number to set expectations before you rely on it. Render's free instance is
512 MB and **0.1 vCPU**, with no GPU:

| Where | Per frame | Throughput |
| --- | --- | --- |
| M2 laptop (Apple GPU) | ~35 ms | **~25 fps** |
| One full CPU core | 83 ms | ~12 fps |
| Render free tier | ~830 ms | **~1.2 fps** |

The deployment is the right thing to put in a submission form. It is not where
to run the demo — that belongs on a laptop, which is also the honest topology,
since a cloud container cannot see a camera anyway.

## Configuration

All in `backend/.env` (see `.env.example`):

| Key | Default | Notes |
| --- | --- | --- |
| `SOURCE_URI` | *(empty)* | Auto-start this source on boot |
| `DETECTOR` | `mock` | `mock` or `yolo` |
| `MODEL_PATH` | `models/belt_v1.pt` | Trained weights |
| `DEVICE` | `auto` | `auto` picks CUDA, then MPS, then CPU |
| `CONF_THRESHOLD` | `0.35` | Below the paper's 0.50 — catches early wear |
| `ENABLE_CLAHE` | `true` | Contrast enhancement for dusty imagery |
| `CONFIRM_FRAMES` | `5` | Frames before a track becomes an incident |
| `MAX_STREAM_FPS` | `20` | MJPEG output cap; does not affect inference |

Confidence, IoU, CLAHE, confirmation frames and the stream cap are also tunable
live from the dashboard's Settings page.

---

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/sources/upload` | Store a test video (no decoding) |
| `GET /api/sources/devices` | Enumerate attached cameras |
| `POST /api/stream/start` | Begin processing a source URI |
| `GET /api/stream/mjpeg` | Live annotated video (`?annotate=0` for clean) |
| `WS /ws/events` | Detections, incidents, pipeline stats |
| `GET /api/incidents` | Filterable incident history |
| `GET /api/incidents/export.csv` | Maintenance report export |
| `GET /api/health` | Service and stream status |

Interactive docs at <http://localhost:8000/docs>.

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

## Licence note

Ultralytics YOLO is AGPL-3.0. Fine for academic and competition use; it requires
review before any commercial deployment. The `mock` detector path has no such
dependency.
