import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { RouterProvider, useRouter } from "@/components/Router";
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
import { PillNav, type PillNavItem } from "@/components/nav/PillNav";
import { SettingsPanel } from "@/components/nav/SettingsPanel";

const NAV: PillNavItem[] = [
  { to: "/", label: "Monitor" },
  { to: "/incidents", label: "Incidents" },
  { to: "/sources", label: "Sources" },
  { to: "/rig", label: "3D Model" },
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const navItems = NAV.map((item) =>
    item.to === "/incidents" ? { ...item, alert: criticalOpen } : item,
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <Announcer alerts={socket.alerts} />

      {/* ---- Header: brand, PillNav (always-visible destinations), and
          shell actions. StaggeredMenu-style SettingsPanel is reserved for
          the one destination outside the monitoring loop. --------------- */}
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-ash/70 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-baseline gap-2 overflow-hidden">
          <span
            className="truncate text-[1.5rem] italic leading-none tracking-[-0.01em] text-bone"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Belt Sentinel
          </span>
        </div>

        <div className="hidden justify-self-center sm:block">
          <PillNav items={navItems} />
        </div>

        <div className="flex items-center justify-self-end gap-3">
          <ConnectionState connected={socket.connected} />
          <ThemeToggle theme={dashboardTheme.theme} onToggle={dashboardTheme.toggle} />
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            aria-label="Open settings"
            className="flex h-9 w-9 items-center justify-center rounded-[5px] border border-ash/70 text-fog hover:border-signal-dim hover:text-bone"
          >
            {settingsOpen ? <X size={15} strokeWidth={1.25} /> : <Menu size={15} strokeWidth={1.25} />}
          </button>
        </div>
      </header>

      {/* Compact PillNav row for phones, where the header can't fit it. */}
      <div className="border-b border-ash/70 px-4 py-2 sm:hidden">
        <PillNav items={navItems} />
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* ---- Main ------------------------------------------------------- */}
      <main className="flex-1 px-4 pb-8 pt-6 sm:px-6 lg:px-8">
        <h1
          className="mb-6 text-[1.75rem] italic leading-none tracking-[-0.01em] text-bone sm:text-[2.0625rem]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {TITLES[path] ?? TITLES["/"]}
        </h1>

        {path === "/" && <LiveMonitor socket={socket} alarm={alarm} />}
        {path === "/incidents" && (
          <Incidents refreshKey={incidentKey} status={socket.status} />
        )}
        {path === "/sources" && <Sources status={socket.status} />}
        {path === "/rig" && <Rig />}
        {path === "/settings" && <Settings />}
      </main>
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
