---
target: frontend/src/pages/LiveMonitor.tsx
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-08-31T08-56-51Z
slug: frontend-src-pages-livemonitor-tsx
---
⚠️ DEGRADED: single-context (operator instructions forbid spawning sub-agents unless the user explicitly requests them)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Exceptional for sighted users; zero live regions, so a CRITICAL alert is announced to nobody |
| 2 | Match System / Real World | 3 | Domain language is correct, but "CLAHE" and "YOLO belt_v1.pt on mps" are developer strings on an operator surface |
| 3 | User Control and Freedom | 2 | "Clear" and video delete are irreversible with no confirm and no undo |
| 4 | Consistency and Standards | 3 | Strong single vocabulary; the 3-state overlay toggle cycles one icon with no visible state |
| 5 | Error Prevention | 2 | Two destructive one-click actions, no guards |
| 6 | Recognition Rather Than Recall | 2 | 18 title-only affordances; overlay mode must be remembered, not seen |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts on a surface watched for a full shift; no alert → incident jump |
| 8 | Aesthetic and Minimalist Design | 4 | Committed, restrained, one chromatic event; genuinely excellent |
| 9 | Error Recovery | 3 | Failure copy names problem and fix; "Stream unavailable" offers no retry |
| 10 | Help and Documentation | 2 | Empty states teach well; nothing explains CLAHE or thresholds in context |
| **Total** | | **25/40** | **Acceptable — significant improvements needed** |

## Design Specificity Verdict

**LLM assessment:** Authored, not category-interchangeable. The frames-skipped counter, the prism edge on a live critical defect, the belt-health ring as a hairline arc, and severity-as-the-only-chromatic-event are specific to *this* product's argument. A generic dashboard template would not have them. The weakness is not sameness — it is that the strongest ideas are under-exposed.

**Deterministic scan:** 2 findings, and the detector self-reported DEGRADED (htmlparser2, css-select, css-tree, domutils unavailable → regex fallback, no custom-property or computed-contrast evaluation). Findings are an undercount.
- `overused-font` (Inter) — **false positive against this brief.** DESIGN.md names Inter as the substitute for Neue Montreal. The brief wins.
- `layout-transition` (`transition-property: width`) — real. Two progress bars animate width, which triggers layout. P3.

**Visual overlays:** not injected. Reported as browser-probe evidence instead (73 focusables, 4 icon-only buttons without aria-label, 0 live regions, 0 images missing alt, 1 h1).

## Priority Issues

**[P0] Incident evidence is mouse-only.** `<tr onClick>` and `<li onClick>` in Incidents.tsx carry no `tabIndex`, `role`, or key handler. A keyboard or screen-reader user cannot open an incident's snapshot at all — the evidence trail is the product's audit story, and for that user it does not exist. *Fix:* make rows `<button>`-semantic or add `role="button" tabIndex={0}` plus Enter/Space. *Command:* `/impeccable harden`

**[P1] A critical alert is announced to nobody.** Zero live regions, and no audio. The scene is an operator watching a belt, not a screen. A CRITICAL tear opens, the rail updates silently, and nothing reaches someone who is not looking. *Fix:* `aria-live="assertive"` on the alert rail, plus an opt-in chime for critical. *Command:* `/impeccable harden`

**[P1] Two destructive actions have no guard.** "Clear" wipes the alert rail; the trash icon permanently deletes uploaded footage. One click, irreversible, no undo. *Fix:* confirm on delete; make Clear undoable for ~5s rather than confirmed. *Command:* `/impeccable harden`

**[P1] The product's central claim lives in a tooltip.** "Frames skipped" is the proof this is real-time rather than batch. It is explained only in a `title`, which never fires on touch and is unreachable by keyboard. 18 title-only affordances across the app. *Fix:* promote the frames-skipped explanation to visible text under the strip. *Command:* `/impeccable clarify`

**[P2] No keyboard shortcuts.** Alex watches this all shift and must mouse to Stop, Freeze, and overlay toggles. *Fix:* space = freeze, S = stop/start, O = cycle overlay, / = focus filter. *Command:* `/impeccable harden`

## Persona Red Flags

**Alex (power user):** No shortcuts anywhere; freezing the feed to inspect a defect needs a mouse trip to a 36px icon. Cannot jump from an alert card to its incident row — the thumbnail opens a raw JPEG in a new tab instead, dead-ending the investigation. The overlay toggle cycles three states through one icon, so he must click and observe to learn where he is.

**Sam (accessibility-dependent):** Cannot open any incident — rows are non-focusable click handlers (P0). Never learns a critical defect appeared (no live region). Four video controls expose only `title`, the weakest accessible-name mechanism. The incident drawer sets `role="dialog"` and `aria-modal` but never moves focus into it and never restores focus on close, so dismissing it drops him back at the document root.

## Minor Observations

- `transition-[width]` on two progress bars animates layout; `transform: scaleX()` is cheaper. P3.
- "YOLO belt_v1.pt on mps" is a developer string on an operator surface.
- The overlay cycle has no visible state label.
- Belt health pins at 0 on demo footage; correct arithmetic, but it reads as broken until explained.
- Video "Stream unavailable" is terminal — no retry affordance.

## Questions to Consider

- If the operator is watching the belt and not the screen, is a silent visual alert a monitoring system at all?
- The frames-skipped counter is the strongest argument this product makes. Why is it the ninth thing on the page and explained only on hover?
- What would this look like if the alert rail assumed nobody was looking at it?
