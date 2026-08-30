import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  FileVideo,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "@/lib/api";
import type { DeviceInfo, StreamStatus, VideoInfo } from "@/lib/types";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import {
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  Spinner,
} from "@/components/ui/primitives";
import { useRouter } from "@/components/Router";

export function Sources({ status }: { status: StreamStatus | null }) {
  const { navigate } = useRouter();
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [networkUri, setNetworkUri] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadVideos = useCallback(async () => {
    try {
      setVideos(await api.listVideos());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not list videos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  const probeDevices = async () => {
    setProbing(true);
    setError(null);
    try {
      setDevices(await api.listDevices());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Camera probe failed");
    } finally {
      setProbing(false);
    }
  };

  const upload = async (file: File) => {
    setError(null);
    setUploadPct(0);
    try {
      await api.uploadVideo(file, setUploadPct);
      await loadVideos();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadPct(null);
    }
  };

  const start = async (uri: string) => {
    setStarting(uri);
    setError(null);
    try {
      await api.startStream(uri);
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the stream");
    } finally {
      setStarting(null);
    }
  };

  const remove = async (name: string) => {
    try {
      await api.deleteVideo(name);
      await loadVideos();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-sev-critical/40 bg-sev-critical/10 px-3 py-2 text-sm text-sev-critical">
          {error}
        </div>
      )}

      {/* Upload */}
      <Panel>
        <PanelHeader title="Test Footage" icon={<Upload size={13} />} />
        <div className="p-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void upload(file);
            }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors",
              dragging
                ? "border-brand bg-brand/5"
                : "border-line hover:border-ink-faint hover:bg-raised/40",
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,.mkv,.m4v"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
            {uploadPct === null ? (
              <>
                <Upload size={22} className="text-ink-faint" />
                <p className="text-sm font-medium text-ink-dim">
                  Drop belt footage here, or click to browse
                </p>
                <p className="max-w-md text-xs text-ink-faint">
                  MP4, MOV, AVI, MKV or WebM, up to 2 GB. The file is stored on
                  the server and nothing is analysed on upload — playback streams
                  it one frame at a time at its true frame rate, so the model
                  sees it exactly as it would a live camera.
                </p>
              </>
            ) : (
              <div className="w-full max-w-sm">
                <div className="mb-2 flex items-center justify-center gap-2 text-sm text-ink-dim">
                  <Loader2 size={14} className="animate-spin" />
                  Uploading… {uploadPct.toFixed(0)}%
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-brand transition-[width]"
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : videos.length === 0 ? (
            <EmptyState
              icon={<FileVideo size={24} />}
              title="No footage on the server yet"
              hint="Generate a synthetic belt clip with scripts/make_sample_video.py, or upload your own recording."
            />
          ) : (
            <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {videos.map((video) => (
                <li
                  key={video.name}
                  className={cn(
                    "flex gap-3 rounded-lg border p-2.5 transition-colors",
                    status?.uri === video.uri && status.running
                      ? "border-brand/50 bg-brand/5"
                      : "border-line bg-raised/40 hover:border-ink-faint",
                  )}
                >
                  <img
                    src={api.thumbnailUrl(video.name)}
                    alt=""
                    loading="lazy"
                    className="h-16 w-24 shrink-0 rounded border border-line bg-void object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {video.name}
                    </p>
                    <p className="tnum mt-0.5 text-[11px] text-ink-faint">
                      {formatDuration(video.duration)} · {video.width}×
                      {video.height} @ {video.fps} fps ·{" "}
                      {formatBytes(video.size_bytes)}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => start(video.uri)}
                        disabled={starting === video.uri}
                      >
                        {starting === video.uri ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Play size={12} />
                        )}
                        Stream
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Delete"
                        onClick={() => remove(video.name)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {/* Cameras */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Attached Cameras"
            icon={<Camera size={13} />}
            action={
              <Button size="sm" onClick={probeDevices} disabled={probing}>
                {probing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                Scan
              </Button>
            }
          />
          <div className="p-4">
            {devices.length === 0 ? (
              <EmptyState
                icon={<Camera size={22} />}
                title={probing ? "Scanning for cameras…" : "No cameras scanned yet"}
                hint="Scan checks device indices 0–5. A USB or built-in camera streams through the identical pipeline as uploaded footage — no code changes."
              />
            ) : (
              <ul className="space-y-2">
                {devices.map((device) => (
                  <li
                    key={device.index}
                    className="flex items-center justify-between gap-3 rounded-lg border border-line bg-raised/40 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {device.label}
                      </p>
                      <p className="tnum text-[11px] text-ink-faint">
                        {device.width}×{device.height} · {device.uri}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => start(device.uri)}
                      disabled={starting === device.uri}
                    >
                      <Play size={12} /> Stream
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Network Camera" icon={<Globe size={13} />} />
          <div className="space-y-3 p-4">
            <p className="text-xs leading-relaxed text-ink-faint">
              Point the system at an IP or PoE camera mounted over the belt. RTSP
              and MJPEG-over-HTTP are both supported, and credentials are stripped
              from every log line and from this dashboard.
            </p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (networkUri.trim()) void start(networkUri.trim());
              }}
            >
              <input
                value={networkUri}
                onChange={(e) => setNetworkUri(e.target.value)}
                placeholder="rtsp://user:pass@10.0.0.5:554/stream1"
                spellCheck={false}
                className="h-9 min-w-0 flex-1 rounded-md border border-line bg-void px-3 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
              />
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={!networkUri.trim() || starting === networkUri.trim()}
              >
                Connect
              </Button>
            </form>
            <div className="rounded-md border border-line bg-void/60 p-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                Supported source URIs
              </p>
              <ul className="tnum space-y-1 font-mono text-[11px] text-ink-dim">
                <li>file://media/uploads/belt.mp4</li>
                <li>device://0</li>
                <li>rtsp://user:pass@host:554/stream1</li>
                <li>http://host/mjpg/video.mjpg</li>
              </ul>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
