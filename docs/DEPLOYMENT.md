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

## 1. Supabase — the incident history

Do this first: the API will not start without it.

Render's free instance has no persistent disk, so incidents and snapshots
cannot live on it. They live in Supabase instead — Postgres for the rows, a
Storage bucket for the snapshot JPEGs.

1. **supabase.com → New project.** Free tier. Note the database password.
2. **Storage → New bucket**, named `snapshots`, **private**. Leave it private:
   the API hands out short-lived signed URLs rather than public ones.
3. Collect three values:

   | Setting | Where |
   | --- | --- |
   | `DATABASE_URL` | Project Settings → Database → **Connection pooling**, transaction mode (port **6543**) |
   | `SUPABASE_URL` | Project Settings → API → Project URL |
   | `SUPABASE_SERVICE_KEY` | Project Settings → API → `service_role` key |

   Use the **pooler** connection string, not the direct one on port 5432. The
   direct host is IPv6-only and Render's free tier cannot reach it.

   The `service_role` key bypasses row-level security. It belongs in the
   backend's environment and nowhere else — never in the frontend, never
   committed.

4. Nothing to create by hand: the tables and indexes are created on first boot.

Free projects **pause after 7 days of inactivity** and need a manual unpause
from the dashboard. That is a second thing to wake before a demo, alongside
Render's spin-down.

Migrating an existing local SQLite history:

```bash
python backend/scripts/migrate_to_supabase.py --dry-run
python backend/scripts/migrate_to_supabase.py
```

## 2. API on Render

The repo carries a blueprint, so there is nothing to configure by hand.

1. **render.com → New → Blueprint**, point it at this repository.
2. Render reads [`render.yaml`](../render.yaml) and creates `belt-sentinel-api`.
3. Fill in `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from step 1
   — the blueprint declares them but cannot carry secrets.
4. Leave `CORS_ORIGINS` blank for now — you do not have the Vercel URL yet.
5. Deploy. The first build takes a while: it installs PyTorch.
6. Check `https://<your-service>.onrender.com/api/health` returns `{"status":"ok"}`.

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

## 3. Frontend on Vercel

1. **vercel.com → Add New → Project**, import this repository.
2. Vercel reads [`vercel.json`](../vercel.json); leave the framework preset alone.
3. Add one environment variable:

   | Name | Value |
   | --- | --- |
   | `VITE_API_BASE` | `https://<your-service>.onrender.com` |

   No trailing slash. The WebSocket URL is derived from it, so `https://`
   becomes `wss://` automatically.
4. Deploy.

## 4. Close the CORS loop

Back in Render → your service → Environment, set:

```
CORS_ORIGINS = https://<your-project>.vercel.app
```

Preview deployments are already covered: `CORS_ORIGIN_REGEX` matches
`^https://.*\.vercel\.app$`, because Vercel mints a new domain per deployment
and an allow-list cannot name them all.

Redeploy the Render service for it to take effect.

## 5. Custom domain — `sih.nandish.dev`

At your DNS provider for `nandish.dev`, add one record:

| Type | Name | Value |
| --- | --- | --- |
| `CNAME` | `sih` | `cname.vercel-dns.com` |

Then Vercel → project → **Settings → Domains → Add** `sih.nandish.dev`. Vercel
verifies the record and issues a TLS certificate automatically, usually within
a minute.

**Then go back and fix CORS.** The preview regex matches `*.vercel.app` and
will not match a custom domain, so the API will start refusing the very origin
you just set up. In Render → Environment:

```
CORS_ORIGINS = https://sih.nandish.dev,https://<project>.vercel.app
```

Keep the `vercel.app` entry so the Vercel dashboard link keeps working.

### Optionally, give the API a matching subdomain

`belt-sentinel-api.onrender.com` works fine, but a matching subdomain reads
better and means the API URL never changes if you move host later:

| Type | Name | Value |
| --- | --- | --- |
| `CNAME` | `api.sih` | `<your-service>.onrender.com` |

Add `api.sih.nandish.dev` under Render → Settings → Custom Domains, then set
`VITE_API_BASE=https://api.sih.nandish.dev` in Vercel and redeploy.

Note this does **not** make the two same-origin — `sih.nandish.dev` and
`api.sih.nandish.dev` are still different origins, so CORS still applies. It is
cosmetic and portability, not a way to avoid the CORS step.

---

## Why not serve the model from Kaggle?

Kaggle gives free T4s, so the question comes up. It is technically possible —
run the API in a notebook and tunnel it out with ngrok. For this product it is
the wrong shape:

- **No speed to gain.** A laptop GPU already runs this at ~35 ms/frame. A T4
  might reach ~15 ms, but a tunnel adds 200–400 ms of round trip. You would pay
  latency for nothing, in a system whose entire claim is real-time.
- **The URL changes every session.** ngrok issues a new hostname on each start,
  so the frontend would need rebuilding and redeploying before every demo.
- **Twelve-hour hard session cap**, and 30 GPU-hours a week. The session ends
  mid-demo and the link dies with it.
- **Unclear terms.** Serving traffic from a notebook is widely practised and
  not clearly sanctioned. A session can be killed without warning.

Bandwidth, for the record, is *not* the problem: a 960×540 JPEG at q80 is about
24 KB, so 25 fps is roughly 4.7 Mbit/s each way — fine on ordinary wifi.

Kaggle was the right tool for **training** — a one-shot batch job with no
latency budget. Serving a live camera is the opposite kind of problem, and the
camera is wherever you are. Real installations put a mini-PC or a Jetson beside
the belt; your laptop already is that box.

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
anything uploaded is lost on the next deploy or spin-down. Re-upload the clip
after a redeploy, or attach a persistent disk (a paid feature).

The incident history is *not* ephemeral any more — that is exactly why it moved
to Supabase (see [ADR 0006](adr/0006-supabase-holds-the-history.md)). Incidents
and their snapshots survive redeploys, spin-downs, and moving the API to another
host entirely.

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
