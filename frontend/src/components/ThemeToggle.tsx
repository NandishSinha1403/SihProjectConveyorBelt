import { Moon, Sun } from "lucide-react";
import type { Theme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export function ThemeToggle({
  theme,
  onToggle,
  className,
}: {
  theme: Theme;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px]",
        "text-fog transition-colors duration-200 ease-[var(--ease-focus)] hover:text-bone",
        className,
      )}
    >
      {theme === "dark" ? (
        <Sun size={15} strokeWidth={1.25} />
      ) : (
        <Moon size={15} strokeWidth={1.25} />
      )}
    </button>
  );
}
