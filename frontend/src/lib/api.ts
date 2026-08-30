import type {
  DeviceInfo,
  Incident,
  IncidentSummary,
  RuntimeSettings,
  StreamStatus,
  VideoInfo,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers:
      init?.body instanceof FormData
        ? init?.headers
        : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    // FastAPI puts the human-readable reason in `detail`; surface it verbatim so
    // the UI can show "Could not connect to stream" rather than "HTTP 400".
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* response had no JSON body */
    }
    throw new Error(detail);
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  health: () => request<Record<string, unknown>>("/api/health"),

  // Sources
  listVideos: () => request<VideoInfo[]>("/api/sources/videos"),
  listDevices: () => request<DeviceInfo[]>("/api/sources/devices"),
  deleteVideo: (name: string) =>
    request<void>(`/api/sources/videos/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  thumbnailUrl: (name: string) =>
    `/api/sources/thumbnail/${encodeURIComponent(name)}`,

  /**
   * Upload with progress. Uses XHR rather than fetch because fetch still has no
   * upload-progress event, and belt footage runs to hundreds of megabytes.
   */
  uploadVideo(
    file: File,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<VideoInfo> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/sources/upload");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.((e.loaded / e.total) * 100);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as VideoInfo);
        } else {
          let detail = `Upload failed (${xhr.status})`;
          try {
            detail = JSON.parse(xhr.responseText).detail ?? detail;
          } catch {
            /* no JSON body */
          }
          reject(new Error(detail));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.onabort = () => reject(new Error("Upload cancelled"));
      signal?.addEventListener("abort", () => xhr.abort());

      xhr.send(form);
    });
  },

  // Stream
  streamStatus: () => request<StreamStatus>("/api/stream/status"),
  startStream: (uri: string) =>
    request<StreamStatus>("/api/stream/start", {
      method: "POST",
      body: JSON.stringify({ uri }),
    }),
  stopStream: () => request<StreamStatus>("/api/stream/stop", { method: "POST" }),
  mjpegUrl: (annotate: boolean, cacheBuster: number) =>
    `/api/stream/mjpeg?annotate=${annotate ? 1 : 0}&t=${cacheBuster}`,
  snapshotUrl: (annotate: boolean) =>
    `/api/stream/snapshot?annotate=${annotate ? 1 : 0}`,

  // Incidents
  listIncidents: (params: {
    limit?: number;
    offset?: number;
    severity?: string;
    cls?: string;
  }) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") q.set(k, String(v));
    });
    return request<{
      items: Incident[];
      total: number;
      limit: number;
      offset: number;
    }>(`/api/incidents?${q}`);
  },
  incidentSummary: () => request<IncidentSummary>("/api/incidents/summary"),
  incidentSnapshotUrl: (id: number) => `/api/incidents/${id}/snapshot`,
  exportCsvUrl: (severity?: string, cls?: string) => {
    const q = new URLSearchParams();
    if (severity) q.set("severity", severity);
    if (cls) q.set("cls", cls);
    return `/api/incidents/export.csv?${q}`;
  },

  // Settings
  getSettings: () => request<RuntimeSettings>("/api/settings"),
  updateSettings: (patch: Partial<RuntimeSettings>) =>
    request<RuntimeSettings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};
