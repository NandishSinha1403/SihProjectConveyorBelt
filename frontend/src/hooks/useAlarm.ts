import { useCallback, useEffect, useRef, useState } from "react";
import { playAlarm, primeAudio } from "@/lib/chime";
import type { Incident } from "@/lib/types";

const STORAGE_KEY = "belt-sentinel:alarm";

/**
 * Sounds an alarm when a new critical incident opens.
 *
 * Off until the operator switches it on, because browsers will not start audio
 * without a gesture and a silently-failing alarm is worse than an absent one:
 * it looks armed. The preference is remembered, but audio is re-primed on
 * every load since the permission does not survive a reload.
 */
export function useAlarm(alerts: Incident[]) {
  const [enabled, setEnabled] = useState(false);
  const [armed, setArmed] = useState(false);
  const seen = useRef<Set<number>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "on") setEnabled(true);
    } catch {
      /* storage unavailable (private window); alarm simply stays off */
    }
  }, []);

  const toggle = useCallback(async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      /* not fatal */
    }
    if (next) {
      const ok = await primeAudio();
      primed.current = ok;
      setArmed(ok);
      if (ok) playAlarm(); // confirm audibly that it actually works
    } else {
      setArmed(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !primed.current) {
      // Still record what we've seen, so enabling the alarm mid-shift does not
      // replay every incident already on the rail.
      alerts.forEach((a) => seen.current.add(a.id));
      return;
    }
    let fire = false;
    for (const alert of alerts) {
      if (seen.current.has(alert.id)) continue;
      seen.current.add(alert.id);
      if (alert.severity === "critical") fire = true;
    }
    if (fire) playAlarm();
  }, [alerts, enabled]);

  return { enabled, armed, toggle };
}
