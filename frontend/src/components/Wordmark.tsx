import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The CARRY wordmark, which unfolds into the sentence it stands for.
 *
 * Every initial is already the first letter of its own word, so the mark can
 * *grow* rather than cross-fade: each anchor letter keeps its place at the head
 * of its own word, the rest of that word unrolls from behind it, and only the
 * following words slide right to make room. Cross-fading between two strings
 * would be the obvious implementation and would throw that away -- the whole
 * point is being able to watch C.A.R.R.Y become the thing it abbreviates.
 *
 *   C.        A.       R.           R.           Y
 *   Conveyor  Anomaly  Recognition  Reliability  Yield
 *
 * Three things collapse to zero width in the short form and open up in the
 * long one: the word tails, the inter-word spaces (carried on the tails as a
 * trailing nbsp), and the ampersand. The separator dots do the reverse.
 *
 * Animated with CSS transitions rather than GSAP, unlike its neighbours in
 * components/nav/. This is a two-state toggle whose states React already
 * owns, and an imperative library writing inline styles onto elements React
 * re-renders is a fight with no winner -- the first version of this silently
 * stopped opening at all, because the tween and the render disagreed about who
 * owned `width`. Declaring both states and letting the browser interpolate has
 * no such failure mode.
 */

/**
 * [anchor, tail]. Anchors spell CARRY. A tail carries the space that follows
 * its word, so the gaps appear and disappear with the words themselves --
 * "Recognition" is the exception because the ampersand supplies its spacing.
 *
 * Those gaps are U+00A0 rather than a plain space: a trailing ordinary space is
 * collapsed away at the end of an inline box, which would delete the word gap
 * and leave "ConveyorAnomaly" once the tails are open.
 */
const PARTS: ReadonlyArray<readonly [string, string]> = [
  ["C", "onveyor\u00A0"],
  ["A", "nomaly\u00A0"],
  ["R", "ecognition"],
  ["R", "eliability\u00A0"],
  ["Y", "ield"],
];

/** Where the ampersand sits: before this part's anchor. */
const AMP_BEFORE = 3;

/**
 * Font size of the short form and of the long one.
 *
 * The long form is 48 characters and does not fit beside the nav at display
 * size, so the mark steps down as it opens. Widths are therefore measured at
 * SIZE_LONG -- measuring at the wrong size leaves the open mark clipped.
 */
const SIZE_SHORT = "1.5rem";
const SIZE_LONG = "1rem";

/** Seconds between one word starting to open and the next. */
const STAGGER = 0.045;

interface Widths {
  tails: number[];
  dots: number[];
  amp: number;
}

const NO_WIDTHS: Widths = { tails: [], dots: [], amp: 0 };

