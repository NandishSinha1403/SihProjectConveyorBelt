import { useEffect, useState } from "react";
import { Cpu, Save, SlidersHorizontal, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import type { RuntimeSettings } from "@/lib/types";
import {
  Button,
  Panel,
  PanelHeader,
  Spinner,
} from "@/components/ui/primitives";

export function Settings() {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [draft, setDraft] = useState<Partial<RuntimeSettings>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setDraft(s);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.updateSettings({
        enable_clahe: draft.enable_clahe,
        conf_threshold: draft.conf_threshold,
        iou_threshold: draft.iou_threshold,
        max_stream_fps: draft.max_stream_fps,
        confirm_frames: draft.confirm_frames,
      });
      setSettings(next);
      setDraft(next);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <div className="flex justify-center py-20">
        {error ? (
          <p className="text-sm text-sev-critical">{error}</p>
        ) : (
          <Spinner />
        )}
      </div>
    );
  }

  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
      <Panel>
        <PanelHeader title="Detection Tuning" icon={<SlidersHorizontal size={13} />} />
        <div className="space-y-5 p-4">
          <Slider
            label="Confidence threshold"
            hint="Lower catches more faint defects at the cost of false positives. The paper's benchmark uses 0.50; 0.35 suits early-stage wear."
            min={0.05}
            max={0.95}
            step={0.05}
            value={draft.conf_threshold ?? settings.conf_threshold}
            onChange={(v) => setDraft((d) => ({ ...d, conf_threshold: v }))}
            format={(v) => v.toFixed(2)}
          />
          <Slider
            label="IoU threshold"
            hint="Overlap above which two boxes are merged as one defect."
            min={0.1}
            max={0.9}
            step={0.05}
            value={draft.iou_threshold ?? settings.iou_threshold}
            onChange={(v) => setDraft((d) => ({ ...d, iou_threshold: v }))}
            format={(v) => v.toFixed(2)}
          />
          <Slider
            label="Confirmation frames"
            hint="Consecutive frames a defect must persist before it raises an incident. Higher suppresses flicker; lower reacts faster."
            min={1}
            max={30}
            step={1}
            value={draft.confirm_frames ?? settings.confirm_frames}
            onChange={(v) => setDraft((d) => ({ ...d, confirm_frames: v }))}
            format={(v) => `${v} frames`}
          />
          <Slider
            label="Stream frame rate cap"
            hint="Upper bound on MJPEG output. Lower it on a constrained network; it does not affect how many frames the model analyses."
            min={5}
            max={60}
            step={1}
            value={draft.max_stream_fps ?? settings.max_stream_fps}
            onChange={(v) => setDraft((d) => ({ ...d, max_stream_fps: v }))}
            format={(v) => `${v} fps`}
          />
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel>
          <PanelHeader title="Image Preprocessing" icon={<Sparkles size={13} />} />
          <div className="p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={draft.enable_clahe ?? settings.enable_clahe}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, enable_clahe: e.target.checked }))
                }
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
              />
              <span>
                <span className="text-sm font-medium text-ink">
                  Contrast enhancement (CLAHE)
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-ink-faint">
                  Restores local contrast on belt texture before inference.
                  Guo et al. identify dust and uneven underground lighting as the
                  dominant cause of missed detections; this is the standard
                  mitigation. Costs roughly 2–4 ms per frame.
                </span>
              </span>
            </label>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Model" icon={<Cpu size={13} />} />
          <dl className="space-y-2.5 p-4 text-sm">
            <Row label="Detector" value={settings.detector} />
            <Row label="Weights" value={settings.model_path} />
            <Row label="Device" value={settings.device} />
            <Row label="Input size" value={`${settings.img_size} px`} />
          </dl>
          <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ink-faint">
            Model selection requires rebuilding the pipeline, so it stays in{" "}
            <code className="text-ink-dim">backend/.env</code> — this keeps the
            running state from ever disagreeing with what is shown here. Set{" "}
            <code className="text-ink-dim">DETECTOR=yolo</code> and restart once
            trained weights are in place.
          </p>
        </Panel>
      </div>

      <div className="flex items-center gap-3 lg:col-span-2">
        <Button variant="primary" onClick={save} disabled={saving}>
          <Save size={14} /> {saving ? "Saving…" : "Save changes"}
        </Button>
        {saved && <span className="text-xs text-ok">Settings applied</span>}
        {error && <span className="text-xs text-sev-critical">{error}</span>}
      </div>
    </div>
  );
}

function Slider({
  label,
  hint,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium text-ink">{label}</label>
        <span className="tnum text-xs text-brand">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-brand)]"
      />
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{hint}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-dim">{label}</dt>
      <dd className="tnum truncate font-mono text-xs text-ink">{value}</dd>
    </div>
  );
}
