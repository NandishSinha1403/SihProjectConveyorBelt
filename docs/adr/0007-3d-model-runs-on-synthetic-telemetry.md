# The 3D Model tab ran on synthetic telemetry, not the live pipeline (superseded)

> **Superseded 2026-09-01.** The 3D Model tab was rebuilt on top of a live
> Supabase feed from a physical ESP32 belt-monitor node (ported from the
> `belt-llive-code` repo, Team Unplayed's follow-up build). Everything below
> describes the *original* synthetic version and is kept for history — see
> "What changed" at the bottom for the current behavior.

The original 3D Model tab (ported from Team Unplayed's standalone Claude
Design prototype) drove its readouts from a self-contained simulation loop
inside `lib/rig/conveyor-model.ts` — belt speed, load, LDR/vision state, and
the interlock were all invented by that loop, not read from the real
detector, the event bus, or any incident. It shared nothing with the live
pipeline the rest of the dashboard runs.

This was a deliberate boundary, not an oversight, and it cut against this
project's usual rule that nothing shown to judges runs on fabricated data. The
distinction at the time: the 3D Model was a sensor-placement reference — it
existed to show *where* the lasers, LDR array, and camera sit and *how* rip
detection works mechanically, not to report on the belt's actual condition.

## What changed

The tab now runs on a **second, separate Supabase project** dedicated to rig
telemetry (distinct from the main app's Supabase project used for snapshots
and incidents). A physical ESP32 node (`belt-llive-code/firmware/belt-monitor/`)
posts `vibration`/`ldr`/`status` readings to a `readings` table; the browser
subscribes over Supabase Realtime via
`frontend/src/lib/rig/useLiveBeltFeed.ts`, and
`frontend/src/lib/rig/conveyor-model.ts`'s `createConveyorRig(...).setLive()`
drives the belt's motion, jitter, and rupture visuals directly off those
readings — the belt only animates while the live `vibration` reading says the
rig is actually moving, and a rupture visual is edge-triggered on a live
`NORMAL → WARNING` transition. There is no simulated physics left in this
file; commands like start/stop/speed/load/fault-injection (and the
`ControlPanel` UI that sent them) were removed along with them, since the live
firmware exposes no command channel — the page is read-only, matching
`belt-llive-code`'s README.

The vision camera and CNN-detection visuals remain decorative: the physical
rig has no camera, only an accelerometer and an LDR array, so those elements
still just sit at their idle look.

## Consequences (current)

The 3D Model tab is now a **live view of real sensor data**, not a synthetic
demo — the "no fabricated data shown to judges" rule now applies to it too. It
is still not the same pipeline as the camera-based `Live monitor` tab: the 3D
Model reads vibration/light from the ESP32 rig, while `Live monitor` runs
frame-by-frame defect detection on camera footage. Don't conflate the two as
the same "live" — an operator should not read a 3D Model rupture visual as a
confirmed camera-detected incident, since it reflects the ESP32's own
status/LDR logic, not the belt-pipeline's confirmation and severity model
described in CONTEXT.md.
