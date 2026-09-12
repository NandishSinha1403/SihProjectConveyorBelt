"""Tests for the Reliability Yield index.

The property worth protecting here is the one the old score got wrong: a belt
is a loop, so one physical defect comes past the camera again every revolution
and opens a fresh incident row each time. Scoring must not punish the belt once
per revolution. These tests exist because that is easy to reintroduce with an
innocuous-looking change and impossible to notice by eye.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

# There is no pytest config putting backend/ on the path; test_realtime.py does
# the same thing for the same reason.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.analytics import reliability as R  # noqa: E402


def incident(row_id: int, opened: float, *, cls: str = "tear",
             severity: str = "high", confidence: float = 0.8,
             box: tuple[float, float, float, float] = (0.40, 0.10, 0.46, 0.50),
             duration: float = 5.0) -> dict:
    return {
        "id": row_id,
        "cls": cls,
        "label": cls.title(),
        "severity": severity,
        "confidence": confidence,
        "opened_at": opened,
        "closed_at": opened + duration,
        "box": list(box),
    }


# -- deduplication ---------------------------------------------------------

def test_one_defect_seen_each_revolution_is_one_defect():
    """The bug this module exists to fix."""
    rows = [incident(i, 100.0 + i * 60.0) for i in range(1, 6)]
    defects = R.distinct_defects(rows)

    assert len(defects) == 1
    assert defects[0].sightings == 5
    # Every merged row is still traceable back from the score.
    assert defects[0].incident_ids == [1, 2, 3, 4, 5]


def test_recurrence_does_not_compound_the_penalty():
    """Five sightings of one tear must not score five tears' worth of damage."""
    once = R.assess([incident(1, 100.0)], observed_hours=8.0,
                    window_start=0.0, window_end=28800.0)
    five = R.assess([incident(i, 100.0 + i * 60.0) for i in range(1, 6)],
                    observed_hours=8.0, window_start=0.0, window_end=28800.0)

    assert five["incident_rows"] == 5
    assert five["distinct_defects"] == 1
    # Persistence raises confidence in the finding a little, but nothing like
    # the five-fold penalty the old formula applied.
    assert five["condition"] < once["condition"]
    assert once["condition"] - five["condition"] < 10


def test_defects_at_different_positions_stay_separate():
    rows = [
        incident(1, 100.0, box=(0.10, 0.1, 0.16, 0.5)),
        incident(2, 200.0, box=(0.70, 0.1, 0.76, 0.5)),
    ]
    assert len(R.distinct_defects(rows)) == 2


def test_different_classes_never_merge():
    rows = [
        incident(1, 100.0, cls="tear"),
        incident(2, 200.0, cls="hole"),
    ]
    assert len(R.distinct_defects(rows)) == 2


def test_simultaneous_defects_never_merge():
    """A defect cannot be in two places at once.

    Two tears at the same lateral position, of the same size, seen at the same
    moment, are necessarily two defects however alike they look. Without the
    time-overlap guard the geometry alone would fold them into one and halve
    the reported damage.
    """
    rows = [
        incident(1, 100.0, duration=20.0),
        incident(2, 105.0, duration=20.0),
    ]
    assert len(R.distinct_defects(rows)) == 2


def test_row_with_no_usable_box_is_kept_not_dropped():
    """Missing geometry costs a defect its position, never its existence."""
    rows = [incident(1, 100.0), {**incident(2, 200.0), "box": []}]
    defects = R.distinct_defects(rows)

    assert len(defects) == 2
    assert any(math.isnan(d.lateral) for d in defects)
    # It still contributes to the score.
    assert R.assess(rows, observed_hours=1.0, window_start=0.0,
                    window_end=3600.0)["condition"] < 100


# -- scoring ---------------------------------------------------------------

def test_clean_belt_scores_full_marks():
    out = R.assess([], observed_hours=8.0, window_start=0.0, window_end=28800.0)
    assert out["condition"] == 100
    assert out["band"] == "Healthy"


def test_condition_does_not_decay_with_a_longer_window():
    """A tear does not heal because nobody moved the clock.

    Condition describes the belt, not a rate, so widening the window must not
    improve the score. Discovery rate is reported separately for that.
    """
    rows = [incident(1, 100.0)]
    short = R.assess(rows, observed_hours=1.0, window_start=0.0, window_end=3600.0)
    long = R.assess(rows, observed_hours=8.0, window_start=0.0, window_end=28800.0)

    assert short["condition"] == long["condition"]
    assert short["defects_per_hour"] > long["defects_per_hour"]


