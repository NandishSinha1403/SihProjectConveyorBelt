"""Analytics over the incident history: sessions, scoring, geometry, trend.

Every route here is a GET that only reads. The window is either a look-back in
hours or a single ``session_id``; when both are given the session wins, because
"this run" is a more specific question than "the last eight hours".
"""
from __future__ import annotations

import math
import time

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from ..analytics import reliability
from ..pipeline.session import manager
from ..pipeline.types import CLASS_LABELS
from ..store.db import get_db

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

# Buckets for the lateral-position histogram: the belt's width, in twentieths.
# Twenty is enough to see a defect population sitting off to one side without
# being so fine that a handful of incidents looks like structure.
LATERAL_BINS = 20
# Log-spaced area bins: defect sizes span orders of magnitude, so linear bins
# would put almost everything in the first one.
AREA_BINS = (0.0, 0.0005, 0.002, 0.008, 0.02, 0.04, 0.1, 1.0)


def _live_frames(hours: float | None, session_id: int | None) -> dict[str, int]:
    """In-flight frame counts for the session currently running, if it is in view.

    A session's frame accounting is written to its row only when it *ends*
    (``end_session`` in pipeline/session.py), so the run in progress contributes
    zeroes to any SQL total. Without this the analytics page reports no
    inspection coverage at all for the very run someone is watching, which is
    the run they are most likely to be asking about.

    Adding is safe rather than double-counting: the live session's row still
    holds the column defaults until it closes.
    """
    live = manager.session
    if live is None or not live.running or live.session_id is None:
        return {}
    if session_id is not None and live.session_id != session_id:
        return {}
    status = live.status()
    if session_id is None and hours is not None:
        started = float(status.get("started_at") or 0.0)
        if started < time.time() - hours * 3600:
            return {}

    return {
        "frames_read": int(status.get("frames_read") or 0),
        "frames_processed": int(status.get("frames_processed") or 0),
        "frames_skipped": int(status.get("frames_skipped") or 0),
    }


def _window_bounds(hours: float | None, session: dict | None) -> tuple[float, float]:
    """Start and end of the window, in epoch seconds."""
    now = time.time()
    if session is not None:
        return (float(session["started_at"]),
                float(session.get("ended_at") or now))
    if hours is None:
        return (0.0, now)
    return (now - hours * 3600, now)


@router.get("/sessions")
async def list_sessions(limit: int = Query(50, ge=1, le=500),
                        offset: int = Query(0, ge=0)) -> dict:
    """The run ledger, newest first, with each run's incident tally."""
    db = get_db()
    rows = await run_in_threadpool(db.list_sessions, limit, offset)
    live = manager.session
    live_id = live.session_id if live is not None and live.running else None
    for r in rows:
        # A run with no ended_at is either in progress or was cut off by a
        # crash; the two look identical in the table and mean different things.
        r["is_live"] = (live_id is not None and r["id"] == live_id)
    return {"items": rows, "limit": limit, "offset": offset, "live_id": live_id}


