import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { Link, useRouter } from "@/components/Router";
import { cn } from "@/lib/utils";

/**
 * The full site index, adapted from the pasted StaggeredMenu reference (same
 * layered slide-in + staggered item reveal), re-themed onto the dashboard's
 * tokens.
 *
 * It used to hold Settings alone, which wasted the surface. PillNav is the
 * always-visible working set -- the destinations an operator needs one click
 * away mid-shift -- and this is the complete list behind it, which also gives
 * phones a comfortable way to reach all six when the pill row is tight.
 */
const DESTINATIONS = [
  { to: "/", label: "Monitor" },
  { to: "/incidents", label: "Incidents" },
  { to: "/analytics", label: "Analytics" },
  { to: "/sources", label: "Sources" },
  { to: "/rig", label: "3D Model" },
  { to: "/settings", label: "Settings" },
] as const;

export function NavPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { path } = useRouter();
  // The closed position has to be *set* on the first pass, not animated to.
  // Animating out from a transform of none means the panel starts on screen
  // and slides away on every page load -- and if that tween is interrupted
  // (a StrictMode double-invoke will do it) the drawer is simply left open.
  const firstRun = useRef(true);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);

  // GSAP owns the transform entirely -- the elements start life at
  // xPercent: 100 via gsap.set (not a Tailwind translate class), so there is
  // never a competing transform declaration for a tween to race against.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!layer || !panel || !scrim) return;

    gsap.killTweensOf([layer, panel, scrim]);
    const items = panel.querySelectorAll(".sp-item");

    if (open) {
      gsap.set(items, { yPercent: 60, opacity: 0 });
      const tl = gsap.timeline();
      tl.set([layer, panel], { xPercent: 100 });
      tl.to(layer, { xPercent: 0, duration: 0.45, ease: "power4.out" }, 0);
      tl.to(panel, { xPercent: 0, duration: 0.55, ease: "power4.out" }, 0.07);
      tl.to(scrim, { opacity: 1, duration: 0.4 }, 0);
      tl.to(items, { yPercent: 0, opacity: 1, duration: 0.5, stagger: 0.05, ease: "power3.out" }, 0.25);
    } else if (firstRun.current) {
      gsap.set([layer, panel], { xPercent: 100 });
      gsap.set(scrim, { opacity: 0 });
    } else {
      gsap.to([layer, panel], { xPercent: 100, duration: 0.35, ease: "power3.in" });
      gsap.to(scrim, { opacity: 0, duration: 0.3 });
    }

    firstRun.current = false;
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        ref={scrimRef}
        onClick={onClose}
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 bg-obsidian/60 opacity-0",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
      />
      <div
        ref={layerRef}
        aria-hidden
        className="pointer-events-none fixed inset-y-0 right-0 z-40 w-[min(400px,92vw)] bg-raised"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="All destinations"
        className={cn(
          "fixed inset-y-0 right-0 z-40 w-[min(400px,92vw)] overflow-y-auto",
          "border-l border-ash/70 bg-panel px-8 pb-8 pt-24",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <p className="mb-5 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-signal-dim">
          Navigate
        </p>

        <nav aria-label="All destinations">
          {DESTINATIONS.map((item, i) => {
            const active = path === item.to;
            return (
              <Link key={item.to} to={item.to} className="sp-item block">
                <span
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block border-b border-ash/50 py-4",
                    "text-[1.75rem] italic leading-none tracking-[-0.01em]",
                    "transition-colors duration-200 ease-[var(--ease-focus)]",
                    active ? "text-signal" : "text-bone hover:text-signal",
                  )}
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  <span
                    className={cn(
                      "mr-3 font-mono text-[0.75rem] not-italic",
                      active ? "text-signal-dim" : "text-fog",
                    )}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Attribution, not navigation -- it sits below the rule, quiet, and is
            the one place the acronym is spelled out without being clicked. */}
        <div className="sp-item mt-10">
          <p
            className="text-[1.0625rem] italic leading-tight text-bone"
            style={{ fontFamily: "var(--font-display)" }}
          >
            C.A.R.R.Y
          </p>
          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fog">
            Conveyor Anomaly Recognition &amp; Reliability Yield
          </p>
          <p className="mt-3 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-fog">
            by Team Unplayed
          </p>
        </div>
      </div>
    </>
  );
}
