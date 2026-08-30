#!/usr/bin/env bash
# Shared presentation helpers for the Belt Sentinel scripts.
# Sourced, never executed directly.
#
# Written for bash 3.2, which is what macOS ships -- no associative arrays,
# no ${var,,}, no mapfile.

# Honour NO_COLOR, and drop colour when output is not a terminal so that
# piping a script into a file or a log does not fill it with escape codes.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  ESC=$(printf '\033')
  DIM="${ESC}[2m";     BOLD="${ESC}[1m";    RESET="${ESC}[0m"
  RED="${ESC}[38;5;203m";    GREEN="${ESC}[38;5;114m"
  YELLOW="${ESC}[38;5;221m"; BLUE="${ESC}[38;5;75m"
  AMBER="${ESC}[38;5;214m";  GREY="${ESC}[38;5;244m"
  CYAN="${ESC}[38;5;80m";    MAGENTA="${ESC}[38;5;176m"
  HIDE_CURSOR="${ESC}[?25l"; SHOW_CURSOR="${ESC}[?25h"
  CLEAR="${ESC}[H${ESC}[2J${ESC}[3J"
else
  DIM=""; BOLD=""; RESET=""; RED=""; GREEN=""; YELLOW=""; BLUE=""
  AMBER=""; GREY=""; CYAN=""; MAGENTA=""
  HIDE_CURSOR=""; SHOW_CURSOR=""; CLEAR=""
fi

term_width() {
  local w
  w=$(tput cols 2>/dev/null) || w=80
  [ -z "$w" ] && w=80
  [ "$w" -lt 60 ] && w=60
  [ "$w" -gt 100 ] && w=100
  printf '%s' "$w"
}

# repeat <string> <count>
repeat() {
  local s="$1" n="$2" out=""
  while [ "$n" -gt 0 ]; do out="$out$s"; n=$((n - 1)); done
  printf '%s' "$out"
}

hr() {
  local w; w=$(term_width)
  printf "%s%s%s\n" "$DIM" "$(repeat '─' "$w")" "$RESET"
}

banner() {
  local title="$1" subtitle="${2:-}" w; w=$(term_width)
  printf "\n%s%s%s%s\n" "$AMBER" "$BOLD" "  ▗▖ $title" "$RESET"
  [ -n "$subtitle" ] && printf "%s     %s%s\n" "$GREY" "$subtitle" "$RESET"
  printf "%s  %s%s\n" "$DIM" "$(repeat '━' $((w - 2)))" "$RESET"
}

section() {
  printf "\n  %s%s%s%s\n" "$BOLD" "$CYAN" "$1" "$RESET"
}

# kv <label> <value> [colour]
kv() {
  local colour="${3:-$RESET}"
  printf "  %s%-22s%s %s%s%s\n" "$GREY" "$1" "$RESET" "$colour" "$2" "$RESET"
}

ok()    { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
warn()  { printf "  %s!%s %s\n" "$YELLOW" "$RESET" "$1"; }
fail()  { printf "  %s✗%s %s\n" "$RED" "$RESET" "$1"; }
info()  { printf "  %s·%s %s\n" "$BLUE" "$RESET" "$1"; }
note()  { printf "  %s%s%s\n" "$DIM" "$1" "$RESET"; }

# bar <fraction 0..1> <width> [colour]
bar() {
  local frac="$1" width="$2" colour="${3:-$AMBER}"
  local filled
  filled=$(awk -v f="$frac" -v w="$width" 'BEGIN{
    v = int(f * w + 0.5); if (v < 0) v = 0; if (v > w) v = w; print v }')
  printf "%s%s%s%s%s%s" \
    "$colour" "$(repeat '█' "$filled")" \
    "$DIM" "$(repeat '░' $((width - filled)))" "$RESET" ""
}

# spark <space-separated numbers> -- unicode sparkline, auto-scaled
spark() {
  awk -v dim="$DIM" -v reset="$RESET" -v amber="$AMBER" '
  {
    n = NF; if (n == 0) exit
    lo = $1; hi = $1
    for (i = 1; i <= n; i++) { if ($i < lo) lo = $i; if ($i > hi) hi = $i }
    # Assign each glyph separately: macOS awk is not UTF-8 aware, so
    # split() on a multibyte string yields individual bytes, not characters.
    ticks[1]="▁"; ticks[2]="▂"; ticks[3]="▃"; ticks[4]="▄"
    ticks[5]="▅"; ticks[6]="▆"; ticks[7]="▇"; ticks[8]="█"
    out = ""
    for (i = 1; i <= n; i++) {
      if (hi == lo) idx = 4
      else idx = int((($i - lo) / (hi - lo)) * 7) + 1
      out = out ticks[idx]
    }
    printf "%s%s%s", amber, out, reset
  }' <<< "$1"
}

# human-readable duration from seconds
dur() {
  awk -v s="$1" 'BEGIN{
    s = int(s)
    if (s < 60) { printf "%ds", s; exit }
    h = int(s / 3600); m = int((s % 3600) / 60); sec = s % 60
    if (h > 0) printf "%dh %02dm", h, m
    else printf "%dm %02ds", m, sec
  }'
}

# -sTCP:LISTEN matters: without it lsof also returns processes *connected* to
# the port, so the Vite dev server (which proxies to the API) would be reported
# as the backend's pid.
port_pid() { lsof -ti tcp:"$1" -sTCP:LISTEN 2>/dev/null | head -1; }

# Strip inline comments and surrounding whitespace from a KEY=value .env line.
env_get() {
  [ -f "$2" ] || return 1
  awk -F= -v k="$1" '$1==k {
    sub(/^[^=]*=/, "", $0); sub(/#.*/, "", $0)
    gsub(/^[ \t"'"'"']+|[ \t"'"'"']+$/, "", $0)
    print; exit
  }' "$2"
}
port_busy() { [ -n "$(port_pid "$1")" ]; }
