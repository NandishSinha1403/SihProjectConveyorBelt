import { useEffect, useState } from "react";
import { Save } from "lucide-react";
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
          <p className="text-[0.8125rem] text-sev-critical">{error}</p>
        ) : (
          <Spinner />
        )}
      </div>
    );
  }

  return (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
      <Panel>
        <PanelHeader title="Detection tuning" />
        <div className="space-y-7 p-4 sm:p-5">
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

      <div className="space-y-5">
        <Panel>
          <PanelHeader title="Image preprocessing" />
          <div className="p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={draft.enable_clahe ?? settings.enable_clahe}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, enable_clahe: e.target.checked }))
                }
                className="mt-1 h-4 w-4 shrink-0"
              />
              <span>
                <span className="text-[0.9375rem] text-bone">
                  Contrast enhancement (CLAHE)
                </span>
                <span className="mt-1.5 block max-w-[58ch] text-[0.8125rem] leading-relaxed text-fog">
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
          <PanelHeader title="Model" />
          <dl className="space-y-3 p-4 text-[0.9375rem] sm:p-5">
            <Row label="Detector" value={settings.detector} />
            <Row label="Weights" value={settings.model_path} />
            <Row label="Device" value={settings.device} />
            <Row label="Input size" value={`${settings.img_size} px`} />
          </dl>
          <p className="border-t border-ash/70 px-4 py-3.5 text-[0.75rem] leading-relaxed text-fog sm:px-5">
            Model selection requires rebuilding the pipeline, so it stays in{" "}
            <code className="text-bone">backend/.env</code> — this keeps the
            running state from ever disagreeing with what is shown here. Set{" "}
            <code className="text-bone">DETECTOR=yolo</code> and restart once
            trained weights are in place.
          </p>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center gap-4 lg:col-span-2">
        <Button variant="outline" onClick={save} disabled={saving}>
          <Save size={14} strokeWidth={1.25} /> {saving ? "Saving…" : "Save changes"}
        </Button>
        {saved && (
          <span className="text-[0.8125rem] text-ok">Settings applied</span>
        )}
        {error && (
          <span className="text-[0.8125rem] text-sev-critical">{error}</span>
        )}
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
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <label className="text-[0.9375rem] text-bone">{label}</label>
        <span className="tnum text-[0.8125rem] text-bone">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      <p className="mt-2.5 max-w-[62ch] text-[0.75rem] leading-relaxed text-fog">
        {hint}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fog">{label}</dt>
      <dd className="tnum truncate font-mono text-[0.8125rem] text-bone">{value}</dd>
    </div>
  );
}
