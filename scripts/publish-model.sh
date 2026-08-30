#!/usr/bin/env bash
#
# Publish a trained model to GitHub.
#
#   ./scripts/publish-model.sh                 publish the current belt_v1 run
#   ./scripts/publish-model.sh --run belt_v2   publish a named run
#   ./scripts/publish-model.sh --dry-run       show what would be pushed
#
# Called automatically at the end of training. Safe to run by hand.
#
# It stages ONLY model artefacts by explicit path -- never `git add -A` -- so
# running it never sweeps up unrelated work in progress.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/_ui.sh"

RUN="belt_v1"
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --run)     RUN="${2:-belt_v1}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "Unknown option: $1"; exit 1 ;;
  esac
done

RUN_DIR="$ROOT/training/runs/$RUN"
WEIGHTS="$ROOT/backend/models/belt_v1.pt"
CSV="$RUN_DIR/results.csv"

banner "Belt Sentinel" "publishing model to GitHub"

cd "$ROOT" || exit 1

# ---- preconditions ----------------------------------------------------------
section "Checks"

if [ ! -f "$WEIGHTS" ]; then
  fail "no weights at backend/models/belt_v1.pt"
  note "Train first:  ./scripts/train.sh"
  exit 1
fi
ok "weights present  ($(du -h "$WEIGHTS" | cut -f1 | tr -d ' '))"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  fail "not a git repository"; exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  fail "no 'origin' remote configured"
  note "git remote add origin <url>"
  exit 1
fi
ok "remote  $(git remote get-url origin)"

# ---- metrics ----------------------------------------------------------------
SUMMARY=""
if [ -f "$CSV" ]; then
  SUMMARY=$(awk -F',' '
    NR==1 { for(i=1;i<=NF;i++){ gsub(/^ +| +$/,"",$i)
            if($i=="metrics/mAP50(B)")m=i; if($i=="metrics/mAP50-95(B)")n=i
            if($i=="metrics/precision(B)")p=i; if($i=="metrics/recall(B)")r=i
            if($i=="epoch")e=i } next }
    m && $m+0>top { top=$m+0; ep=$e; strict=$n+0; prec=$p+0; rec=$r+0 }
    END { if(ep!="") printf "epoch %d — mAP@.5 %.1f%%, mAP@.5:.95 %.1f%%, P %.1f%%, R %.1f%%",
          ep, top*100, strict*100, prec*100, rec*100 }' "$CSV")
  EPOCHS=$(awk -F',' 'END{print $1+0}' "$CSV")
  [ -n "$SUMMARY" ] && kv "Best" "$SUMMARY" "$GREEN"
fi

CLASSES=$(awk '/^names:/{f=1;next} f&&/^- /{sub(/^- /,""); printf "%s ", $0; next} f{exit}' \
  "$ROOT/training/data/merged/data.yaml" 2>/dev/null)
[ -n "$CLASSES" ] && kv "Classes" "$CLASSES"

# Write a metrics file so the numbers travel with the weights.
REPORT="$ROOT/backend/models/belt_v1.metrics.txt"
{
  echo "run          $RUN"
  echo "trained      $(date '+%Y-%m-%d %H:%M %Z')"
  echo "host         $(uname -s) $(uname -m)"
  [ -n "${EPOCHS:-}" ] && echo "epochs       ${EPOCHS}"
  [ -n "$CLASSES" ]    && echo "classes      ${CLASSES}"
  [ -n "$SUMMARY" ]    && echo "best         ${SUMMARY}"
  echo "sha256       $(shasum -a 256 "$WEIGHTS" | cut -d' ' -f1)"
} > "$REPORT"

# ---- stage ------------------------------------------------------------------
section "Staging"

# Explicit paths only. Anything else in the working tree is left untouched.
PATHS="backend/models/belt_v1.pt backend/models/belt_v1.metrics.txt"
for plot in results.png confusion_matrix_normalized.png PR_curve.png; do
  if [ -f "$RUN_DIR/$plot" ]; then
    mkdir -p "$ROOT/docs/model"
    cp "$RUN_DIR/$plot" "$ROOT/docs/model/$plot"
    PATHS="$PATHS docs/model/$plot"
  fi
done
[ -f "$CSV" ] && { mkdir -p "$ROOT/docs/model"; cp "$CSV" "$ROOT/docs/model/results.csv"; \
                   PATHS="$PATHS docs/model/results.csv"; }

# shellcheck disable=SC2086
git add -f $PATHS 2>/dev/null

if git diff --cached --quiet; then
  warn "nothing changed — this model is already published"
  exit 0
fi

for f in $(git diff --cached --name-only); do
  info "$f"
done

if [ "$DRY" = "1" ]; then
  hr; note "dry run — nothing committed"; git reset -q; exit 0
fi

# ---- commit -----------------------------------------------------------------
section "Publishing"

MSG="Trained model: ${SUMMARY:-$RUN}"
git commit -q -m "$MSG" -m "$(cat "$REPORT")" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" || {
    fail "commit failed"; exit 1; }
ok "committed  $(git rev-parse --short HEAD)"

BRANCH=$(git rev-parse --abbrev-ref HEAD)

if git push -q origin "$BRANCH" 2>/dev/null; then
  ok "pushed to origin/$BRANCH"
else
  # The usual cause is the remote having moved on -- a push from Kaggle, or
  # work from another machine. Rebase onto it and retry once rather than
  # leaving the model committed but unpublished.
  warn "push rejected — remote has moved on, rebasing"
  if git pull -q --rebase origin "$BRANCH" 2>/dev/null && \
     git push -q origin "$BRANCH" 2>/dev/null; then
    ok "pushed to origin/$BRANCH after rebase"
  else
    fail "could not push"
    note "The model is committed locally. Resolve and push manually:"
    note "  git pull --rebase origin $BRANCH && git push origin $BRANCH"
    exit 1
  fi
fi

hr
REMOTE=$(git remote get-url origin | sed 's/\.git$//')
printf "  %s%s%s\n\n" "$CYAN" "$REMOTE" "$RESET"
