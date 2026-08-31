import { useEffect, useRef, useState } from "react";
import type { Incident } from "@/lib/types";
import { SEVERITY_META } from "@/lib/severity";

/**
 * Screen-reader announcements for incoming defects.
 *
 * The alert rail updates silently: a sighted operator sees a card appear, and
 * everyone else gets nothing. This is the audio-free half of the same problem
 * the alarm solves.
 *
 * Critical defects are assertive — they interrupt, which is the correct
 * trade for a rip-through risk. Everything else is polite and waits for a
 * gap, so a busy belt does not talk over the operator continuously.
 */
export function Announcer({ alerts }: { alerts: Incident[] }) {
  const [assertive, setAssertive] = useState("");
  const [polite, setPolite] = useState("");
  const seen = useRef<Set<number>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    // The first render carries the seeded backlog; announcing all of it would
    // read out a shift's history the moment the page loads.
    if (!primed.current) {
      alerts.forEach((a) => seen.current.add(a.id));
      primed.current = true;
      return;
    }

    const fresh = alerts.filter((a) => !seen.current.has(a.id));
    fresh.forEach((a) => seen.current.add(a.id));
    if (fresh.length === 0) return;

    const critical = fresh.filter((a) => a.severity === "critical");
    if (critical.length > 0) {
      const first = critical[0];
      setAssertive(
        critical.length === 1
          ? `Critical defect. ${first.label}, ${Math.round(first.confidence * 100)} percent confidence.`
          : `${critical.length} critical defects detected.`,
      );
    }

    const rest = fresh.filter((a) => a.severity !== "critical");
    if (rest.length > 0) {
      const first = rest[0];
      setPolite(
        rest.length === 1
          ? `${SEVERITY_META[first.severity].label} severity. ${first.label} detected.`
          : `${rest.length} new defects detected.`,
      );
    }
  }, [alerts]);

  return (
    <>
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertive}
      </div>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {polite}
      </div>
    </>
  );
}
