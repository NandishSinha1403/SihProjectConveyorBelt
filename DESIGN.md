# C.A.R.R.Y — Design System
> prismatic light through obsidian

The colour, type and spacing reference for the control-room dashboard.

**[`frontend/src/index.css`](frontend/src/index.css) is the source of truth.**
Every token below is defined there inside `@theme`, and Tailwind v4 generates
the utilities (`bg-obsidian`, `text-bone`, `border-ash`, `text-sev-critical`)
directly from those custom properties. This file explains *why* the values are
what they are; it does not restate them for copying, because a second copy is a
second thing to drift.

---

## The three rules

**1. Use the tokens, never raw Tailwind colours.** A one-off `amber-500` in a
warning banner is the usual way this drifts; `sev-medium` already means exactly
that. **This applies to charts too** — a charting library is the classic place
for a stray `#8884d8` to appear. Every axis, grid line and series colour comes
from [`components/ui/Chart.tsx`](frontend/src/components/ui/Chart.tsx), which
holds them as `var(--color-*)` strings rather than resolved hex, so a chart
repaints correctly when the theme flips without re-rendering React.

**2. Severity hues belong to severity.** The five incident levels own red,
orange, amber and blue. Chrome that is not an alert may not borrow them —
that is what `signal` exists for.

**3. Light mode is a token swap, not a component change.** No component file
branches on the theme. `:root[data-theme="light"]` overrides the same custom
properties at higher specificity, so `bg-obsidian` keeps meaning "the canvas"
in either mode. If a component needs a conditional colour, the token is missing.

---

## Tokens — Colour

Both themes define the same roles. Light mode is a warm paper white rather than
pure `#fff`, so the panel/raised steps still read as a surface stack instead of
flattening into one sheet.

### Canvas

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--color-obsidian` | `#101010` | `#f7f6f4` | The page ground |
| `--color-pitch` | `#0a0a0a` | `#ffffff` | Below the floor — video wells, insets |
| `--color-panel` | `#151617` | `#ffffff` | Cards and panels |
| `--color-raised` | `#1b1c1d` | `#efeeeb` | Hover and active rows |
| `--color-veil` | `#495764` | `#9aa7b0` | The documented ceiling; the steps below are interpolated so dense panels never brighten past it |

`raised` is capped at the lightest value that still clears 4.5:1 for `fog` and
for the severity hues sitting on a hovered row. Going brighter breaks the alert
rail's contrast, not just its look.

The body carries a 64px grid, drawn as two `linear-gradient` hairlines in
`--color-panel`. It reads as drafting paper under the content and disappears
entirely at a glance.

### Ink

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--color-bone` | `#fffdf9` | `#17181a` | Primary text and UI chrome |
| `--color-fog` | `#6f879c` | `#5c6773` | Muted secondary text, labels, metadata |
| `--color-ash` | `#403f3f` | `#dcdad5` | Hairline dividers and card outlines, at 1px |

`--color-ash` is the global default border colour, set on `*` in `@layer base`,
so a bare `border` is already correct.

### Severity

| Token | Dark | Light |
| --- | --- | --- |
| `--color-sev-critical` | `#ff2a2a` | `#d81f1f` |
| `--color-sev-high` | `#ff7a3d` | `#d9600a` |
| `--color-sev-medium` | `#f5c451` | `#a1780a` |
| `--color-sev-low` | `#2a7fff` | `#1f5fd9` |
| `--color-sev-info` | `#6f879c` | `#5c6773` |
| `--color-ok` | `#2aff2a` | `#178a3e` |

Deepened in light mode for AA contrast on a pale ground. `SEVERITY_META` in
[`frontend/src/lib/severity.ts`](frontend/src/lib/severity.ts) is the mapping
from level to token.

`--color-prism-red` `#ff2a2a`, `--color-prism-cyan` `#2a7fff` and
`--color-prism-lime` `#2aff2a` are the reference's RGB-split accents, and are
the origin of critical, low and ok respectively. Prefer the semantic token;
reach for a prism value only in decorative artwork.

