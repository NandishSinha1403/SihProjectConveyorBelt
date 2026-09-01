# The incident history lives in Supabase, not on the API box's disk

Sessions and incidents are rows in a Supabase Postgres database, and snapshot
JPEGs are objects in a private Supabase Storage bucket. Neither touches the
filesystem of the machine running the API.

They both used to. SQLite sat at `backend/data/conveyor.db` and snapshots in
`backend/media/snapshots/`, which is correct on a laptop and worthless in the
cloud: the free hosting tier has no persistent disk, so every redeploy and every
spin-down after fifteen idle minutes erased the history and every image the rows
pointed at. The hosted instance is the link that goes in a submission form, and
what it showed was an empty Incidents page and broken thumbnails.

A persistent disk on the API host would have fixed it for money and only there.
Supabase fixes it for free, and detaches the evidence from whichever box happens
to be running inference — which matters because the real deployment topology is
a laptop or a mini-PC beside the belt, not a server. A conveyor's history should
outlive the machine that watched it.

## Why direct Postgres, and not the Supabase SDK

`app/store/db.py` was already hand-written SQL behind a small class with a fixed
set of methods. Against psycopg that file changed placeholders and got a
connection pool; against the SDK's query builder every query would have been
rewritten, and a second Postgres client would have shipped alongside the first.
Storage needs four HTTP calls, which `httpx` makes directly.

The pool replaced a `threading.Lock`. The lock existed only because one SQLite
connection was shared between the inference thread and the request handlers;
with a connection per caller there is nothing left to serialise.

## What deliberately did not change

Timestamps stayed epoch floats rather than becoming `timestamptz`, and the
bounding box stayed a JSON array in a `TEXT` column rather than becoming
`jsonb`. Both are less idiomatic Postgres. Both keep every API response
byte-identical to what it was, so the dashboard needed no change at all — and a
persistence swap that also reshapes the API is two migrations wearing one coat.

`/api/incidents/{id}/snapshot` kept its URL. It now answers with a 302 to a
short-lived signed URL instead of the file itself, so the image bytes travel
from Supabase straight to the browser rather than through a 0.1-vCPU box.

## Consequences

The backend no longer starts without `DATABASE_URL`, `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY`. There is no SQLite fallback: two persistence backends
means two code paths, and the one exercised locally would not be the one that
runs in front of judges.

Snapshot uploads are asynchronous, on a single background worker. The object key
is derived locally and written into the incident row immediately, so the row is
never provisionally wrong; the image simply appears a moment after it. A failed
upload is logged and dropped, because losing evidence is better than stalling
the stream.

Free Supabase projects pause after seven days of inactivity and need a manual
unpause. Combined with the API host's own spin-down, that is two things to wake
before a demo.
