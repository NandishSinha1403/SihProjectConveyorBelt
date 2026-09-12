# Reliability Yield counts distinct defects, not incident rows

The belt health index is computed from *distinct physical defects*, obtained by
merging incident rows that describe the same defect seen on different belt
revolutions. It also weighs each defect by detector confidence, box geometry
and how many revolutions it survived, and it publishes inspection coverage
beside itself rather than folding it in.

It replaces `beltHealth()` in `frontend/src/lib/severity.ts`, which was

    100 · exp(−Σ weight[severity] × count / 120)

over raw rows from the `incidents` table.

## The bug

A belt is a loop. Every feature on it returns past the camera once per
revolution — that fact is the first line of `CONTEXT.md`, and it is why
`belt_joint` is excluded from incidents entirely (ADR 0002). A tear behaves the
same way: it leaves the frame, comes round again, gets a new track id, and is
confirmed into a **new incident row** every revolution.

The old score summed over those rows. One tear on a belt turning every 40
seconds therefore cost eight times what the same tear cost on a belt turning
every five minutes, and a stationary belt with a hole in it scored perfectly
because the hole never came back round. The score was reporting belt speed as
much as belt condition.

This is exactly the failure mode `events.py` already guards against for
`belt_joint`; the reasoning was simply never carried across from the alert feed
to the health gauge.

## What deduplication actually does

Two sightings merge when they share a class, sit within 8% of belt width of each
other, are within 2.5× each other's area, **and do not overlap in time**. The
last condition is the one that keeps it honest: a defect cannot be in two places
at once, so two sightings that coexist are necessarily two defects however alike
their geometry. Without it, two parallel tears at the same lateral position
would silently become one and halve the reported damage.

It remains a heuristic, so every response carries the raw row count next to the
deduplicated one. The gap between the two *is* the correction, and hiding it
would make the score unauditable.

## What else was being thrown away

`confidence`, `duration` and `box` are written on every incident row and were
read back by nothing. A 0.51-confidence sighting counted the same as a 0.97 one;
a defect spanning a third of the frame counted the same as a speck. All three
now scale the penalty, as multipliers centred on 1.0 rather than amplifiers — a
defect of ordinary size and confidence still scores close to its bare severity
weight, so the bands mean what they always meant.

`frames_skipped` was ignored completely, which was the worst of it. A run that
inspected 40% of the belt reported its verdict with exactly the same confidence
as one that inspected all of it, and a belt nobody looked at scored identically
to a clean one. Coverage is now published beside condition and never folded into
it: they answer different questions, and averaging them would destroy both.

## Why condition is not a rate

An earlier version of this divided the penalty by hours observed, to make runs
of different lengths comparable. That was wrong, and the tests pin against it: a
tear does not heal because the window got longer, so a rate-normalised condition
lets real damage fade out of the score by waiting. Discovery rate is a genuinely
useful figure — it is reported, separately, as `defects_per_hour`.

For the same reason the divisor stayed at its original 120. The only thing that
changed is *what* gets counted, so scores remain comparable across the rewrite.

## Corroboration lives in the browser

The ESP32 belt-monitor node writes to a **different Supabase project** from the
incident history, and only the frontend holds credentials for it. The backend
therefore cannot compute the agreement rate between the two channels, and
returns `corroboration: null`; `frontend/src/lib/analytics.ts` performs the join.

Two consequences follow from the two projects having two clocks. Matching is
accurate to roughly ±5 seconds, not to the second, and the UI says so. And
"the sensor agreed with nothing" has to render differently from "there was no
sensor" — reporting an unplugged node as 0% agreement would tell an engineer
the hardware disagrees when in fact it was absent.

## Consequences

`beltHealth()` still backs the Monitor tab's gauge until the new index has been
checked against real rig footage. That is a temporary state and should not last:
two health numbers that can disagree is worse than one that is wrong.

Deduplication assumes defects hold their position across the belt width between
revolutions. On a badly mistracking belt that assumption weakens — which is
itself detectable from the lateral position column in the defect register, where
a defect drifting across the belt between revolutions shows up as sightings that
refused to merge.
