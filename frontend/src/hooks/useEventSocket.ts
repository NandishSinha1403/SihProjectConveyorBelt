import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type {
  DetectionBox,
  FrameEvent,
  Incident,
  StreamStatus,
  WsMessage,
} from "@/lib/types";

const MAX_ALERTS = 60;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export interface EventSocketState {
  connected: boolean;
  status: StreamStatus | null;
  detections: DetectionBox[];
  frame: FrameEvent | null;
  alerts: Incident[];
  clearAlerts: () => void;
}

/**
 * Subscribes to /ws/events and keeps live pipeline state.
 *
 * Reconnects with exponential backoff, because the backend restarting during
 * development (or a network blip on site) must not require a page reload.
 */
export function useEventSocket(): EventSocketState {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [frame, setFrame] = useState<FrameEvent | null>(null);
  const [detections, setDetections] = useState<DetectionBox[]>([]);
  const [alerts, setAlerts] = useState<Incident[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const closedRef = useRef(false);

  const clearAlerts = useCallback(() => setAlerts([]), []);

  // Seed the rail from recent history so a page reload mid-shift does not
  // present an empty alert feed while defects are actively on the belt.
  useEffect(() => {
    let cancelled = false;
    api
      .listIncidents({ limit: 25 })
      .then((res) => {
        if (cancelled) return;
        setAlerts((live) => {
          const ids = new Set(live.map((a) => a.id));
          return [...live, ...res.items.filter((i) => !ids.has(i.id))].slice(
            0,
            MAX_ALERTS,
          );
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    closedRef.current = false;

    const connect = () => {
      if (closedRef.current) return;

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/events`);
      socketRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setConnected(true);
      };

      ws.onmessage = (event) => {
        let message: WsMessage;
        try {
          message = JSON.parse(event.data) as WsMessage;
        } catch {
          return;
        }

        switch (message.type) {
          case "stream.status":
            setStatus(message.data);
            if (!message.data.running) setDetections([]);
            break;
          case "frame":
            setFrame(message.data);
            setDetections(message.data.detections);
            setStatus(message.data.stats);
            break;
          case "incident.opened":
            // Newest first, capped: an operator reads the top of the rail, and
            // an unbounded list would leak memory over a long shift.
            // Guarded against duplicate ids, which arise whenever the same
            // incident reaches us twice -- React's StrictMode double-mounting
            // the socket in development, or a reconnect replaying an event.
            setAlerts((prev) =>
              prev.some((a) => a.id === message.data.id)
                ? prev
                : [message.data, ...prev].slice(0, MAX_ALERTS),
            );
            break;
          case "incident.updated":
            setAlerts((prev) =>
              prev.map((a) => (a.id === message.data.id ? message.data : a)),
            );
            break;
          case "incident.closed":
            setAlerts((prev) =>
              prev.map((a) =>
                a.id === message.data.id ? { ...a, ...message.data } : a,
              ),
            );
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        socketRef.current = null;
        if (closedRef.current) return;

        const delay = Math.min(
          RECONNECT_MAX_MS,
          RECONNECT_BASE_MS * 2 ** attemptRef.current,
        );
        attemptRef.current += 1;
        timerRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      closedRef.current = true;
      window.clearTimeout(timerRef.current);
      socketRef.current?.close();
    };
  }, []);

  return { connected, status, detections, frame, alerts, clearAlerts };
}
