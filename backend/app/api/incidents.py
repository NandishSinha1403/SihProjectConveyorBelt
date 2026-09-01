"""Incident history, snapshots and CSV export."""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse, StreamingResponse

from ..pipeline.session import manager
from ..pipeline.types import CLASS_LABELS
from ..store import storage
from ..store.db import get_db

router = APIRouter(prefix="/api/incidents", tags=["incidents"])

EXPORT_COLUMNS = ["id", "opened_at", "closed_at", "duration", "cls", "label",
                  "severity", "confidence", "first_frame", "last_frame", "snapshot"]


@router.get("")
async def list_incidents(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    severity: str | None = None,
    cls: str | None = None,
) -> dict:
    db = get_db()
    items = await run_in_threadpool(db.list_incidents, limit, offset, severity, cls)
    total = await run_in_threadpool(db.count_incidents, severity, cls)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/summary")
async def summary(
    hours: float | None = Query(
        8.0, ge=0.25, le=8760,
        description="Look-back window in hours; omit for all time.",
    ),
) -> dict:
    """Aggregate counts plus the live session's open incidents.

    Defaults to an eight-hour window -- one shift -- because the belt health
    gauge is a statement about current condition, not lifetime history.
    """
    data = await run_in_threadpool(get_db().summary, hours)
    session = manager.session
    data["open"] = ([i.to_dict() for i in session.incidents.open_incidents]
                    if session is not None and session.running else [])
    data["classes"] = CLASS_LABELS
    return data


@router.get("/export.csv")
async def export_csv(severity: str | None = None, cls: str | None = None):
    rows = await run_in_threadpool(get_db().list_incidents, 5000, 0, severity, cls)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=EXPORT_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="belt_incidents.csv"'},
    )


@router.delete("/session/current")
async def clear_current_session() -> dict:
    """Delete every incident opened by the run in progress.

    Deliberately scoped to the *live* session rather than "the most recent
    one in the database": a session that has already ended has no ongoing
    UI state to reconcile, so clearing it belongs under clear-all, not here.
    """
    session = manager.session
    if session is None or session.session_id is None:
        raise HTTPException(status_code=409, detail="No session is running")
    session_id = session.session_id
    deleted, keys = await run_in_threadpool(get_db().clear_incidents, session_id)
    await run_in_threadpool(storage.delete, keys)
    return {"session_id": session_id, "deleted": deleted, "snapshots_removed": len(keys)}


@router.delete("")
async def clear_all_incidents() -> dict:
    """Delete the entire incident history, live session included."""
    deleted, keys = await run_in_threadpool(get_db().clear_incidents, None)
    await run_in_threadpool(storage.delete, keys)
    return {"deleted": deleted, "snapshots_removed": len(keys)}


@router.get("/{incident_id}")
async def get_incident(incident_id: int) -> dict:
    row = await run_in_threadpool(get_db().get_incident, incident_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return row


@router.get("/{incident_id}/snapshot")
async def incident_snapshot(incident_id: int):
    row = await run_in_threadpool(get_db().get_incident, incident_id)
    if row is None or not row.get("snapshot"):
        raise HTTPException(status_code=404, detail="Snapshot not found")

    # Redirect rather than proxy: the bytes then travel from Supabase straight
    # to the browser, off the API box and out of its egress budget.
    try:
        url = await run_in_threadpool(storage.signed_url, row["snapshot"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=404, detail="Snapshot unavailable") from exc
    return RedirectResponse(url, status_code=302)
