import { cn } from "@/lib/utils";
import type { ReactNode, ButtonHTMLAttributes, HTMLAttributes } from "react";
import { SEVERITY_META } from "@/lib/severity";
import type { Severity } from "@/lib/types";

/* -- Panel ---------------------------------------------------------------- */

export function Panel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface/80 backdrop-blur-sm",
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
  icon,
  action,
  className,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-line px-4 py-2.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="text-ink-faint shrink-0">{icon}</span>}
        <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

/* -- Button --------------------------------------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "icon";
};

export function Button({
  className,
  variant = "outline",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-md font-medium",
        "transition-colors disabled:pointer-events-none disabled:opacity-40",
        size === "sm" && "h-7 px-2.5 text-xs",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "icon" && "h-8 w-8",
        variant === "primary" &&
          "bg-brand text-void hover:bg-brand/90 font-semibold",
        variant === "outline" &&
          "border border-line bg-raised text-ink hover:border-ink-faint hover:bg-raised/70",
        variant === "ghost" && "text-ink-dim hover:bg-raised hover:text-ink",
        variant === "danger" &&
          "bg-sev-critical/15 text-sev-critical border border-sev-critical/40 hover:bg-sev-critical/25",
        className,
      )}
      {...props}
    />
  );
}

/* -- Severity badge ------------------------------------------------------- */

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
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5",
        "text-[10px] font-semibold uppercase tracking-wider",
        meta.bg,
        meta.border,
        meta.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
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
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </div>
      <div
        className={cn(
          "tnum truncate text-lg leading-tight font-semibold",
          tone === "default" && "text-ink",
          tone === "good" && "text-ok",
          tone === "warn" && "text-sev-medium",
          tone === "bad" && "text-sev-critical",
        )}
      >
        {value}
        {unit && (
          <span className="ml-0.5 text-xs font-normal text-ink-faint">{unit}</span>
        )}
      </div>
    </div>
  );
}

/* -- Empty state ---------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-ink-faint/60">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-ink-dim">{title}</p>
        {hint && <p className="mt-1 max-w-sm text-xs text-ink-faint">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/* -- Spinner -------------------------------------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full",
        "border-2 border-line border-t-brand",
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}
