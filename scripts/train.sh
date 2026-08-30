#!/usr/bin/env bash
#
# Train the belt damage detector.
#
#   ./scripts/train.sh                  yolo11s, 120 epochs  (best quality)
#   ./scripts/train.sh --fast           yolo11n, 60 epochs   (~3.5h on an M2)
#   ./scripts/train.sh --model yolo11m.pt --epochs 200
#   ./scripts/train.sh --data           fetch + merge datasets first
#
# Runs detached and logs to .run/train.log, so closing the terminal will not
# kill it. Watch it with ./scripts/train-watch.sh.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/_ui.sh"

RUN_DIR="$ROOT/.run"
MODEL="yolo11s.pt"
EPOCHS=120
BATCH=8
NAME="belt_v1"
FETCH=0

while [ $# -gt 0 ]; do
  case "$1" in
    --fast)   MODEL="yolo11n.pt"; EPOCHS=60; shift ;;
    --model)  MODEL="${2:-}"; shift 2 ;;
    --epochs) EPOCHS="${2:-}"; shift 2 ;;
    --batch)  BATCH="${2:-}"; shift 2 ;;
    --name)   NAME="${2:-}"; shift 2 ;;
    --data)   FETCH=1; shift ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$RUN_DIR"
banner "Belt Sentinel — Training" "$MODEL · $EPOCHS epochs · batch $BATCH"

if pgrep -f "training/train.py" >/dev/null; then
  fail "a training run is already in progress (pid $(pgrep -f 'training/train.py' | head -1))"
  note "Watch it:  ./scripts/train-watch.sh"
  note "Stop it:   ./scripts/stop.sh --all"
  exit 1
fi

# ---- data -------------------------------------------------------------------
if [ "$FETCH" = "1" ]; then
  section "Dataset"
  info "downloading from Roboflow…"
  python3 "$ROOT/training/download_dataset.py" 2>&1 | grep -aE '^(✓|✗|→|Done)' | sed 's/^/  /'
  info "merging and unifying class names…"
  python3 "$ROOT/training/merge_datasets.py" 2>&1 | tail -20 | sed 's/^/  /'
fi

if [ ! -f "$ROOT/training/data/merged/data.yaml" ]; then
  fail "no merged dataset found"
  note "Fetch it with:  ./scripts/train.sh --data"
  note "Or import your own:  python training/import_dataset.py <zip>"
  exit 1
fi

NTRAIN=$(ls "$ROOT/training/data/merged/train/images" 2>/dev/null | wc -l | tr -d ' ')
NVAL=$(ls "$ROOT/training/data/merged/valid/images" 2>/dev/null | wc -l | tr -d ' ')
CLASSES=$(awk '/^names:/{f=1;next} f&&/^- /{sub(/^- /,""); printf "%s ", $0; next} f{exit}' \
  "$ROOT/training/data/merged/data.yaml")

section "Configuration"
kv "Dataset"  "$NTRAIN train  ·  $NVAL val"
kv "Classes"  "$CLASSES"
kv "Model"    "$MODEL"
kv "Schedule" "$EPOCHS epochs  ·  batch $BATCH  ·  640px"

# 8 GB of unified memory cannot hold a batch of 16 at 640px; it pages to disk
# and runs roughly five times slower. Warn rather than silently override.
if [ "$BATCH" -gt 8 ]; then
  MEM=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
  if [ "$MEM" -gt 0 ] && [ "$MEM" -le 8589934592 ]; then
    warn "batch $BATCH on an 8 GB machine will swap and run much slower"
    note "batch 8 is the practical maximum here"
  fi
fi

section "Launch"
( cd "$ROOT" && exec nohup python3 training/train.py \
    --model "$MODEL" --epochs "$EPOCHS" --batch "$BATCH" --name "$NAME" \
    >"$RUN_DIR/train.log" 2>&1 </dev/null ) &
TRAIN_PID=$!
disown "$TRAIN_PID" 2>/dev/null || true
echo "$TRAIN_PID" > "$RUN_DIR/train.pid"

sleep 2
if pgrep -f "training/train.py" >/dev/null; then
  ok "training started  (pid $(cat "$RUN_DIR/train.pid"))"
else
  fail "training failed to start"
  tail -10 "$RUN_DIR/train.log" | sed 's/^/      /'
  exit 1
fi

hr
printf "  %sWatch it%s     ./scripts/train-watch.sh %s\n" "$GREY" "$RESET" "$NAME"
printf "  %sRaw log%s      .run/train.log\n" "$GREY" "$RESET"
printf "  %sStop it%s      ./scripts/stop.sh --all\n\n" "$GREY" "$RESET"
printf "  %sWeights install to backend/models/belt_v1.pt automatically.%s\n\n" "$DIM" "$RESET"
