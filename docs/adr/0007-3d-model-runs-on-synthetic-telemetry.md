# The 3D Model tab runs on synthetic telemetry, not the live pipeline

The 3D Model tab (ported from Team Unplayed's standalone Claude Design
prototype) drives its readouts from a self-contained simulation loop inside
`lib/rig/conveyor-model.ts` — belt speed, load, LDR/vision state, and the
interlock are all invented by that loop, not read from the real detector, the
event bus, or any incident. It shares nothing with the live pipeline the rest
of the dashboard runs.

This is a deliberate boundary, not an oversight, and it cuts against this
project's usual rule that nothing shown to judges runs on fabricated data. The
distinction: the 3D Model is a sensor-placement reference — it exists to show
*where* the lasers, LDR array, and camera sit and *how* rip detection works
mechanically, not to report on the belt's actual condition. Wiring it to real
telemetry was rejected for now: it would mean either replaying live pipeline
state through a scene built for a free-running demo loop, or duplicating
incident logic inside a three.js model, for a page whose job is explaining the
rig, not monitoring it. CONTEXT.md's "3D Model" entry records the same
boundary for anyone reading the glossary rather than this history.

## Consequences

The 3D Model must never be presented as showing the belt's live state — the
"Live monitor" tab is the only place that claim is true. If a future session
wants the 3D Model to reflect real telemetry (e.g. driving the laser mount
position or interlock state from actual incidents), that is a deliberate
follow-up, not a bug fix: this ADR is the record that the disconnect was
intentional.