### Signal — chrome, never an alert

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--color-signal` | `#b7ff3a` | `#6ca80f` | Nav fills, active states, the settings panel eyebrow |
| `--color-signal-dim` | `#8fce22` | `#588c0a` | The same accent, receded |
| `--color-signal-ink` | `#0d1400` | `#f7ffe9` | Text *on* a signal fill |

Every common hue is already spoken for by severity (red/orange/amber/blue) or
health (green), so the shell's own accent has to live outside that family to
stay unambiguous at a glance. Acid lime does that.

**It never touches a detection, a card, or an alert.** If signal appears
anywhere an operator might read it as a condition of the belt, it is being
misused. `PillNav` shows the rule working: the pill itself is signal, but the
dot marking an open critical incident is `sev-critical`, because that dot is
reporting on the belt.

---

## Tokens — Type

| Token | Stack | Use |
| --- | --- | --- |
| `--font-sans` | Inter Variable | Everything by default |
| `--font-mono` | IBM Plex Mono | Numbers, ids, timestamps, measured values |
| `--font-display` | Fraunces Variable | Display voice — page headings, panel titles, drawer item labels |
| `--font-brand` | EB Garamond Variable | The wordmark alone, nowhere else |

`--font-display` is never body copy and never data. It carries identity; the
moment it carries information, the page stops looking like an instrument.

`--font-brand` is split from it because the mark has a job no heading has: it
holds at `18rem` in the footer and at `1rem` inside the header, and Fraunces'
optical sizing pulls in a direction the mark does not want across that range.
Only `C.A.R.R.Y` and its expansion use it — a third face anywhere else would
just read as an inconsistency.

Mono is not decorative either: it is for values that are read digit by digit or
compared down a column, where tabular figures matter.

### Scale

| Token | Size | Use |
| --- | --- | --- |
| `--text-caption` | 12px | Timestamps, footnotes |
| `--text-label` | 13px | Field labels, table headers |
| `--text-body` | 15px | Default |
| `--text-body-lg` | 17px | Lead paragraphs |
| `--text-title` | 22px | Panel and section titles |
| `--text-display-sm` | 33px | Page headings |
| `--text-display` | 56px | The wordmark and hero numerals |

Fixed rem, not fluid. Product UI is read at consistent DPI, and a heading that
shrinks inside a rail looks worse, not better.

---

## Tokens — Shape and motion

| Token | Value | Use |
| --- | --- | --- |
| `--radius-nav` | 5px | Nav pills, small controls |
| `--radius-card` | 15px | Cards, panels, the video well |
| `--radius-btn` | 0px | Buttons — deliberately square |
| `--radius-pill` | 9999px | Status chips, counts |
| `--ease-focus` | `cubic-bezier(0.52, 0.01, 0, 1)` | All transitions |

`--ease-focus` is the reference's signature curve: slow start, decisive stop,
like an optical focus pull. Held to product timings — an operator is mid-task
and should not wait for choreography.

---

## Components

| Component | File | Notes |
| --- | --- | --- |
| `PillNav` | [`components/nav/PillNav.tsx`](frontend/src/components/nav/PillNav.tsx) | The horizontal nav. Active pill is `text-signal` with a signal dot beneath; hover expands a `bg-signal` circle behind a duplicate label in `signal-ink` (GSAP) |
| `NavPanel` | [`components/nav/NavPanel.tsx`](frontend/src/components/nav/NavPanel.tsx) | Slide-over holding the full six-destination index, numbered, with the staggered reveal (GSAP) |
| `ThemeToggle` | [`components/ThemeToggle.tsx`](frontend/src/components/ThemeToggle.tsx) | Sets `data-theme` on `<html>` |
| `Wordmark` | [`components/Wordmark.tsx`](frontend/src/components/Wordmark.tsx) | `C.A.R.R.Y` unfolds into the full name on click. See below |
| `Footer` | [`components/Footer.tsx`](frontend/src/components/Footer.tsx) | Oversized mark, hairline, labelled micro-columns. Shell chrome, so absent on `/rig` |
| `Chart` | [`components/ui/Chart.tsx`](frontend/src/components/ui/Chart.tsx) | Recharts axis/grid/tooltip chrome bound to the tokens, plus the sparse-data fallback |

