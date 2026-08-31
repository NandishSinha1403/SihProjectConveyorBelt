import { useEffect } from "react";

export interface Hotkey {
  /** Single character, or a KeyboardEvent.key value such as "Escape". */
  key: string;
  label: string;
  description: string;
  run: () => void;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
  );
}

/**
 * Global single-key shortcuts.
 *
 * An operator watches this surface for a whole shift; reaching for a 36px icon
 * to freeze a frame is the wrong cost. Single keys with no modifier are right
 * here precisely because there is no text entry on the monitoring screen — and
 * the handler stands down whenever focus is in a field, so the Sources and
 * Settings forms still behave normally.
 */
export function useHotkeys(hotkeys: Hotkey[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const hit = hotkeys.find(
        (h) => h.key.toLowerCase() === e.key.toLowerCase(),
      );
      if (!hit) return;

      e.preventDefault();
      hit.run();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys, enabled]);
}
