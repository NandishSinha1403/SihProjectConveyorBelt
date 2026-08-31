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

type Overlay = "burned" | "canvas" | "off";

const OVERLAY_LABEL: Record<Overlay, string> = {
  burned: "Boxes drawn by the server",
  canvas: "Boxes drawn by the browser",
  off: "Overlay off",
};

interface Props {
  status: StreamStatus | null;
  detections: DetectionBox[];
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  overlay: Overlay;
  onOverlayChange: (overlay: Overlay) => void;
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
export function VideoPanel({
  status,
  detections,
  paused,
  onPausedChange,
  overlay,
  onOverlayChange,
}: Props) {
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
      ctx.font = '500 11px "Inter Variable", Inter, system-ui, sans-serif';
      const tw = ctx.measureText(text).width + 8;
      // Flip the tag below the box when the defect touches the top edge.
      const ty = py > 16 ? py - 15 : py + ph + 1;

      ctx.fillStyle = color;
      ctx.fillRect(px, ty, tw, 14);
      ctx.fillStyle = "#101010";
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
      className="relative overflow-hidden rounded-[15px] border border-ash/70 bg-pitch"
    >
      {/* Video surface */}
      <div className="relative aspect-video w-full">
        {src && !imgFailed ? (
          <img
            ref={imgRef}
            src={src}
            alt="Live conveyor belt feed"
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {paused ? (
              <p className="text-[0.8125rem] text-fog">
                Display frozen. The pipeline is still running.
              </p>
            ) : (
              <>
                <p className="max-w-[46ch] text-[0.8125rem] leading-relaxed text-fog">
                  The video connection dropped. Detection may still be running —
                  check the throughput figures below.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setImgFailed(false);
                    setEpoch(Date.now());
                  }}
                >
                  Reconnect the feed
                </Button>
              </>
            )}
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
          <div className="prism-edge animate-alarm pointer-events-none absolute inset-0 rounded-[15px]" />
        )}

        {/* Live pill */}
        <div className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5 sm:max-w-[calc(100%-11rem)]">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
              "bg-obsidian/80 text-[0.6875rem] uppercase tracking-[0.06em] backdrop-blur-sm",
              running ? "text-sev-critical" : "text-fog",
            )}
          >
            <Radio size={9} className={running ? "animate-alarm" : undefined} />
            {running ? (status?.is_live ? "Live" : "Streaming") : "Offline"}
          </span>
          {status?.label && (
            <span className="max-w-[45vw] truncate rounded-full bg-obsidian/80 px-2.5 py-1 text-[0.6875rem] text-fog backdrop-blur-sm">
              {status.label}
            </span>
          )}
          {status?.clahe && (
            <span
              className="hidden items-center gap-1 rounded-full bg-obsidian/80 px-2.5 py-1 text-[0.6875rem] uppercase tracking-[0.06em] text-fog backdrop-blur-sm sm:inline-flex"
              title="Contrast enhancement (CLAHE) is active — compensates for dust and low light"
            >
              <Sparkles size={9} /> CLAHE
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1 sm:bottom-auto sm:top-3">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 rounded-[5px] bg-obsidian/80 px-2 backdrop-blur-sm hover:bg-obsidian hover:text-bone"
            onClick={() =>
              onOverlayChange(
                overlay === "burned" ? "canvas" : overlay === "canvas" ? "off" : "burned",
              )
            }
            aria-label={`${OVERLAY_LABEL[overlay]}. Press O or activate to change.`}
          >
            <Layers
              size={14}
              strokeWidth={1.25}
              className={overlay === "off" ? "text-fog" : "text-bone"}
            />
            {/* Naming the current mode beats making the operator click and
                observe to find out which of three states they are in. */}
            <span className="hidden text-[0.6875rem] normal-case tracking-normal sm:inline">
              {overlay === "burned" ? "Server" : overlay === "canvas" ? "Browser" : "Off"}
            </span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="bg-obsidian/80 backdrop-blur-sm hover:bg-obsidian hover:text-bone"
            onClick={() => onPausedChange(!paused)}
            aria-label={paused ? "Resume the feed (Space)" : "Freeze the display (Space)"}
            title={paused ? "Resume feed — Space" : "Freeze display — Space"}
          >
            {paused ? <Play size={15} strokeWidth={1.25} /> : <Pause size={15} strokeWidth={1.25} />}
          </Button>
          <a
            href={api.snapshotUrl(annotate)}
            target="_blank"
            rel="noreferrer"
            title="Open the current frame as an image"
            aria-label="Open the current frame as an image in a new tab"
          >
            <Button
              size="icon"
              variant="ghost"
              className="bg-obsidian/80 backdrop-blur-sm hover:bg-obsidian hover:text-bone"
              disabled={!running}
            >
              <Camera size={15} strokeWidth={1.25} />
            </Button>
          </a>
          <Button
            size="icon"
            variant="ghost"
            className="bg-obsidian/80 backdrop-blur-sm hover:bg-obsidian hover:text-bone"
            onClick={toggleFullscreen}
            aria-label="Toggle fullscreen"
            title="Fullscreen"
          >
            <Expand size={15} strokeWidth={1.25} />
          </Button>
        </div>

        {/* Frozen-frame notice: without this it looks like the pipeline died. */}
        {paused && (
          <div className="absolute bottom-3 left-3 rounded-full bg-obsidian/85 px-3 py-1 text-[0.6875rem] text-bone backdrop-blur-sm sm:left-1/2 sm:-translate-x-1/2">
            Display frozen — the pipeline is still running
          </div>
        )}
      </div>
    </div>
  );
}
