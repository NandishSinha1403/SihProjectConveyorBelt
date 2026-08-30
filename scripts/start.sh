#!/usr/bin/env bash
#
# Start the Belt Sentinel stack.
#
#   ./scripts/start.sh                    backend + frontend
#   ./scripts/start.sh --backend          backend only
#   ./scripts/start.sh --source device://0   start and immediately watch a camera
#
# Idempotent: if something is already listening on a port it is reported and
# left alone rather than being silently replaced.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/_ui.sh"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
RUN_DIR="$ROOT/.run"
BACKEND_ONLY=0
SOURCE_URI=""

while [ $# -gt 0 ]; do
  case "$1" in
    --backend) BACKEND_ONLY=1; shift ;;
    --source)  SOURCE_URI="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$RUN_DIR"
banner "Belt Sentinel" "starting services"

# ---- preflight --------------------------------------------------------------
section "Preflight"

PY=$(command -v python3 || true)
if [ -z "$PY" ]; then fail "python3 not found"; exit 1; fi
ok "python3  $("$PY" -c 'import sys;print(".".join(map(str,sys.version_info[:3])))')"

if ! "$PY" -c "import fastapi, cv2, uvicorn" 2>/dev/null; then
  fail "Backend dependencies missing"
  note "Install them with:  pip install -r backend/requirements.txt"
  exit 1
fi
ok "backend dependencies"

if [ ! -f "$ROOT/backend/.env" ]; then
  cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
  warn "created backend/.env from the example"
fi

DETECTOR=$(env_get DETECTOR "$ROOT/backend/.env")
if [ "$DETECTOR" = "yolo" ]; then
  MODEL=$(env_get MODEL_PATH "$ROOT/backend/.env")
  if [ -f "$ROOT/backend/${MODEL:-models/belt_v1.pt}" ]; then
    ok "detector: trained YOLO model"
  else
    warn "DETECTOR=yolo but no weights at backend/${MODEL:-models/belt_v1.pt}"
    note "The backend will fall back to the synthetic mock detector."
  fi
else
  warn "detector: mock (synthetic defects — not a trained model)"
  note "Train one with ./scripts/train.sh, then set DETECTOR=yolo in backend/.env"
fi

# ---- backend ----------------------------------------------------------------
section "Backend"

if port_busy "$BACKEND_PORT"; then
  warn "port $BACKEND_PORT already in use by pid $(port_pid "$BACKEND_PORT") — leaving it alone"
else
  # Detach fully: redirect all three descriptors and disown. Without </dev/null
  # the child keeps the parent's stdin open, and this script never returns when
  # its own output is piped.
  ( cd "$ROOT/backend" && exec nohup "$PY" -m uvicorn app.main:app \
      --host 0.0.0.0 --port "$BACKEND_PORT" \
      >"$RUN_DIR/backend.log" 2>&1 </dev/null ) &
  BACKEND_PID=$!
  disown "$BACKEND_PID" 2>/dev/null || true
  echo "$BACKEND_PID" > "$RUN_DIR/backend.pid"
  info "starting uvicorn on :$BACKEND_PORT"

  for i in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null 2>&1; then break; fi
    sleep 0.5
  done

  if curl -sf "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
    ok "backend healthy  (pid $(port_pid "$BACKEND_PORT"))"
  else
    fail "backend did not become healthy within 20s"
    note "Log: .run/backend.log"
    tail -5 "$RUN_DIR/backend.log" | sed 's/^/      /'
    exit 1
  fi
fi

# ---- frontend ---------------------------------------------------------------
if [ "$BACKEND_ONLY" = "0" ]; then
  section "Frontend"

  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    warn "node_modules missing — installing (first run only)"
    ( cd "$ROOT/frontend" && npm install >"$RUN_DIR/npm-install.log" 2>&1 ) \
      && ok "dependencies installed" \
      || { fail "npm install failed — see .run/npm-install.log"; exit 1; }
  fi

  if port_busy "$FRONTEND_PORT"; then
    warn "port $FRONTEND_PORT already in use by pid $(port_pid "$FRONTEND_PORT") — leaving it alone"
  else
    ( cd "$ROOT/frontend" && exec nohup npm run dev \
        >"$RUN_DIR/frontend.log" 2>&1 </dev/null ) &
    FRONTEND_PID=$!
    disown "$FRONTEND_PID" 2>/dev/null || true
    echo "$FRONTEND_PID" > "$RUN_DIR/frontend.pid"
    info "starting vite on :$FRONTEND_PORT"

    for i in $(seq 1 60); do
      if curl -sf "http://localhost:$FRONTEND_PORT/" >/dev/null 2>&1; then break; fi
      sleep 0.5
    done

    if curl -sf "http://localhost:$FRONTEND_PORT/" >/dev/null 2>&1; then
      ok "frontend ready  (pid $(port_pid "$FRONTEND_PORT"))"
    else
      fail "frontend did not respond within 30s"
      note "Log: .run/frontend.log"
    fi
  fi
fi

# ---- optional source --------------------------------------------------------
if [ -n "$SOURCE_URI" ]; then
  section "Source"
  RESP=$(curl -sf -X POST "http://127.0.0.1:$BACKEND_PORT/api/stream/start" \
    -H 'Content-Type: application/json' -d "{\"uri\":\"$SOURCE_URI\"}" 2>/dev/null)
  if [ -n "$RESP" ]; then
    ok "streaming $SOURCE_URI"
  else
    fail "could not start $SOURCE_URI"
    note "Pick a source from the dashboard instead."
  fi
fi

# ---- summary ----------------------------------------------------------------
hr
printf "  %s%sDashboard%s   %shttp://localhost:%s%s\n" \
  "$BOLD" "$GREEN" "$RESET" "$CYAN" "$FRONTEND_PORT" "$RESET"
printf "  %sAPI docs%s    %shttp://localhost:%s/docs%s\n" \
  "$GREY" "$RESET" "$CYAN" "$BACKEND_PORT" "$RESET"
printf "  %sLogs%s        %s.run/backend.log  ·  .run/frontend.log%s\n" \
  "$GREY" "$RESET" "$DIM" "$RESET"
printf "\n  %sStop with%s   ./scripts/stop.sh     %sStatus%s  ./scripts/status.sh\n\n" \
  "$GREY" "$RESET" "$GREY" "$RESET"