def test_confidence_scales_the_penalty():
    sure = R.assess([incident(1, 100.0, confidence=0.95)], observed_hours=1.0,
                    window_start=0.0, window_end=3600.0)
    unsure = R.assess([incident(1, 100.0, confidence=0.51)], observed_hours=1.0,
                      window_start=0.0, window_end=3600.0)
    assert unsure["condition"] > sure["condition"]


def test_severity_dominates_geometry():
    critical = R.assess([incident(1, 100.0, severity="critical")],
                        observed_hours=1.0, window_start=0.0, window_end=3600.0)
    low = R.assess([incident(1, 100.0, severity="low")], observed_hours=1.0,
                   window_start=0.0, window_end=3600.0)
    assert critical["condition"] < low["condition"]


def test_info_severity_costs_nothing():
    """INFO carries zero weight, exactly as it did before the rewrite."""
    out = R.assess([incident(1, 100.0, severity="info")], observed_hours=1.0,
                   window_start=0.0, window_end=3600.0)
    assert out["condition"] == 100


# -- coverage --------------------------------------------------------------

def test_coverage_is_none_when_nothing_was_read():
    """No frames read is not the same as 0% coverage, and must not render as it."""
    assert R.coverage_score(0, 0) is None
    assert R.coverage_score(100, 0) == 0


def test_coverage_is_reported_beside_condition_not_folded_into_it():
    rows = [incident(1, 100.0)]
    full = R.assess(rows, observed_hours=1.0, window_start=0.0, window_end=3600.0,
                    frames_read=1000, frames_processed=1000)
    thin = R.assess(rows, observed_hours=1.0, window_start=0.0, window_end=3600.0,
                    frames_read=1000, frames_processed=300)

    assert full["coverage"] == 100
    assert thin["coverage"] == 30
    # The belt is in the same condition either way; only our confidence differs.
    assert full["condition"] == thin["condition"]


# -- trend -----------------------------------------------------------------

def test_trend_is_none_when_a_half_has_no_defects():
    """An empty second half is ambiguous and must not read as improvement.

    A belt nobody watched and a belt with nothing wrong produce an identical
    empty half. Calling the first one "improving" would be the most dangerous
    thing this module could say.
    """
    rows = [incident(i, 100.0 + i * 600.0,
                     box=(0.1 * i, 0.1, 0.1 * i + 0.06, 0.5)) for i in range(1, 6)]
    out = R.assess(rows, observed_hours=8.0, window_start=0.0, window_end=28800.0)
    assert out["trend"] is None


def test_trend_reports_deterioration_as_negative():
    early = [incident(1, 100.0, severity="low", box=(0.1, 0.1, 0.16, 0.3))]
    late = [
        incident(i, 20000.0 + i * 100.0, severity="critical",
                 box=(0.1 * i, 0.1, 0.1 * i + 0.08, 0.7))
        for i in range(2, 6)
    ]
    out = R.assess(early + late, observed_hours=8.0, window_start=0.0,
                   window_end=28800.0)
    assert out["trend"] is not None
    assert out["trend"] < 0


# -- reporting -------------------------------------------------------------

def test_both_counts_are_always_published():
    """The gap between rows and distinct defects is the correction itself.

    Hiding it would make the score unauditable, so both numbers travel together
    in every payload.
    """
    rows = [incident(i, 100.0 + i * 60.0) for i in range(1, 4)]
    out = R.assess(rows, observed_hours=1.0, window_start=0.0, window_end=3600.0)
    assert out["incident_rows"] == 3
    assert out["distinct_defects"] == 1


def test_corroboration_is_left_to_the_browser():
    """The rig's Supabase project is not reachable from this process."""
    out = R.assess([], observed_hours=1.0, window_start=0.0, window_end=3600.0)
    assert out["corroboration"] is None


def test_defects_are_ordered_worst_first():
    rows = [
        incident(1, 100.0, severity="low", box=(0.1, 0.1, 0.14, 0.2)),
        incident(2, 200.0, severity="critical", box=(0.7, 0.1, 0.78, 0.8)),
    ]
    out = R.assess(rows, observed_hours=1.0, window_start=0.0, window_end=3600.0)
    assert out["defects"][0]["severity"] == "critical"


def test_trend_is_none_over_a_window_too_short_to_have_one():
    """A forty-second clip cannot deteriorate.

    Splitting a short run in half and comparing produces large, confident
    numbers out of which defect happened to be confirmed first. On real rig
    footage this reported "condition improved by 60 points" across 34 seconds.
    """
    rows = [incident(i, 100.0 + i * 4.0,
                     box=(0.1 * i, 0.1, 0.1 * i + 0.06, 0.5)) for i in range(1, 6)]
    short = R.assess(rows, observed_hours=0.01, window_start=100.0,
                     window_end=134.0)
    assert short["trend"] is None
