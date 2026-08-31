import { cn } from "@/lib/utils";
import type { ReactNode, ButtonHTMLAttributes, HTMLAttributes } from "react";
import { SEVERITY_META } from "@/lib/severity";
import type { Severity } from "@/lib/types";

/* -- Panel ----------------------------------------------------------------
   Flat by design. Depth is the surface step plus a hairline — never a shadow.
-------------------------------------------------------------------------- */

export function Panel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[15px] border border-ash/70 bg-panel",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-ash/70 px-4 py-3",
        className,
      )}
    >
      <h2 className="truncate text-[0.8125rem] tracking-[0.02em] text-bone">
        {title}
      </h2>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* -- Button ---------------------------------------------------------------
   Square edges, transparent fills. The reference has no filled action colour,
   so emphasis is carried by the border alone: outlined is the strong form,
   ghost the quiet one.
-------------------------------------------------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
};

export function Button({
  className,
  variant = "ghost",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center gap-2",
        "rounded-none uppercase tracking-[0.02em]",
        "transition-[color,border-color,background-color] duration-200 ease-[var(--ease-focus)]",
        "disabled:pointer-events-none disabled:opacity-35",
        size === "sm" && "h-8 px-3 text-[0.75rem]",
        size === "md" && "h-10 px-4 text-[0.8125rem]",
        size === "icon" && "h-9 w-9 rounded-[5px]",
        variant === "outline" &&
          "border border-bone text-bone hover:bg-bone hover:text-obsidian",
        variant === "ghost" &&
          "text-fog hover:text-bone",
        variant === "danger" &&
          "border border-sev-critical/70 text-sev-critical hover:bg-sev-critical hover:text-obsidian",
        className,
      )}
      {...props}
    />
  );
}

/* -- Severity badge -------------------------------------------------------
   The prism, applied as taxonomy. Colour only ever appears here and on the
   detections it describes.
-------------------------------------------------------------------------- */

export function SeverityBadge({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  const meta = SEVERITY_META[severity];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border",
        "px-2 py-[3px] text-[0.6875rem] uppercase tracking-[0.06em]",
        className,
      )}
      style={{
        color: meta.hex,
        borderColor: `${meta.hex}55`,
        backgroundColor: `${meta.hex}12`,
      }}
    >
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ backgroundColor: meta.hex }}
      />
      {meta.label}
    </span>
  );
}

/* -- Stat ----------------------------------------------------------------- */

export function Stat({
  label,
  value,
  unit,
  tone = "default",
  hint,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "default" | "good" | "warn" | "bad";
  hint?: string;
}) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="text-[0.6875rem] uppercase tracking-[0.08em] text-fog">
        {label}
      </div>
      <div
        className={cn(
          "tnum mt-1 truncate text-[1.375rem] leading-none",
          tone === "default" && "text-bone",
          tone === "good" && "text-ok",
          tone === "warn" && "text-sev-medium",
          tone === "bad" && "text-sev-critical",
        )}
      >
        {value}
        {unit && (
          <span className="ml-1 text-[0.75rem] tracking-normal text-fog">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

/* -- Empty state ---------------------------------------------------------
   Teaches the interface rather than announcing absence.
-------------------------------------------------------------------------- */

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 px-5 py-10">
      <p className="max-w-[38ch] text-[1.0625rem] leading-tight text-bone">
        {title}
      </p>
      {hint && (
        <p className="max-w-[52ch] text-[0.8125rem] leading-relaxed text-fog">
          {hint}
        </p>
      )}
      {action}
    </div>
  );
}

/* -- Skeleton -------------------------------------------------------------
   Loading is shaped like the content that replaces it, not a spinner.
-------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-[5px] bg-raised", className)}
      aria-hidden
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full",
        "border border-ash border-t-bone",
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}
