#!/usr/bin/env bash
#
# Stop the Belt Sentinel stack.
#
#   ./scripts/stop.sh            stop backend + frontend
#   ./scripts/stop.sh --all      also stop any running training run
#
# Terminates gracefully (SIGTERM), then escalates only if a process ignores it.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/_ui.sh"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
RUN_DIR="$ROOT/.run"
STOP_TRAINING=0

[ "${1:-}" = "--all" ] && STOP_TRAINING=1

banner "Belt Sentinel" "stopping services"

# stop_pid <pid> <label>
stop_pid() {
  local pid="$1" label="$2"
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  kill -TERM "$pid" 2>/dev/null
  local i=0
  while [ $i -lt 20 ]; do
    kill -0 "$pid" 2>/dev/null || { ok "$label stopped  (pid $pid)"; return 0; }
    sleep 0.25; i=$((i + 1))
  done
  # Only escalate after giving the process a fair chance to close cleanly --
  # the backend releases the camera and flushes the database on SIGTERM.
  kill -KILL "$pid" 2>/dev/null
  warn "$label force-killed  (pid $pid, ignored SIGTERM)"
  return 0
}

section "Services"
STOPPED=0

for svc in backend frontend; do
  PIDFILE="$RUN_DIR/$svc.pid"
  if [ -f "$PIDFILE" ]; then
    stop_pid "$(cat "$PIDFILE")" "$svc" && STOPPED=1
    rm -f "$PIDFILE"
  fi
done

# Catch processes started by hand, outside these scripts.
for entry in "backend:$BACKEND_PORT" "frontend:$FRONTEND_PORT"; do
  label="${entry%%:*}"; port="${entry##*:}"
  pid=$(port_pid "$port")
  if [ -n "$pid" ]; then
    stop_pid "$pid" "$label on :$port" && STOPPED=1
  fi
done

# Vite spawns an esbuild child that can outlive the parent and hold the port.
pkill -f "vite.*$FRONTEND_PORT" 2>/dev/null && info "cleaned up stray vite workers"

[ "$STOPPED" = "0" ] && note "nothing was running"

# ---- training ---------------------------------------------------------------
TRAIN_PID=$(pgrep -f "training/train.py" | head -1)
if [ -n "$TRAIN_PID" ]; then
  section "Training"
  if [ "$STOP_TRAINING" = "1" ]; then
    stop_pid "$TRAIN_PID" "training"
    note "Ultralytics checkpoints each epoch — resume from training/runs/*/weights/last.pt"
  else
    warn "training still running (pid $TRAIN_PID) — left alone"
    note "Stop it too with:  ./scripts/stop.sh --all"
  fi
fi

hr
printf "\n"
