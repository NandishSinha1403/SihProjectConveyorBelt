import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Expand,
  Layers,
  Pause,
  Play,
  Radio,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { SEVERITY_META } from "@/lib/severity";
import type { DetectionBox, StreamStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";

interface Props {
  status: StreamStatus | null;
  detections: DetectionBox[];
}

/**
 * The live video panel.
 *
 * Two overlay modes:
 *  - "burned"  the backend draws boxes onto the MJPEG frames. What you see is
 *              exactly what the model saw, which is the honest default.
 *  - "canvas"  the backend serves clean frames and the browser draws boxes from
 *              the WebSocket events. Crisper, and lets the operator toggle the
 *              overlay off to inspect the belt surface itself.
 */
export function VideoPanel({ status, detections }: Props) {
  const [overlay, setOverlay] = useState<"burned" | "canvas" | "off">("burned");
  const [paused, setPaused] = useState(false);
  const [epoch, setEpoch] = useState(() => Date.now());
  const [imgFailed, setImgFailed] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const running = Boolean(status?.running);
  const annotate = overlay === "burned";

  // Remount the <img> when the stream restarts or the overlay mode changes.
  // An MJPEG connection is long-lived, so changing the query string is the only
  // way to make the browser open a new one.
  useEffect(() => {
    setEpoch(Date.now());
    setImgFailed(false);
  }, [annotate, status?.uri, running]);

  const src = useMemo(
    () => (paused ? undefined : api.mjpegUrl(annotate, epoch)),
    [annotate, epoch, paused],
  );

  // Client-side overlay rendering.
  useEffect(() => {
    if (overlay !== "canvas") return;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const width = img.clientWidth;
    const height = img.clientHeight;
    if (!width || !height) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    for (const det of detections) {
      const [x1, y1, x2, y2] = det.box;
      const color = SEVERITY_META[det.severity].hex;
      const px = x1 * width;
      const py = y1 * height;
      const pw = (x2 - x1) * width;
      const ph = (y2 - y1) * height;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, pw, ph);

      const text = `${det.label} ${det.confidence.toFixed(2)}`;
      ctx.font = "600 11px ui-monospace, SF Mono, Menlo, monospace";
      const tw = ctx.measureText(text).width + 8;
      // Flip the tag below the box when the defect touches the top edge.
      const ty = py > 16 ? py - 15 : py + ph + 1;

      ctx.fillStyle = color;
      ctx.fillRect(px, ty, tw, 14);
      ctx.fillStyle = "#0b0e14";
      ctx.fillText(text, px + 4, ty + 10.5);
    }
  }, [detections, overlay]);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const criticalLive = detections.some((d) => d.severity === "critical");

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-lg border border-line bg-void"
    >
      {/* Video surface */}
      <div className="relative aspect-video w-full grid-lines">
        {src && !imgFailed ? (
          <img
            ref={imgRef}
            src={src}
            alt="Live conveyor belt feed"
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-ink-faint">
              {paused ? "Feed paused" : "Stream unavailable"}
            </p>
          </div>
        )}

        {overlay === "canvas" && (
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
        )}

        {/* A critical defect currently in frame gets a hairline border, not a
            full-screen flash: unmissable without being punishing over a shift. */}
        {criticalLive && running && (
          <div className="animate-alarm pointer-events-none absolute inset-0 rounded-lg border-2 border-sev-critical/70" />
        )}

        {/* Live pill */}
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-1",
              "text-[10px] font-bold uppercase tracking-[0.14em] backdrop-blur-md",
              running
                ? "border-sev-critical/50 bg-sev-critical/15 text-sev-critical"
                : "border-line bg-void/70 text-ink-faint",
            )}
          >
            <Radio size={10} className={running ? "animate-alarm" : undefined} />
            {running ? (status?.is_live ? "Live" : "Streaming") : "Offline"}
          </span>
          {status?.label && (
            <span className="max-w-[40vw] truncate rounded-full border border-line bg-void/70 px-2 py-1 text-[10px] text-ink-dim backdrop-blur-md">
              {status.label}
            </span>
          )}
          {status?.clahe && (
            <span
              className="hidden items-center gap-1 rounded-full border border-line bg-void/70 px-2 py-1 text-[10px] text-ink-faint backdrop-blur-md sm:inline-flex"
              title="Contrast enhancement (CLAHE) is active — compensates for dust and low light"
            >
              <Sparkles size={10} /> CLAHE
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            className="bg-void/70 backdrop-blur-md hover:bg-void"
            onClick={() =>
              setOverlay((o) =>
                o === "burned" ? "canvas" : o === "canvas" ? "off" : "burned",
              )
            }
            title={`Overlay: ${overlay} — click to cycle (server-drawn → browser-drawn → off)`}
          >
            <Layers
              size={15}
              className={overlay === "off" ? "text-ink-faint" : "text-brand"}
            />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="bg-void/70 backdrop-blur-md hover:bg-void"
            onClick={() => setPaused((p) => !p)}
            title={paused ? "Resume feed" : "Freeze feed"}
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </Button>
          <a
            href={api.snapshotUrl(annotate)}
            target="_blank"
            rel="noreferrer"
            title="Open current frame as an image"
          >
            <Button
              size="icon"
              variant="ghost"
              className="bg-void/70 backdrop-blur-md hover:bg-void"
              disabled={!running}
            >
              <Camera size={15} />
            </Button>
          </a>
          <Button
            size="icon"
            variant="ghost"
            className="bg-void/70 backdrop-blur-md hover:bg-void"
            onClick={toggleFullscreen}
            title="Fullscreen"
          >
            <Expand size={15} />
          </Button>
        </div>

        {/* Frozen-frame notice: without this it looks like the pipeline died. */}
        {paused && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-brand/40 bg-void/85 px-3 py-1 text-[11px] text-brand backdrop-blur-md">
            Display frozen — the pipeline is still running
          </div>
        )}
      </div>
    </div>
  );
}
