import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { Link } from "@/components/Router";
import { cn } from "@/lib/utils";

/**
 * Secondary panel, adapted from the pasted StaggeredMenu reference (same
 * layered slide-in + staggered item reveal), re-themed onto the dashboard's
 * tokens. Holds only Settings -- the one destination that isn't part of the
 * moment-to-moment monitoring loop, so it doesn't need to sit in the always
 * visible PillNav alongside Monitor/Incidents/Sources/3D Model.
 */
export function SettingsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
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
    } else {
      gsap.to([layer, panel], { xPercent: 100, duration: 0.35, ease: "power3.in" });
      gsap.to(scrim, { opacity: 0, duration: 0.3 });
    }
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
        aria-label="Settings and quick links"
        className={cn(
          "fixed inset-y-0 right-0 z-40 w-[min(400px,92vw)] overflow-y-auto",
          "border-l border-ash/70 bg-panel px-8 pb-8 pt-24",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <p className="mb-5 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-signal-dim">
          System
        </p>
        <Link to="/settings" className="sp-item block">
          <span
            onClick={onClose}
            className={cn(
              "block border-b border-ash/50 py-4",
              "text-[1.75rem] italic leading-none tracking-[-0.01em] text-bone",
              "hover:text-signal",
            )}
            style={{ fontFamily: "var(--font-display)" }}
          >
            <span className="mr-3 font-mono text-[0.75rem] not-italic text-fog">01</span>
            Settings
          </span>
        </Link>
      </div>
    </>
  );
}
