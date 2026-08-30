import { useEffect, useState } from "react";
import {
  Activity,
  FileWarning,
  MonitorPlay,
  Settings as SettingsIcon,
  Video,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Link, RouterProvider, useRouter } from "@/components/Router";
import { useEventSocket } from "@/hooks/useEventSocket";
import { LiveMonitor } from "@/pages/LiveMonitor";
import { Sources } from "@/pages/Sources";
import { Incidents } from "@/pages/Incidents";
import { Settings } from "@/pages/Settings";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Live Monitor", icon: MonitorPlay },
  { to: "/incidents", label: "Incidents", icon: FileWarning },
  { to: "/sources", label: "Sources", icon: Video },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/": {
    title: "Live Monitor",
    subtitle: "Real-time belt surface and joint inspection",
  },
  "/incidents": {
    title: "Incidents",
    subtitle: "Confirmed defect history and evidence",
  },
  "/sources": {
    title: "Sources",
    subtitle: "Test footage and camera inputs",
  },
  "/settings": {
    title: "Settings",
    subtitle: "Detection tuning and model configuration",
  },
};

function Shell() {
  const { path } = useRouter();
  const socket = useEventSocket();
  const [incidentKey, setIncidentKey] = useState(0);

  // The incident table is a snapshot; nudge it whenever a new alert lands so a
  // user sitting on that page sees new rows without reaching for refresh.
  useEffect(() => setIncidentKey((k) => k + 1), [socket.alerts.length]);

  const page = TITLES[path] ?? TITLES["/"];
  const criticalOpen = socket.alerts.some(
    (a) => a.severity === "critical" && a.closed_at === null,
  );

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Sidebar / top bar */}
      <aside className="flex shrink-0 flex-col border-line bg-surface/60 lg:w-56 lg:border-r">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5 lg:py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand">
            <Activity size={17} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight text-ink">
              Belt Sentinel
            </p>
            <p className="truncate text-[10px] leading-tight text-ink-faint">
              Conveyor Health Monitor
            </p>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-line p-2 lg:flex-col lg:overflow-visible lg:border-b-0">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = path === to;
            return (
              <Link key={to} to={to} className="shrink-0 lg:w-full">
                <span
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-brand/12 font-medium text-brand"
                      : "text-ink-dim hover:bg-raised hover:text-ink",
                  )}
                >
                  <Icon size={15} />
                  {label}
                  {to === "/incidents" && criticalOpen && (
                    <span className="animate-alarm ml-auto h-1.5 w-1.5 rounded-full bg-sev-critical" />
                  )}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Connection state. A dead socket must be obvious, not silent. */}
        <div className="mt-auto hidden border-t border-line px-4 py-3 lg:block">
          <div
            className={cn(
              "flex items-center gap-2 text-[11px]",
              socket.connected ? "text-ok" : "text-sev-medium",
            )}
          >
            {socket.connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {socket.connected ? "Event stream connected" : "Reconnecting…"}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 lg:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-ink">
              {page.title}
            </h1>
            <p className="truncate text-xs text-ink-faint">{page.subtitle}</p>
          </div>
          <div
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-[11px] lg:hidden",
              socket.connected ? "text-ok" : "text-sev-medium",
            )}
          >
            {socket.connected ? <Wifi size={12} /> : <WifiOff size={12} />}
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">
          {path === "/" && <LiveMonitor socket={socket} />}
          {path === "/incidents" && <Incidents refreshKey={incidentKey} />}
          {path === "/sources" && <Sources status={socket.status} />}
          {path === "/settings" && <Settings />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <Shell />
    </RouterProvider>
  );
}
