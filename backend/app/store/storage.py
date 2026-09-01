"""Snapshot objects in Supabase Storage.

Talks to the Storage REST API directly rather than through supabase-py: the
four calls used here are one HTTP request each, and the SDK would pull in a
second Postgres client alongside the psycopg one in db.py.

The bucket is private. Nothing hands out an object path; readers always get a
short-lived signed URL from ``signed_url``.
"""
from __future__ import annotations

import logging

import httpx

from ..config import settings

log = logging.getLogger(__name__)

TIMEOUT = 15.0


def _base() -> str:
    if not (settings.supabase_url and settings.supabase_service_key):
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set to store snapshots"
        )
    return f"{settings.supabase_url.rstrip('/')}/storage/v1"


def _headers() -> dict[str, str]:
    key = settings.supabase_service_key
    return {"Authorization": f"Bearer {key}", "apikey": key}


def upload(key: str, jpeg: bytes) -> None:
    r = httpx.post(
        f"{_base()}/object/{settings.supabase_bucket}/{key}",
        headers={**_headers(), "Content-Type": "image/jpeg"},
        content=jpeg,
        timeout=TIMEOUT,
    )
    r.raise_for_status()


def signed_url(key: str, expires: int = 3600) -> str:
    r = httpx.post(
        f"{_base()}/object/sign/{settings.supabase_bucket}/{key}",
        headers=_headers(),
        json={"expiresIn": expires},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return f"{_base()}{r.json()['signedURL']}"


def list_objects() -> list[str]:
    """Every object name in the bucket, paged out in full."""
    names: list[str] = []
    offset, page = 0, 100
    while True:
        r = httpx.post(
            f"{_base()}/object/list/{settings.supabase_bucket}",
            headers=_headers(),
            json={"prefix": "", "limit": page, "offset": offset},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        batch = r.json()
        names.extend(item["name"] for item in batch)
        if len(batch) < page:
            return names
        offset += page


def delete(keys: list[str]) -> None:
    if not keys:
        return
    r = httpx.request(
        "DELETE",
        f"{_base()}/object/{settings.supabase_bucket}",
        headers=_headers(),
        json={"prefixes": keys},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
