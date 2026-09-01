import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { Link, useRouter } from "@/components/Router";
import { cn } from "@/lib/utils";

export interface PillNavItem {
  to: string;
  label: string;
  /** Shown as a small pulsing dot on the pill, e.g. an open critical alert. */
  alert?: boolean;
}

/**
 * Primary destination switcher for the monitoring surfaces. Adapted from the
 * pasted PillNav reference: same rising-circle hover mechanic, re-themed onto
 * the dashboard's own tokens and wired to the app's hash router instead of
 * react-router (this app deliberately has no routing library -- see
 * Router.tsx). Always visible -- an operator needs every destination one
 * click away during a live shift, so this never collapses behind a menu.
 */
export function PillNav({ items }: { items: PillNavItem[] }) {
  const { path } = useRouter();
  const circleRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const tlRefs = useRef<Array<gsap.core.Timeline | null>>([]);

  useLayoutEffect(() => {
    circleRefs.current.forEach((circle, i) => {
      if (!circle?.parentElement) return;
      const pill = circle.parentElement as HTMLElement;
      const { width: w, height: h } = pill.getBoundingClientRect();
      if (!w || !h) return;

      const R = (w * w / 4 + h * h) / (2 * h);
      const D = Math.ceil(2 * R) + 2;
      const delta = Math.ceil(R - Math.sqrt(Math.max(0, R * R - (w * w) / 4))) + 1;

      circle.style.width = `${D}px`;
      circle.style.height = `${D}px`;
      circle.style.bottom = `-${delta}px`;
      gsap.set(circle, { xPercent: -50, scale: 0, transformOrigin: `50% ${D - delta}px` });

      const label = pill.querySelector<HTMLElement>(".pn-label");
      const hoverLabel = pill.querySelector<HTMLElement>(".pn-label-hover");
      if (label) gsap.set(label, { color: "" });
      if (hoverLabel) gsap.set(hoverLabel, { opacity: 0 });

      tlRefs.current[i]?.kill();
      const tl = gsap.timeline({ paused: true });
      tl.to(circle, { scale: 1.15, duration: 0.5, ease: "power3.out", overwrite: "auto" }, 0);
      if (hoverLabel) tl.to(hoverLabel, { opacity: 1, duration: 0.3, ease: "power2.out" }, 0);
      tlRefs.current[i] = tl;
    });
  }, [items.length]);

  return (
    <nav
      aria-label="Primary"
      className="inline-flex items-center gap-0.5 rounded-full border border-ash/70 bg-panel p-[3px]"
    >
      {items.map((item, i) => {
        const active = path === item.to;
        return (
          <Link key={item.to} to={item.to} className="relative">
            <span
              aria-current={active ? "page" : undefined}
              onMouseEnter={() => tlRefs.current[i]?.play()}
              onMouseLeave={() => tlRefs.current[i]?.reverse()}
              className={cn(
                "relative flex items-center overflow-hidden rounded-full px-5 py-2.5",
                "font-mono text-[0.75rem] uppercase tracking-[0.03em]",
                active ? "text-signal" : "text-fog hover:text-bone",
              )}
            >
              <span
                ref={(el) => {
                  circleRefs.current[i] = el;
                }}
                className="pointer-events-none absolute left-1/2 z-0 rounded-full bg-signal"
                aria-hidden
              />
              <span className="pn-label relative z-10">{item.label}</span>
              <span
                className="pn-label-hover pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-signal-ink"
                aria-hidden
              >
                {item.label}
              </span>
              {item.alert && (
                <span className="animate-alarm absolute right-2 top-2 z-10 h-1.5 w-1.5 rounded-full bg-sev-critical" />
              )}
              {active && (
                <span className="absolute bottom-[5px] left-1/2 z-10 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-signal" />
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
