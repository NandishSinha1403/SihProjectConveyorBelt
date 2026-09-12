"""Reliability Yield -- the belt condition index, and the arithmetic behind it.

This replaces ``beltHealth()`` in the frontend, which scored the belt as

    100 * exp(-sum(weight[severity] * count) / 120)

over raw incident rows in a wall-clock window. That has one outright bug and
several silent omissions:

*The bug.* A belt is a loop, so a physical tear returns past the camera once
per revolution and opens a **fresh incident every time**. Ten passes of one
tear became ten rows and ten times the penalty, and a slow belt scored worse
than a fast one carrying identical damage. This is the same failure mode
``pipeline/events.py`` already guards against for ``belt_joint`` -- the
reasoning was simply never carried across to scoring. ``distinct_defects``
below is the fix.

*The omissions.* ``confidence``, ``duration`` and ``box`` are stored on every
incident row and were never read back; a 0.51-confidence sighting counted the
same as a 0.97 one, and a defect spanning a third of the belt the same as a
speck. ``frames_skipped`` was ignored entirely, so a run that inspected 40% of
the belt reported its verdict with exactly the same confidence as one that
inspected all of it.

*What is deliberately not here.* Corroboration against the ESP32 belt-monitor
node is computed in the browser, not here: the node writes to a separate
Supabase project that only the frontend holds credentials for, and this process
has no route to it. ``frontend/src/lib/analytics.ts`` joins the two channels.
The score below is therefore the *vision* verdict, and says so.

The output is four published figures rather than one number. An engineer asked
to act on a score will want to know which part of it moved, and a single
opaque index cannot answer that.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

from ..pipeline.types import CLASS_LABELS

# Penalty each severity contributes, before confidence, size and persistence.
# Carried over unchanged from the frontend's HEALTH_WEIGHT so scores before and
# after this rewrite remain on a comparable scale.
SEVERITY_WEIGHT: dict[str, float] = {
    "info": 0.0,
    "low": 1.0,
    "medium": 4.0,
    "high": 12.0,
    "critical": 30.0,
}

# Diminishing returns on accumulated penalty, unchanged from the frontend's
# original divisor.
#
# Condition is deliberately *not* normalised per hour. A tear does not heal
# because the window got longer, so dividing by observation time would let a
# real defect fade out of the score just by waiting -- exactly the wrong
# behaviour for a condition index. Rate is a genuinely useful figure, but it
# is a different question ("how fast are we finding damage?") and is reported
# separately as `defects_per_hour`. Keeping this divisor at its original value
# also means scores stay comparable across the rewrite: the only thing that
# changed is *what* gets counted.
PENALTY_SCALE = 120.0

# A window shorter than this is not enough belt to draw a rate from, and
# dividing by it would send that rate to infinity.
MIN_OBSERVED_HOURS = 1.0 / 60.0

# A window shorter than this cannot carry a trend.
#
# Splitting a forty-second clip in half and comparing the two produces large,
# confident-looking numbers -- "condition improved by 60 points" -- out of which
# defect happened to be confirmed first. Deterioration is a claim about a belt
# over time, and below roughly ten minutes there is no time for it to be about.
MIN_TREND_SPAN_SECONDS = 600.0

# Two sightings are candidates for the same physical defect when their centres
# sit within this fraction of the belt width of each other.
LATERAL_TOLERANCE = 0.08
# ...and when neither is more than this many times the area of the other.
AREA_RATIO_TOLERANCE = 2.5

# Area at which a defect is "large", matching LARGE_AREA_FRAC in
# pipeline/events.py so the score and the severity rules agree on the word.
LARGE_AREA_FRAC = 0.04

# The three multipliers below are adjustments around 1.0, not amplifiers. A
# defect of ordinary size, ordinary confidence and a single sighting should
# score close to its bare severity weight -- otherwise the rewrite silently
# recalibrates every band and "Degraded" stops meaning what it used to.
AREA_FACTOR_FLOOR = 0.6      # a speck, far below the "large" line
MAX_AREA_FACTOR = 2.0        # a defect several times over the line
PERSISTENCE_GAIN = 0.25      # per natural-log step in sightings
MAX_PERSISTENCE_FACTOR = 1.75


@dataclass
class DistinctDefect:
    """One physical defect, and every time the camera saw it come round."""

    cls: str
    label: str
    severity: str
    #: Highest confidence across the sightings.
    confidence: float
    #: Fraction of belt width, 0 (one edge) to 1 (the other).
    lateral: float
    #: Fraction of frame area.
    area: float
    #: How many separate incidents resolved to this one defect.
    sightings: int
    first_seen: float
    last_seen: float
    #: The incident row ids that were merged, so any figure here can be traced
    #: back to the records it came from.
    incident_ids: list[int] = field(default_factory=list)

    def penalty(self) -> float:
        """This defect's contribution to the condition penalty."""
        base = SEVERITY_WEIGHT.get(self.severity, 0.0)
        if base == 0.0:
            return 0.0
        # Confidence scales linearly: a detection the model is half sure of
        # counts half. The incident threshold already floors this at 0.5, so
        # in practice the multiplier ranges over 0.5-1.0.
        conf = max(0.0, min(1.0, self.confidence))
        # Size is measured against the "large defect" line rather than in the
        # abstract, so the factor means something physical: exactly 1.0 at the
        # escalation threshold, down to AREA_FACTOR_FLOOR for a speck, and
        # capped above so one enormous box cannot erase the rest of the score.
        area_factor = min(
            AREA_FACTOR_FLOOR
            + (1.0 - AREA_FACTOR_FLOOR) * (self.area / LARGE_AREA_FRAC),
            MAX_AREA_FACTOR,
        )
        # A defect confirmed on several revolutions is more certainly real than
        # one confirmed once. Logarithmic, so the second sighting is worth far
        # more than the twentieth, and bounded: persistence raises confidence
        # in the finding, it does not make the damage worse.
        persistence = min(
            1.0 + PERSISTENCE_GAIN * math.log1p(max(0, self.sightings - 1)),
            MAX_PERSISTENCE_FACTOR,
        )
        return base * conf * area_factor * persistence


