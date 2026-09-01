import { useCallback, useState } from "react";

export type Theme = "dark" | "light";

function readStored(storageKey: string, fallback: Theme): Theme {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === "dark" || stored === "light" ? stored : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A theme store scoped by `storageKey`. Two independent instances of this
 * hook -- one for the dashboard, one for the 3D rig -- never share state:
 * each persists and toggles on its own, which is the point, since the rig
 * keeps its own visual identity rather than inheriting the dashboard's.
 *
 * State only -- applying `theme` to the DOM (as `data-theme` on whichever
 * element that palette is scoped to) is the caller's job, since the
 * dashboard scopes to the document root and the rig scopes to its own
 * container.
 */
export function useTheme(storageKey: string, defaultTheme: Theme) {
  const [theme, setTheme] = useState<Theme>(() => readStored(storageKey, defaultTheme));

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        /* private browsing or storage disabled -- theme still applies for this load */
      }
      return next;
    });
  }, [storageKey]);

  return { theme, toggle };
}
