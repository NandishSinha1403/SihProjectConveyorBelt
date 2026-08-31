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
      <PanelHeader title="Detections this session" />
      <ul className="space-y-3 px-4 py-4">
        {rows.map((cls) => {
          const count = counts[cls] ?? 0;
          return (
            <li key={cls}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-[0.8125rem] text-fog">
                  {CLASS_LABELS[cls] ?? cls}
                </span>
                <span className="tnum text-[0.9375rem] text-bone">{count}</span>
              </div>
              <div className="h-px w-full bg-ash">
                {/* scaleX rather than width: width animates layout every frame,
                    transform is composited. */}
                <div
                  className="h-px origin-left bg-bone transition-transform duration-500 ease-[var(--ease-focus)]"
                  style={{ transform: `scaleX(${max > 0 ? count / max : 0})` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
