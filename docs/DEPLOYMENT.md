# Deploying — Vercel + Render

Frontend on Vercel, API on Render. Both free tiers.

**Read this first.** The hosted deployment is a real, public, always-addressable
instance of the whole system — the right thing to put in a submission form or
hand to someone remote. It is **not** where you should run the live demo.

Render's free instance is **512 MB of RAM and 0.1 vCPU**, and it has no GPU.
Measured numbers for this model:

| Where | Per frame | Throughput |
| --- | --- | --- |
| M2 laptop, Apple GPU (MPS) | ~35 ms | **~25 fps** |
| One full CPU core | 83 ms | ~12 fps |
| Render free tier (0.1 vCPU) | ~830 ms | **~1.2 fps** |

A belt at 1.2 fps is not a monitoring demo. Run the demo locally with
`./scripts/start.sh`, and use the deployment for the link.

Free instances also **spin down after 15 minutes of inactivity** and take about
a minute to wake, so the first request after a quiet spell will hang. Load the
URL a few minutes before anyone else does.

---

## 1. API on Render

The repo carries a blueprint, so there is nothing to configure by hand.

1. **render.com → New → Blueprint**, point it at this repository.
2. Render reads [`render.yaml`](../render.yaml) and creates `belt-sentinel-api`.
3. Leave `CORS_ORIGINS` blank for now — you do not have the Vercel URL yet.
4. Deploy. The first build takes a while: it installs PyTorch.
5. Check `https://<your-service>.onrender.com/api/health` returns `{"status":"ok"}`.

Two things the blueprint does that matter:

- **Installs from `requirements-cpu.txt`**, which pulls the CPU-only PyTorch
  wheel. The default PyPI wheel bundles CUDA and is several gigabytes — on a
  box with no GPU you would pay that entirely for nothing, and the build would
  not fit.
- **Uses `opencv-python-headless`**. The desktop build links `libGL`, which slim
  container images do not ship, so the normal package fails at import on a
  server. Nothing in this project draws to a window.

The trained weights (`backend/models/belt_v1.pt`, 18 MB) are committed, so the
service boots with a real model rather than the mock.

## 2. Frontend on Vercel

1. **vercel.com → Add New → Project**, import this repository.
2. Vercel reads [`vercel.json`](../vercel.json); leave the framework preset alone.
3. Add one environment variable:

   | Name | Value |
   | --- | --- |
   | `VITE_API_BASE` | `https://<your-service>.onrender.com` |

   No trailing slash. The WebSocket URL is derived from it, so `https://`
   becomes `wss://` automatically.
4. Deploy.

## 3. Close the CORS loop

Back in Render → your service → Environment, set:

```
CORS_ORIGINS = https://<your-project>.vercel.app
```

Preview deployments are already covered: `CORS_ORIGIN_REGEX` matches
`^https://.*\.vercel\.app$`, because Vercel mints a new domain per deployment
and an allow-list cannot name them all.

Redeploy the Render service for it to take effect.

---

## What does not work in the cloud, and why

**Cameras.** `device://0` refers to a webcam on the machine running the backend.
A Render container has no video devices, so the Sources page will scan and find
nothing. This is correct behaviour, not a bug — the camera probe short-circuits
when no `/dev/video*` nodes exist rather than stalling for seconds on a
guaranteed-empty result.

To monitor a real camera you run the backend on a machine that can see it: a
laptop, a mini-PC at the plant, or a Jetson beside the belt. That is the actual
deployment topology for this product; the cloud instance is a shop window.

**RTSP cameras** will work from the cloud *if* the camera is reachable from the
public internet, which on a mine network it will not be.

**Uploaded videos are ephemeral.** Render's free tier has no persistent disk, so
anything uploaded is lost on the next deploy or spin-down. The SQLite incident
history goes with it. Attach a persistent disk (a paid feature) if that matters.

**Bandwidth.** MJPEG is not a compressed video stream; it is a rapid sequence of
whole JPEGs. `MAX_STREAM_FPS` is set to 5 in the blueprint to keep this sane.
Several simultaneous viewers on a hosted instance will feel it.

---

## Running it properly

For a demo that looks like the product actually is:

```bash
./scripts/start.sh --source file://media/uploads/demo_belt_real.mp4
```

25 fps, 35 ms per frame, real detections. If people need to watch remotely,
put a tunnel in front of the local backend rather than moving inference to a
0.1-vCPU box:

```bash
npx localtunnel --port 8000     # or ngrok http 8000
```

then point `VITE_API_BASE` at the tunnel URL.