**PillNav and NavPanel are not duplicates.** PillNav is the always-visible
working set — the destinations an operator needs one click away mid-shift.
NavPanel is the complete index behind the burger, which is also how a phone
reaches all six when the pill row is tight. (An earlier note here said Settings
had been moved out "so five links became four"; that stopped being true when
Analytics arrived and the drawer became the full list.)

### The wordmark

`C.A.R.R.Y` expands, in place, to *Conveyor Anomaly Recognition & Reliability
Yield*. Each initial is already the first letter of its word, so the mark
**grows rather than cross-fades**: every anchor letter keeps its place at the
head of its own word, the rest of the word unrolls from behind it, and only the
following words slide right. A cross-fade between two strings would be the
obvious implementation and would throw away the only interesting thing about
the mark.

Three details it would be easy to get wrong, and does not: the full name is
always in the DOM inside an `sr-only` span, so a screen reader never hears
"C dot A dot R dot R dot Y"; `prefers-reduced-motion` swaps the states without
animating; and the button is absolutely positioned inside its header cell, so
opening it cannot shove the centred `PillNav` sideways. It steps down from
`1.5rem` to `1rem` as it opens, because the long form is 48 characters and does
not fit beside the nav at display size — which is also the size the tails are
measured at, since measuring them closed would leave the open mark clipped.

Two things about how it is built, both learned the hard way. The button carries
`w-max` and every part carries `shrink-0`: without them the absolutely
positioned button inherits a shrink-to-fit cap from its `1fr` grid column, the
flex children compress under their content width, and the measured widths come
back too small — which is exactly how the mark ended up clipped.

And unlike `PillNav` and `NavPanel`, **this one uses CSS transitions rather than
GSAP**. It is a two-state toggle whose states React already owns, and the GSAP
version wrote inline `width` onto elements React re-renders; the two disagreed
about ownership and the mark silently stopped opening at all. Declaring both
states and letting the browser interpolate has no such failure mode. Reach for
GSAP where the choreography is genuinely imperative, not for a toggle.

The **3D Model** tab is the one deliberate exception: it carries its own
palette and its own independent light/dark switch, scoped under `.rig-page` in
[`components/rig/rig.css`](frontend/src/components/rig/rig.css). It is a
different instrument with a different visual identity, and the two themes are
never tied together — see the comment in `App.tsx`.

---

## Known drift — the severity palette

`severity.ts` says in a comment that the box burned onto the video matches its
card in the alert rail. **It does not — all five have drifted.**
`SEVERITY_COLORS` in
[`backend/app/pipeline/annotate.py`](backend/app/pipeline/annotate.py) stores
BGR; converted to hex:

| Severity | Backend draws | Frontend shows |
| --- | --- | --- |
| info | `#b0b0b0` grey | `#6f879c` blue-grey |
| low | `#60c4de` cyan | `#2a7fff` blue |
| medium | `#fabe40` | `#f5c451` |
| high | `#ff8030` | `#ff7a3d` |
| critical | `#f53c3c` | `#ff2a2a` |

Medium, high and critical are near enough to read as the same colour; **info
and low are visibly different**. Fixing this means rewriting `SEVERITY_COLORS`
as BGR of the frontend values — remember OpenCV takes `(B, G, R)`, which is how
the drift started in the first place. Change the two together, or delete the
claim.

Note that the backend has one palette while the frontend has two: the burned-in
box colour does not follow the dashboard's light mode, because it is baked into
the JPEG before the browser ever sees it.