@router.get("/reliability")
async def reliability_index(
    hours: float | None = Query(8.0, ge=0.25, le=8760),
    session_id: int | None = None,
) -> dict:
    """Reliability Yield for one window: condition, coverage, trend.

    The corroboration term is deliberately absent from this payload -- the
    ESP32 node writes to a Supabase project this process holds no credentials
    for, so the two channels are joined in the browser. See
    ``frontend/src/lib/analytics.ts``.
    """
    db = get_db()
    session = None
    if session_id is not None:
        session = await run_in_threadpool(db.get_session, session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")

    rows = await run_in_threadpool(db.analytics_rows, hours, session_id)
    frames = await run_in_threadpool(db.frame_totals, hours, session_id)
    for key, value in _live_frames(hours, session_id).items():
        frames[key] = int(frames.get(key) or 0) + value
    start, end = _window_bounds(hours, session)

    # Wall-clock hours are the honest denominator this side of the fusion: the
    # backend cannot see the vibration trace, so it cannot know how much of the
    # window the belt actually spent moving. The browser re-normalises against
    # running time once it has the sensor history.
    observed_hours = max(0.0, end - start) / 3600.0

    payload = reliability.assess(
        rows,
        observed_hours=observed_hours,
        window_start=start,
        window_end=end,
        frames_read=int(frames.get("frames_read") or 0),
        frames_processed=int(frames.get("frames_processed") or 0),
    )
    payload["window"] = {
        "start": start, "end": end, "hours": hours, "session_id": session_id,
    }
    payload["frames"] = {k: int(frames.get(k) or 0) for k in
                         ("frames_read", "frames_processed", "frames_skipped")}
    payload["sessions"] = int(frames.get("sessions") or 0)
    return payload


@router.get("/timeseries")
async def timeseries(
    hours: float | None = Query(8.0, ge=0.25, le=8760),
    session_id: int | None = None,
    buckets: int = Query(48, ge=6, le=240),
) -> dict:
    """Incident counts over time, bucketed by severity and class.

    ``buckets`` is a target resolution rather than a row count: the window is
    divided into that many equal slices, and only non-empty slices come back.
    The client fills the gaps, which keeps an idle night from costing hundreds
    of zero rows on the wire.
    """
    db = get_db()
    session = None
    if session_id is not None:
        session = await run_in_threadpool(db.get_session, session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")

    start, end = _window_bounds(hours, session)
    span = max(1.0, end - start)
    bucket_seconds = max(1, int(span / buckets))

    rows = await run_in_threadpool(
        db.incident_buckets, bucket_seconds, hours, session_id)
    return {
        "start": start,
        "end": end,
        "bucket_seconds": bucket_seconds,
        "items": rows,
        "classes": CLASS_LABELS,
    }


@router.get("/geometry")
async def geometry(
    hours: float | None = Query(8.0, ge=0.25, le=8760),
    session_id: int | None = None,
) -> dict:
    """Where across the belt defects appear, and how big they are.

    Lateral position is the reason this endpoint exists. Defects clustering at
    one side of the belt is a *mechanical* finding -- tracking drift, or a
    misaligned roller -- that no amount of looking at severity counts will
    reveal, and every incident row has carried the geometry to show it since
    the first version of the schema.
    """
    db = get_db()
    if session_id is not None:
        if await run_in_threadpool(db.get_session, session_id) is None:
            raise HTTPException(status_code=404, detail="Session not found")

    rows = await run_in_threadpool(db.analytics_rows, hours, session_id)

    lateral = [0] * LATERAL_BINS
    area_hist = [0] * (len(AREA_BINS) - 1)
    scatter: list[dict] = []
    longitudinal = 0
    measured = 0

    for r in rows:
        box = r.get("box")
        if not isinstance(box, (list, tuple)) or len(box) != 4:
            continue
        try:
            x1, y1, x2, y2 = (float(v) for v in box)
        except (TypeError, ValueError):
            continue
        w, h = abs(x2 - x1), abs(y2 - y1)
        if w <= 0 or h <= 0:
            continue
        measured += 1

        centre = min(0.999999, max(0.0, (x1 + x2) / 2.0))
        lateral[int(centre * LATERAL_BINS)] += 1

        area = w * h
        for i in range(len(AREA_BINS) - 1):
            if AREA_BINS[i] <= area < AREA_BINS[i + 1]:
                area_hist[i] += 1
                break

        # Matches LONGITUDINAL_ASPECT in pipeline/events.py -- tall and narrow
        # is the rip-through population, and its share is the risk profile.
        if h / w >= 3.0:
            longitudinal += 1

        scatter.append({
            "id": r.get("id"),
            "cls": r.get("cls"),
            "severity": r.get("severity"),
            "confidence": round(float(r.get("confidence") or 0.0), 4),
            "lateral": round(centre, 4),
            "area": round(area, 6),
            "aspect": round(h / w, 3),
            "opened_at": r.get("opened_at"),
        })

    # Mean and spread of lateral position, so the summary can say "clustered"
    # or "spread evenly" from a number rather than from the shape of a bar.
    centres = [s["lateral"] for s in scatter]
    mean = sum(centres) / len(centres) if centres else None
    if centres and len(centres) > 1:
        var = sum((c - mean) ** 2 for c in centres) / len(centres)
        stdev = math.sqrt(var)
    else:
        stdev = None

    return {
        "measured": measured,
        "total_rows": len(rows),
        "lateral_bins": LATERAL_BINS,
        "lateral": lateral,
        "area_edges": list(AREA_BINS),
        "area": area_hist,
        "longitudinal": longitudinal,
        "lateral_mean": None if mean is None else round(mean, 4),
        "lateral_stdev": None if stdev is None else round(stdev, 4),
        "scatter": scatter,
    }
