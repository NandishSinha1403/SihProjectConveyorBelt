import { BarChart3 } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/primitives";

const CLASS_ORDER = [
  "joint_damage",
  "tear",
  "hole",
  "crack",
  "scratch",
  "belt_joint",
];

const CLASS_LABELS: Record<string, string> = {
  joint_damage: "Joint Damage",
  tear: "Tear",
  hole: "Hole / Puncture",
  crack: "Crack",
  scratch: "Scratch",
  belt_joint: "Belt Joint",
};

/**
 * Per-class counts for the current session.
 *
 * Ordered by consequence, not alphabetically or by frequency: joint damage and
 * tears sit at the top because those are the ones that stop a plant.
 */
export function DefectCounters({ counts }: { counts: Record<string, number> }) {
  const max = Math.max(1, ...Object.values(counts));
  const present = CLASS_ORDER.filter((c) => (counts[c] ?? 0) > 0);
  const rows = present.length > 0 ? present : CLASS_ORDER.slice(0, 4);

  return (
    <Panel>
      <PanelHeader title="Session Detections" icon={<BarChart3 size={13} />} />
      <ul className="space-y-2.5 px-4 py-3.5">
        {rows.map((cls) => {
          const count = counts[cls] ?? 0;
          return (
            <li key={cls}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-xs text-ink-dim">
                  {CLASS_LABELS[cls] ?? cls}
                </span>
                <span className="tnum text-sm font-semibold text-ink">
                  {count}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-line-soft">
                <div
                  className="h-full rounded-full bg-brand/70 transition-[width] duration-500"
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
