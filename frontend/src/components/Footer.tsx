/**
 * The closing band: an oversized wordmark, a hairline, and labelled columns.
 *
 * The composition is borrowed from a reference whose impact comes from a huge
 * grotesque set edge to edge. The scale and the full-bleed width are what carry
 * that, and both survive a change of typeface -- so the mark here is the same
 * EB Garamond as the header, not a heavy sans. Setting the wordmark in a
 * different face two hundred pixels below the header's would read as two
 * products rather than one.
 *
 * Ground stays `obsidian`, the page floor continuing, with the rule doing the
 * separating. `pitch` is the instinct for "below the floor", but that is a
 * dark-mode intuition: pitch is #ffffff in light mode against an #f7f6f4 page,
 * so the footer would come out lighter than the content above it and the
 * relationship would invert.
 */
export function Footer() {
  return (
    <footer className="mt-16 overflow-hidden border-t border-ash/70 bg-obsidian">
      <div className="px-4 pb-10 pt-12 sm:px-6 lg:px-8">
        {/* Clamped rather than a fixed step: this is the one place type is
            allowed to be fluid, because it is a graphic element sized to the
            viewport, not a heading someone reads at a consistent distance.

            Sized to read as a brand statement, not to span the full width.
            The reference this is adapted from sets a twelve-character
            grotesque edge to edge; "C.A.R.R.Y" is nine glyphs of a serif, so
            filling the same width forces a font size roughly twice as tall and
            the mark stops being a footer and becomes a wall. Measured on the
            real face, it sets 4.14x its own font size wide and 1.3x tall, so
            9vw lands it around a third of the viewport, and the cap keeps it
            civil on a wide monitor. The footer
            clips as a backstop, because a fallback serif is wider than EB
            Garamond and must not be able to give the page a horizontal
            scrollbar. */}
        <p
          className="select-none font-semibold leading-[0.85] tracking-[-0.03em] text-bone"
          style={{
            fontFamily: "var(--font-brand)",
            fontSize: "clamp(1.75rem, 9vw, 7rem)",
          }}
        >
          C.A.R.R.Y
        </p>

        <div className="mt-8 border-t border-ash/70 pt-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.4fr_auto]">
            <Column label="The system">
              <p className="text-[0.8125rem] leading-relaxed text-bone">
                Conveyor Anomaly Recognition &amp; Reliability Yield
              </p>
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fog">
                Vision and sensor monitoring for conveyor belt damage and joint
                rupture.
              </p>
            </Column>

            <Column label="Built by">
              <p className="text-[0.8125rem] leading-relaxed text-bone">
                Team Unplayed
              </p>
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fog">
                Institute of Technical Education and Research,
                <br className="hidden sm:block" /> Siksha &lsquo;O&rsquo;
                Anusandhan University
              </p>
            </Column>

            <div className="lg:text-right">
              <p className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-fog">
                Smart India Hackathon 2026
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * A labelled column. The micro-label is `signal` because it is chrome — it
 * names a region of the page and reports nothing about the belt, which is the
 * line DESIGN.md draws around the accent.
 */
function Column({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-3 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-signal-dim">
        {label}
      </p>
      {children}
    </div>
  );
}