def _box_of(row: dict[str, Any]) -> tuple[float, float] | None:
    """Lateral centre and area from a stored, normalised box.

    Returns ``None`` for rows whose box is missing or malformed rather than
    guessing at a position -- a defect with no known geometry still counts
    toward the score, it just cannot contribute to the geometry panels.
    """
    box = row.get("box")
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        return None
    try:
        x1, y1, x2, y2 = (float(v) for v in box)
    except (TypeError, ValueError):
        return None
    w, h = abs(x2 - x1), abs(y2 - y1)
    return (x1 + x2) / 2.0, w * h


def _overlaps_in_time(a: DistinctDefect, row_start: float,
                      row_end: float) -> bool:
    """True when a candidate sighting coexists with one already in the cluster.

    A single physical defect cannot be in two places at once, so two sightings
    whose open intervals overlap are necessarily different defects however
    alike their geometry. Without this guard, two parallel tears at the same
    lateral position would silently merge into one.
    """
    return row_start <= a.last_seen and row_end >= a.first_seen


def distinct_defects(rows: Sequence[dict[str, Any]]) -> list[DistinctDefect]:
    """Collapse repeat sightings of one physical defect into single entries.

    Sightings merge when they share a class, sit at the same place across the
    belt width, are of comparable size, and do not overlap in time. This is a
    heuristic and is reported as one: every response that carries a
    deduplicated figure also carries the raw incident count beside it, so the
    assumption stays visible instead of hiding inside a score.
    """
    clusters: list[DistinctDefect] = []

    # Oldest first, so `first_seen` is genuinely the first sighting.
    for row in sorted(rows, key=lambda r: r.get("opened_at") or 0.0):
        geom = _box_of(row)
        lateral, area = geom if geom else (float("nan"), 0.0)
        opened = float(row.get("opened_at") or 0.0)
        closed = float(row.get("closed_at") or opened)
        cls = str(row.get("cls") or "")
        severity = str(row.get("severity") or "info")
        confidence = float(row.get("confidence") or 0.0)

        match: DistinctDefect | None = None
        if geom is not None:
            for c in clusters:
                if c.cls != cls:
                    continue
                if abs(c.lateral - lateral) > LATERAL_TOLERANCE:
                    continue
                bigger = max(c.area, area)
                smaller = min(c.area, area)
                if smaller <= 0 or bigger / smaller > AREA_RATIO_TOLERANCE:
                    continue
                if _overlaps_in_time(c, opened, closed):
                    continue
                match = c
                break

        if match is None:
            clusters.append(DistinctDefect(
                cls=cls,
                label=str(row.get("label") or CLASS_LABELS.get(cls, cls)),
                severity=severity,
                confidence=confidence,
                lateral=lateral,
                area=area,
                sightings=1,
                first_seen=opened,
                last_seen=closed,
                incident_ids=[int(row["id"])] if row.get("id") is not None else [],
            ))
            continue

        # Merge: a defect is described by its worst sighting, not its average.
        match.sightings += 1
        match.last_seen = max(match.last_seen, closed)
        match.confidence = max(match.confidence, confidence)
        match.area = max(match.area, area)
        if _rank(severity) > _rank(match.severity):
            match.severity = severity
        # Running mean keeps the cluster centred as it accumulates sightings.
        match.lateral += (lateral - match.lateral) / match.sightings
        if row.get("id") is not None:
            match.incident_ids.append(int(row["id"]))

    return clusters


