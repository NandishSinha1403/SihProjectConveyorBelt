#!/usr/bin/env bash
#
# One-screen status of everything: services, stream, model, training.
#
#   ./scripts/status.sh

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/_ui.sh"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
API="http://127.0.0.1:$BACKEND_PORT"

banner "Belt Sentinel" "status"

# jq is not assumed -- python3 is already a hard dependency of this project.
jget() { "$1" 2>/dev/null | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
for k in '''$2'''.split('.'):
    if isinstance(d,dict): d=d.get(k)
print('' if d is None else d)
" 2>/dev/null; }

section "Services"
if curl -sf "$API/api/health" >/dev/null 2>&1; then
  ok "backend    :$BACKEND_PORT  (pid $(port_pid "$BACKEND_PORT"))"
else
  fail "backend    :$BACKEND_PORT  not responding"
fi
if curl -sf "http://localhost:$FRONTEND_PORT/" >/dev/null 2>&1; then
  ok "frontend   :$FRONTEND_PORT  (pid $(port_pid "$FRONTEND_PORT"))"
else
  fail "frontend   :$FRONTEND_PORT  not responding"
fi

# ---- stream -----------------------------------------------------------------
STATUS_JSON=$(curl -sf "$API/api/stream/status" 2>/dev/null)
if [ -n "$STATUS_JSON" ]; then
  section "Stream"
  printf '%s' "$STATUS_JSON" | NO_COLOR="${NO_COLOR:-}" COLOR_OK="$([ -n "$RESET" ] && echo 1)" python3 -c "
import json,os,sys
d = json.load(sys.stdin)
_c = bool(os.environ.get('COLOR_OK'))
def C(s): return s if _c else ''
G=C('\033[38;5;114m'); Y=C('\033[38;5;221m'); N=C('\033[0m'); D=C('\033[2m')
g=C('\033[38;5;244m')
def kv(k,v,c=N): print('  %s%-22s%s %s%s%s' % (g,k,N,c,v,N))
if d.get('running'):
    kv('State','STREAMING',G)
    kv('Source', d.get('label') or d.get('uri'))
    kv('Detector', d.get('detector'))
    kv('Capture', '%.1f fps' % (d.get('capture_fps') or 0))
    kv('Inference', '%.1f fps  (%.0f ms)' % (d.get('inference_fps') or 0, d.get('inference_ms') or 0))
    read = d.get('frames_read') or 0; skip = d.get('frames_skipped') or 0
    ratio = (skip/read*100) if read else 0
    kv('Frames', '%d read  ·  %d processed  ·  %d skipped (%.0f%%)'
       % (read, d.get('frames_processed') or 0, skip, ratio), Y if ratio>50 else N)
    counts = d.get('counts') or {}
    if counts:
        kv('Detected', '  '.join('%s×%d' % (k,v) for k,v in counts.items()))
else:
    kv('State','IDLE',D)
    if d.get('uri'): kv('Last source', d.get('label') or d.get('uri'))
"
fi

# ---- incidents --------------------------------------------------------------
SUMMARY=$(curl -sf "$API/api/incidents/summary" 2>/dev/null)
if [ -n "$SUMMARY" ]; then
  section "Incidents (last 8h)"
  printf '%s' "$SUMMARY" | COLOR_OK="$([ -n "$RESET" ] && echo 1)" python3 -c "
import json,os,sys
d=json.load(sys.stdin)
_c = bool(os.environ.get('COLOR_OK'))
def C(s): return s if _c else ''
g=C('\033[38;5;244m'); N=C('\033[0m')
cols={'critical':C('\033[38;5;203m'),'high':C('\033[38;5;214m'),
      'medium':C('\033[38;5;221m'),'low':C('\033[38;5;80m'),'info':C('\033[38;5;244m')}
sev=d.get('by_severity') or {}
print('  %s%-22s%s %s' % (g,'Total',N,d.get('total',0)))
for k in ('critical','high','medium','low','info'):
    if sev.get(k):
        print('  %s%-22s%s %s%s%s' % (g,k.capitalize(),N,cols[k],sev[k],N))
"
fi

# ---- model ------------------------------------------------------------------
section "Model"
DETECTOR=$(env_get DETECTOR "$ROOT/backend/.env")
if [ -f "$ROOT/backend/models/belt_v1.pt" ]; then
  SIZE=$(du -h "$ROOT/backend/models/belt_v1.pt" | cut -f1 | tr -d ' ')
  ok "weights present  (backend/models/belt_v1.pt, $SIZE)"
else
  warn "no trained weights installed"
fi
kv "DETECTOR setting" "${DETECTOR:-unset}" \
  "$([ "$DETECTOR" = "yolo" ] && printf '%s' "$GREEN" || printf '%s' "$YELLOW")"

# ---- training ---------------------------------------------------------------
TRAIN_PID=$(pgrep -f "training/train.py" | head -1)
section "Training"
if [ -n "$TRAIN_PID" ]; then
  EPOCH=$(awk -F',' 'END{print $1+0}' "$ROOT/training/runs/belt_v1/results.csv" 2>/dev/null)
  ok "running  (pid $TRAIN_PID${EPOCH:+, epoch $EPOCH})"
  note "Watch it:  ./scripts/train-watch.sh"
else
  note "not running"
fi

hr
printf "\n"
