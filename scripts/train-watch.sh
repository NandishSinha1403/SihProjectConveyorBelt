#!/usr/bin/env bash
#
# Live training dashboard for the belt damage detector.
#
#   ./scripts/train-watch.sh              watch the default run, refresh every 5s
#   ./scripts/train-watch.sh belt_v2      watch a named run
#   ./scripts/train-watch.sh -1           render once and exit (for CI / logs)
#
# Reads Ultralytics' results.csv, so it works whether training was started by
# scripts/train.sh, by hand, or in another terminal entirely.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/_ui.sh"

RUN="${1:-belt_v1}"
[ "$RUN" = "-1" ] && { RUN="belt_v1"; ONCE=1; } || ONCE="${ONCE:-0}"
[ "${2:-}" = "-1" ] && ONCE=1

RUN_DIR="$ROOT/training/runs/$RUN"
CSV="$RUN_DIR/results.csv"
ARGS="$RUN_DIR/args.yaml"
LOG="${TRAIN_LOG:-/tmp/train.log}"
REFRESH="${REFRESH:-5}"

cleanup() { printf '%s' "$SHOW_CURSOR"; exit 0; }
trap cleanup INT TERM

yaml_get() { [ -f "$ARGS" ] && awk -v k="$1" -F': *' '$1==k{print $2; exit}' "$ARGS"; }

# Pull one column from the final row of results.csv by header name.
csv_last() {
  [ -f "$CSV" ] || return 1
  awk -F',' -v want="$1" '
    NR==1 { for (i=1;i<=NF;i++) { gsub(/^ +| +$/,"",$i); if ($i==want) col=i } next }
    col && NF>=col { val=$col }
    END { if (val!="") print val }
  ' "$CSV"
}

csv_series() {
  [ -f "$CSV" ] || return 1
  awk -F',' -v want="$1" '
    NR==1 { for (i=1;i<=NF;i++) { gsub(/^ +| +$/,"",$i); if ($i==want) col=i } next }
    col && NF>=col { printf "%s ", $col }
  ' "$CSV"
}

fmt() { awk -v v="${1:-}" -v f="${2:-%.4f}" 'BEGIN{ if (v=="") print "—"; else printf f, v }'; }
pct()  { awk -v v="${1:-}" 'BEGIN{ if (v=="") print "—"; else printf "%.1f%%", v*100 }'; }