_RANKS = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}


def _rank(severity: str) -> int:
    return _RANKS.get(severity, 0)


def condition_score(defects: Iterable[DistinctDefect]) -> tuple[int, float]:
    """0-100 condition, and the accumulated penalty it came from.

    Reads over *distinct* defects, so a belt carrying one tear scores the same
    whether the camera caught it once or on twenty consecutive revolutions.
    That equivalence is the whole point of the rewrite.
    """
    penalty = sum(d.penalty() for d in defects)
    return round(100 * math.exp(-penalty / PENALTY_SCALE)), penalty


def coverage_score(frames_read: int, frames_processed: int) -> int | None:
    """Share of arriving frames the detector actually analysed, as 0-100.

    This is inspection integrity, and it is reported *beside* condition rather
    than folded into it. A clean belt and a belt nobody looked at both produce
    zero incidents; only this number tells them apart. ``None`` when no frames
    have been read, which is not the same as 0% and must not render as it.
    """
    if frames_read <= 0:
        return None
    return round(100 * min(1.0, frames_processed / frames_read))


def trend_delta(defects: Sequence[DistinctDefect], start: float,
                end: float) -> int | None:
    """Change in condition between the first and second half of the window.

    Positive means improving. ``None`` when there is not enough to compare on,
    which is reported as "no trend" rather than as "flat".

    Both halves must contain at least one defect. An empty second half looks
    like a perfect score, but a belt nobody was watching and a belt with
    nothing wrong produce exactly the same empty half -- and calling the first
    one "improving" would be the most dangerous thing this module could say.

    The window must also be at least MIN_TREND_SPAN_SECONDS long. Over a short
    clip the two halves differ by which defect came past the lens first, which
    is not a trend however large the number looks.
    """
    span = end - start
    if span < MIN_TREND_SPAN_SECONDS or len(defects) < 2:
        return None
    midpoint = start + span / 2.0

    early = [d for d in defects if d.first_seen < midpoint]
    late = [d for d in defects if d.first_seen >= midpoint]
    if not early or not late:
        return None

    early_score, _ = condition_score(early)
    late_score, _ = condition_score(late)
    return late_score - early_score


def band(score: int) -> str:
    """The label an operator reads instead of the number."""
    if score >= 85:
        return "Healthy"
    if score >= 65:
        return "Monitor"
    if score >= 40:
        return "Degraded"
    if score >= 20:
        return "At Risk"
    return "Critical"


def assess(rows: Sequence[dict[str, Any]], *, observed_hours: float,
           window_start: float, window_end: float,
           frames_read: int = 0, frames_processed: int = 0) -> dict[str, Any]:
    """The full Reliability Yield payload for one window.

    Every figure is accompanied by the input it came from, because a score an
    engineer cannot take apart is a score they will not act on.
    """
    defects = distinct_defects(rows)
    score, penalty = condition_score(defects)
    coverage = coverage_score(frames_read, frames_processed)

    by_severity: dict[str, int] = {}
    for d in defects:
        by_severity[d.severity] = by_severity.get(d.severity, 0) + 1

    # Discovery rate, kept apart from condition: "how damaged is the belt?" and
    # "how fast are we finding new damage?" are different questions, and a
    # single number that tries to answer both answers neither.
    hours = max(observed_hours, MIN_OBSERVED_HOURS)

    return {
        "condition": score,
        "band": band(score),
        "penalty": round(penalty, 3),
        "defects_per_hour": round(len(defects) / hours, 3),
        "coverage": coverage,
        "trend": trend_delta(defects, window_start, window_end),
        "observed_hours": round(observed_hours, 4),
        # Both counts, always. The gap between them *is* the loop-recurrence
        # correction, and hiding it would make the score unauditable.
        "incident_rows": len(rows),
        "distinct_defects": len(defects),
        "distinct_by_severity": by_severity,
        "defects": [
            {
                "cls": d.cls,
                "label": d.label,
                "severity": d.severity,
                "confidence": round(d.confidence, 4),
                "lateral": None if math.isnan(d.lateral) else round(d.lateral, 4),
                "area": round(d.area, 6),
                "sightings": d.sightings,
                "first_seen": d.first_seen,
                "last_seen": d.last_seen,
                "penalty": round(d.penalty(), 3),
                "incident_ids": d.incident_ids,
            }
            for d in sorted(defects, key=lambda x: x.penalty(), reverse=True)
        ],
        # Corroboration against the ESP32 node is a browser-side join; this
        # process holds no credentials for the rig's Supabase project.
        "corroboration": None,
    }
