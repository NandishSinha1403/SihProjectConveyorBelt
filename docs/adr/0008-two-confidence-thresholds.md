# Detection and incident promotion get separate confidence thresholds

The detector runs at `CONF_THRESHOLD` (0.35). Promoting a detection into an
incident requires `INCIDENT_CONFIDENCE_THRESHOLD` (0.50). Between the two sits
a band where a box is drawn on the live stream and sent to the client, but is
never advanced into a track — so it cannot open an incident, write a snapshot,
or reach the alert rail however long it persists.

A single threshold forces a choice between two things an operator wants at
once. Set it high and marginal wear vanishes from the feed entirely: the
operator watching the belt cannot see the thing that is not yet worth logging.
Set it low and the incident history — the artefact that becomes a maintenance
record — fills with detections nobody would act on, which is the same failure
that made a belt joint's presence unusable as an event (see ADR 0002).

Splitting them lets the feed stay permissive and the log stay strict. The
detector deliberately sits below the 0.50 that Guo et al. use, because early
wear is exactly what this system exists to surface early; the log keeps their
bar, because an incident asserts that someone should look.

The threshold is applied in `IncidentEngine.observe` beside the existing
untracked-detection guard, not in the detector. Filtering earlier would remove
the boxes from the stream too, which is the outcome being avoided.

## Consequences

The band is invisible unless you know it exists: a run of 0.4-confidence
detections produces boxes and no incidents, with nothing logged to explain the
silence. `docs/TROUBLESHOOTING.md` records this under "Detections appear but no
incidents are raised", which is where the symptom sends people.

Both values are tunable live from the Settings page and applied to a running
session without a restart, so the band can be narrowed or closed on footage
where it turns out to be wrong. Setting the incident threshold at or below
`CONF_THRESHOLD` closes it entirely and restores single-threshold behaviour.