render() {
  local total epoch_done model device imgsz batch data
  total=$(yaml_get epochs); total="${total:-?}"
  model=$(yaml_get model);  model="${model:-?}"
  device=$(yaml_get device); device="${device:-?}"
  imgsz=$(yaml_get imgsz);  batch=$(yaml_get batch)

  printf '%s' "$CLEAR"
  banner "Belt Sentinel — Training" "run: $RUN"

  # ---- process state -------------------------------------------------------
  local pid state state_col
  pid=$(pgrep -f "train.py.*--name $RUN" | head -1)
  if [ -n "$pid" ]; then
    state="RUNNING  (pid $pid)"; state_col="$GREEN"
  elif [ -f "$RUN_DIR/weights/best.pt" ]; then
    state="FINISHED"; state_col="$BLUE"
  else
    state="NOT RUNNING"; state_col="$RED"
  fi

  section "Run"
  kv "Status"   "$state" "$state_col"
  kv "Model"    "$(basename "${model}")"
  kv "Device"   "$device"
  kv "Geometry" "${imgsz:-?}px  ·  batch ${batch:-?}"

  # ---- dataset -------------------------------------------------------------
  local dyaml="$ROOT/training/data/merged/data.yaml"
  if [ -f "$dyaml" ]; then
    local classes ntrain nval
    classes=$(awk '/^names:/{f=1;next}
                   f&&/^- /{sub(/^- /,""); printf "%s ", $0; next}
                   f{exit}' "$dyaml")
    ntrain=$(ls "$ROOT/training/data/merged/train/images" 2>/dev/null | wc -l | tr -d ' ')
    nval=$(ls "$ROOT/training/data/merged/valid/images" 2>/dev/null | wc -l | tr -d ' ')
    kv "Dataset"  "${ntrain} train  ·  ${nval} val"
    kv "Classes"  "${classes:-?}"
  fi

  # ---- progress ------------------------------------------------------------
  epoch_done=$(csv_last epoch)
  section "Progress"

  if [ -z "$epoch_done" ]; then
    # results.csv only appears after epoch 1 validates; until then read the
    # live progress bar out of the training log so the first epoch is not a
    # blank screen for several minutes.
    local tail_clean phase ep frac it
    # Ultralytics redraws its progress bar with \r and colour escapes; strip
    # both or the epoch number parses as an escape sequence.
    tail_clean=$(tail -c 6000 "$LOG" 2>/dev/null | tr '\r' '\n' \
                 | sed -E 's/'"$(printf '\033')"'\[[0-9;]*[A-Za-z]//g')

    # An epoch is train-then-validate. Without distinguishing the two the bar
    # sits at 100% for minutes and looks hung.
    if printf '%s\n' "$tail_clean" | tail -4 | grep -qa "mAP50-95"; then
      phase="validating"
      frac=$(printf '%s\n' "$tail_clean" | grep -a "mAP50-95" | tail -1 \
             | grep -oE '[0-9]+%' | tail -1 | tr -d '%')
      it=$(printf '%s\n' "$tail_clean" | grep -a "mAP50-95" | tail -1 \
           | grep -oE '[0-9]+/[0-9]+ [0-9.]+it/s' | tail -1)
    else
      phase="training"
      local live
      live=$(printf '%s\n' "$tail_clean" | grep -a "640:" | tail -1)
      frac=$(printf '%s' "$live" | grep -oE '[0-9]+%' | tail -1 | tr -d '%')
      it=$(printf '%s' "$live" | grep -oE '[0-9]+/[0-9]+ [0-9.]+it/s' | tail -1)
    fi

    # The epoch number only appears on training lines, so remember the most
    # recent one -- validation output does not carry it.
    ep=$(printf '%s\n' "$tail_clean" | grep -a "640:" | tail -1 | awk '{print $1}')
    [ -z "$ep" ] && ep=$(grep -a "640:" "$LOG" 2>/dev/null | tr '\r' '\n' \
        | sed -E 's/'"$(printf '\033')"'\[[0-9;]*[A-Za-z]//g' | tail -1 | awk '{print $1}')

    if [ -n "$ep" ] || [ -n "$frac" ]; then
      note "Epoch ${ep:-1} — $phase (no epoch has finished validating yet)"
      [ -n "$it" ] && kv "Iteration" "$it"
      if [ -n "$frac" ]; then
        printf "  "
        if [ "$phase" = "validating" ]; then
          bar "$(awk -v f="$frac" 'BEGIN{print f/100}')" 46 "$CYAN"
        else
          bar "$(awk -v f="$frac" 'BEGIN{print f/100}')" 46
        fi
        printf "  %s%% %s%s%s\n" "$frac" "$DIM" "$phase" "$RESET"
      fi
      note "The first epoch is slowest — it also warms the dataset cache."
    else
      note "Waiting for the first epoch to start…"
    fi
  else
    local frac elapsed per_epoch remaining
    frac=$(awk -v e="$epoch_done" -v t="$total" 'BEGIN{ if (t+0>0) print e/t; else print 0 }')
    printf "  "; bar "$frac" 46
    printf "  %s%s/%s epochs%s\n" "$BOLD" "$epoch_done" "$total" "$RESET"

    elapsed=$(csv_last time)
    if [ -n "$elapsed" ]; then
      per_epoch=$(awk -v t="$elapsed" -v e="$epoch_done" 'BEGIN{ if (e+0>0) print t/e; else print 0 }')
      remaining=$(awk -v p="$per_epoch" -v t="$total" -v e="$epoch_done" 'BEGIN{ print p*(t-e) }')
      printf "\n"
      kv "Elapsed"        "$(dur "$elapsed")"
      kv "Per epoch"      "$(dur "$per_epoch")"
      [ -n "$pid" ] && kv "Est. remaining" "$(dur "$remaining")" "$AMBER"
    fi

    # ---- metrics -----------------------------------------------------------
    section "Metrics"
    local map50 map precision recall
    map50=$(csv_last "metrics/mAP50(B)")
    map=$(csv_last "metrics/mAP50-95(B)")
    precision=$(csv_last "metrics/precision(B)")
    recall=$(csv_last "metrics/recall(B)")

    kv "mAP@.5"      "$(pct "$map50")"     "$BOLD$GREEN"
    kv "mAP@.5:.95"  "$(pct "$map")"
    kv "Precision"   "$(pct "$precision")"
    kv "Recall"      "$(pct "$recall")"

    local series
    series=$(csv_series "metrics/mAP50(B)")
    if [ -n "$series" ]; then
      printf "  %s%-22s%s " "$GREY" "mAP@.5 trend" "$RESET"
      spark "$series"; printf "\n"
    fi

    # Best epoch so far -- Ultralytics keeps best.pt from this row.
    local best
    best=$(awk -F',' '
      NR==1 { for (i=1;i<=NF;i++) { gsub(/^ +| +$/,"",$i)
              if ($i=="metrics/mAP50(B)") m=i; if ($i=="epoch") e=i } next }
      m && $m+0 > top { top=$m+0; ep=$e }
      END { if (ep!="") printf "epoch %d  (%.1f%%)", ep, top*100 }' "$CSV")
    [ -n "$best" ] && kv "Best so far" "$best" "$CYAN"

    section "Losses"
    kv "box / cls / dfl (train)" \
      "$(fmt "$(csv_last 'train/box_loss')" '%.3f') / $(fmt "$(csv_last 'train/cls_loss')" '%.3f') / $(fmt "$(csv_last 'train/dfl_loss')" '%.3f')"
    kv "box / cls / dfl (val)" \
      "$(fmt "$(csv_last 'val/box_loss')" '%.3f') / $(fmt "$(csv_last 'val/cls_loss')" '%.3f') / $(fmt "$(csv_last 'val/dfl_loss')" '%.3f')"
  fi

  # ---- failures ------------------------------------------------------------
  if [ -f "$LOG" ]; then
    local err
    err=$(grep -aE "Traceback|Error:|RuntimeError|KeyError|Killed|out of memory" "$LOG" | tail -1)
    if [ -n "$err" ]; then
      section "Last error in log"
      printf "  %s%s%s\n" "$RED" "$(printf '%s' "$err" | cut -c1-72)" "$RESET"
    fi
  fi

  # ---- outcome -------------------------------------------------------------
  if [ -z "$pid" ] && [ -f "$RUN_DIR/weights/best.pt" ]; then
    section "Done"
    ok "Weights: training/runs/$RUN/weights/best.pt"
    if [ -f "$ROOT/backend/models/belt_v1.pt" ]; then
      ok "Installed to backend/models/belt_v1.pt"
      note "Set DETECTOR=yolo in backend/.env, then ./scripts/stop.sh && ./scripts/start.sh"
    fi
    note "Evaluate: python training/evaluate.py"
  fi

  hr
  if [ "$ONCE" = "1" ]; then
    printf "  %sfinal render%s\n\n" "$DIM" "$RESET"
  else
    printf "  %srefreshing every %ss  ·  ctrl-c to exit  ·  %s%s\n\n" \
      "$DIM" "$REFRESH" "$(date '+%H:%M:%S')" "$RESET"
  fi
}

if [ "$ONCE" = "1" ]; then
  render
else
  printf '%s' "$HIDE_CURSOR"
  while true; do render; sleep "$REFRESH"; done
fi