export function Wordmark({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(true);
  const [widths, setWidths] = useState<Widths>(NO_WIDTHS);

  const rootRef = useRef<HTMLButtonElement | null>(null);
  const tailRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const dotRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const ampRef = useRef<HTMLSpanElement | null>(null);

  /**
   * Read every element's natural width by letting it size to content briefly.
   *
   * The flip happens inside one synchronous block, so no intermediate state is
   * ever painted -- layout is forced by the read and restored before the frame
   * ends.
   */
  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    const restoreSize = root.style.fontSize;

    const widthOf = (el: HTMLSpanElement | null) => {
      if (!el) return 0;
      const had = el.style.width;
      el.style.width = "auto";
      const w = el.getBoundingClientRect().width;
      el.style.width = had;
      return w;
    };

    root.style.fontSize = SIZE_LONG;
    const tails = tailRefs.current.map(widthOf);
    const amp = widthOf(ampRef.current);

    // Dots are only ever drawn in the short form, so they measure there.
    root.style.fontSize = SIZE_SHORT;
    const dots = dotRefs.current.map(widthOf);

    root.style.fontSize = restoreSize;
    setWidths({ tails, dots, amp });
  }, []);

  useLayoutEffect(() => {
    measure();

    // Re-measure when the window resizes or webfonts settle: a tail measured
    // before EB Garamond loads carries the fallback serif's metrics, and the
    // open mark would be clipped or over-wide for the font actually drawn.
    window.addEventListener("resize", measure);
    let cancelled = false;
    if ("fonts" in document) {
      // `fonts.ready` only covers faces already requested, and EB Garamond is
      // requested by this very element -- so the first measurement can land on
      // the fallback serif, which is wider. The tails then open to a width the
      // real face does not fill and every word gap looks padded. Asking for the
      // face by name waits for the one that matters.
      void document.fonts
        .load(`${SIZE_LONG} "EB Garamond Variable"`)
        .catch(() => undefined)
        .then(() => document.fonts.ready)
        .then(() => {
          if (!cancelled) measure();
        });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // Expansion needs horizontal room the phone header does not have, so below
  // `sm` the mark is a plain label rather than a control that does nothing.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => setCanExpand(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!canExpand) setExpanded(false);
  }, [canExpand]);

  const open = expanded && canExpand;

  /** Opening runs left to right; closing runs right to left, so it furls. */
  const delayFor = (i: number) =>
    `${(open ? i : PARTS.length - 1 - i) * STAGGER}s`;

  const growable = cn(
    "inline-block shrink-0 overflow-hidden whitespace-nowrap",
    "transition-[width,opacity] duration-500 ease-[var(--ease-focus)]",
    "motion-reduce:transition-none",
  );

  return (
    <button
      ref={rootRef}
      type="button"
      disabled={!canExpand}
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={canExpand ? expanded : undefined}
      title={open ? "Collapse" : "Conveyor Anomaly Recognition & Reliability Yield"}
      className={cn(
        // w-max is load-bearing, not tidiness. The button is absolutely
        // positioned inside a 1fr grid column, so without it the shrink-to-fit
        // width is capped by that column and the flex children below compress
        // under their content width -- which is what clipped the open mark.
        "flex w-max items-baseline whitespace-nowrap text-left font-semibold leading-none",
        "tracking-[-0.01em] text-bone",
        "transition-[font-size,color] duration-500 ease-[var(--ease-focus)]",
        "motion-reduce:transition-none",
        "focus-visible:outline focus-visible:outline-1",
        "focus-visible:outline-offset-4 focus-visible:outline-signal",
        canExpand && "hover:text-signal",
        "disabled:cursor-default",
        className,
      )}
      style={{
        fontFamily: "var(--font-brand)",
        fontSize: open ? SIZE_LONG : SIZE_SHORT,
      }}
    >
      {/* The unfolding is decorative motion. A screen reader is given the whole
          name once, up front, and never hears "C dot A dot R dot R dot Y". */}
      <span className="sr-only">
        CARRY — Conveyor Anomaly Recognition and Reliability Yield
      </span>

      <span aria-hidden className="flex shrink-0 items-baseline">
        {PARTS.map(([anchor, tail], i) => (
          <span key={i} className="flex shrink-0 items-baseline">
            {i === AMP_BEFORE && (
              <span
                ref={(el) => {
                  ampRef.current = el;
                }}
                className={growable}
                style={{
                  width: open ? widths.amp : 0,
                  opacity: open ? 1 : 0,
                  transitionDelay: delayFor(AMP_BEFORE - 1),
                }}
              >
                {"\u00A0&\u00A0"}
              </span>
            )}

            <span className="shrink-0">{anchor}</span>

            <span
              ref={(el) => {
                tailRefs.current[i] = el;
              }}
              className={growable}
              style={{
                width: open ? widths.tails[i] ?? 0 : 0,
                opacity: open ? 1 : 0,
                transitionDelay: delayFor(i),
              }}
            >
              {tail}
            </span>

            {/* The dots are shorthand for the words; once the words are there
                the shorthand is noise, so they leave as the tails arrive. */}
            {i < PARTS.length - 1 && (
              <span
                ref={(el) => {
                  dotRefs.current[i] = el;
                }}
                className={cn(
                  "inline-block shrink-0 overflow-hidden",
                  "transition-[width,opacity] duration-300 ease-[var(--ease-focus)]",
                  "motion-reduce:transition-none",
                )}
                style={{
                  width: open ? 0 : widths.dots[i],
                  opacity: open ? 0 : 1,
                  transitionDelay: delayFor(i),
                }}
              >
                .
              </span>
            )}
          </span>
        ))}
      </span>
    </button>
  );
}
