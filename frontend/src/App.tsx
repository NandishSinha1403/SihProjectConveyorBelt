import { useEffect, useState } from "react";
import {
  Box,
  FileWarning,
  MonitorPlay,
  Settings as SettingsIcon,
  Video,
} from "lucide-react";
import { Link, RouterProvider, useRouter } from "@/components/Router";
import { useEventSocket } from "@/hooks/useEventSocket";
import { useTheme } from "@/hooks/useTheme";
import { LiveMonitor } from "@/pages/LiveMonitor";
import { Sources } from "@/pages/Sources";
import { Incidents } from "@/pages/Incidents";
import { Settings } from "@/pages/Settings";
import { Rig } from "@/pages/Rig";
import { cn } from "@/lib/utils";
import { Announcer } from "@/components/Announcer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAlarm } from "@/hooks/useAlarm";

const NAV = [
  { to: "/", label: "Monitor", icon: MonitorPlay },
  { to: "/incidents", label: "Incidents", icon: FileWarning },
  { to: "/sources", label: "Sources", icon: Video },
  { to: "/rig", label: "3D Model", icon: Box },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const TITLES: Record<string, string> = {
  "/": "Live monitor",
  "/incidents": "Incidents",
  "/sources": "Sources",
  "/rig": "3D Model",
  "/settings": "Settings",
};

function Shell() {
  const { path } = useRouter();
  const socket = useEventSocket();
  const [incidentKey, setIncidentKey] = useState(0);
  const dashboardTheme = useTheme("belt-sentinel-theme", "dark");

  // The dashboard's own light/dark switch, applied to the document root so
  // every Tailwind utility that reads --color-* repaints. The 3D rig keeps a
  // completely separate switch (see Rig.tsx) -- two surfaces, two palettes,
  // never tied together.
  useEffect(() => {
    document.documentElement.dataset.theme = dashboardTheme.theme;
  }, [dashboardTheme.theme]);

  // Announcements and the alarm belong to the session, not to one tab. An
  // operator reviewing incident history must still be told when a new critical
  // defect appears on the belt.
  const alarm = useAlarm(socket.alerts);

  // The incident table is a snapshot; nudge it when a new alert lands so a
  // user sitting on that page sees new rows without reaching for refresh.
  useEffect(() => setIncidentKey((k) => k + 1), [socket.alerts.length]);

  const criticalOpen = socket.alerts.some(
    (a) => a.severity === "critical" && a.closed_at === null,
  );

  // The 3D rig is its own site-within-the-site -- full viewport, its own
  // toolbar, no Belt Sentinel chrome around it. A small link back is the only
  // thing carried over from the dashboard shell.
  if (path === "/rig") {
    return (
      <div className="fixed inset-0">
        <Announcer alerts={socket.alerts} />
        <Rig />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Announcer alerts={socket.alerts} />
      {/* ---- Rail: sidebar on laptop, bottom tab bar on phones ------------
          A horizontally scrolling strip of nav is a desktop pattern wedged
          onto a phone. Thumbs reach the bottom edge, so that is where the
          rail goes. ------------------------------------------------------ */}
      <aside
        className={cn(
          "z-30 shrink-0 border-ash/70 bg-obsidian",
          "fixed inset-x-0 bottom-0 border-t",
          "lg:static lg:w-[188px] lg:border-r lg:border-t-0",
        )}
      >
        <div className="hidden items-baseline gap-2 px-5 py-6 lg:flex">
          <span className="text-[1.375rem] leading-none tracking-[-0.02em] text-bone">
            Belt
          </span>
          <span className="text-[1.375rem] leading-none tracking-[-0.02em] text-fog">
            Sentinel
          </span>
        </div>

        <nav
          aria-label="Primary"
          className={cn(
            "flex items-stretch",
            "lg:flex-col lg:gap-px lg:px-3",
          )}
        >
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = path === to;
            return (
              <Link
                key={to}
                to={to}
                className="min-w-0 flex-1 lg:flex-none"
              >
                <span
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex flex-col items-center gap-1 py-3",
                    "text-[0.6875rem] uppercase tracking-[0.06em]",
                    "transition-colors duration-200 ease-[var(--ease-focus)]",
                    "lg:flex-row lg:gap-3 lg:rounded-[5px] lg:px-3 lg:py-2.5",
                    "lg:text-[0.8125rem] lg:normal-case lg:tracking-[0.01em]",
                    active ? "text-bone" : "text-fog hover:text-bone",
                  )}
                >
                  <Icon size={16} strokeWidth={1.25} />
                  {label}
                  {/* The active marker is a 1px rule, the only structural
                      line the reference allows. */}
                  {active && (
                    <span className="absolute inset-x-4 top-0 h-px bg-bone lg:inset-x-auto lg:-left-3 lg:top-1/2 lg:h-4 lg:w-px lg:-translate-y-1/2" />
                  )}
                  {to === "/incidents" && criticalOpen && (
                    <span className="animate-alarm absolute right-1/2 top-2 h-1 w-1 translate-x-3 rounded-full bg-sev-critical lg:right-3 lg:top-1/2 lg:translate-x-0 lg:-translate-y-1/2" />
                  )}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden items-center justify-between px-5 py-5 lg:flex">
          <ConnectionState connected={socket.connected} />
          <ThemeToggle theme={dashboardTheme.theme} onToggle={dashboardTheme.toggle} />
        </div>
      </aside>

      {/* ---- Main ------------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col pb-[72px] lg:pb-0">
        <header className="flex items-center justify-between gap-4 px-4 pb-4 pt-5 sm:px-6 lg:px-8 lg:pb-6 lg:pt-8">
          <h1 className="truncate text-[2.0625rem] leading-none tracking-[-0.02em] text-bone sm:text-[2.5rem]">
            {TITLES[path] ?? TITLES["/"]}
          </h1>
          <div className="flex items-center gap-3 lg:hidden">
            <ConnectionState connected={socket.connected} compact />
            <ThemeToggle theme={dashboardTheme.theme} onToggle={dashboardTheme.toggle} />
          </div>
        </header>

        <main className="flex-1 px-4 pb-8 sm:px-6 lg:px-8">
          {path === "/" && <LiveMonitor socket={socket} alarm={alarm} />}
          {path === "/incidents" && (
            <Incidents refreshKey={incidentKey} status={socket.status} />
          )}
          {path === "/sources" && <Sources status={socket.status} />}
          {path === "/rig" && <Rig />}
          {path === "/settings" && <Settings />}
        </main>
      </div>
    </div>
  );
}

function ConnectionState({
  connected,
  compact,
}: {
  connected: boolean;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[0.75rem]",
        connected ? "text-fog" : "text-sev-medium",
      )}
      title={connected ? "Event stream connected" : "Reconnecting to the event stream"}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          connected ? "bg-ok" : "animate-alarm bg-sev-medium",
        )}
      />
      {!compact && (connected ? "Connected" : "Reconnecting")}
    </span>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <Shell />
    </RouterProvider>
  );
}
