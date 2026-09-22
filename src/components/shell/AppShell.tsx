"use client";

import {
  BookA,
  Bug,
  ChartColumn,
  Coins,
  Database,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Moon,
  Scale,
  Settings,
  Sun,
  Timer,
  Trophy,
  Workflow,
  X,
  Gauge,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { computeLabProgress, computeTrackProgress } from "@/lib/progress-calc";
import { hydrateAll, useHydrated } from "@/lib/store/hydration";
import { useProgress } from "@/lib/store/progress";
import { useSettings } from "@/lib/store/settings";
import { cn, fmtUsd } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  progress?: "langgraph" | "evaluation" | "lab";
}

const NAV: { title?: string; items: NavItem[] }[] = [
  { items: [{ href: "/", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> }] },
  {
    title: "Learn",
    items: [
      { href: "/learn/langgraph", label: "LangGraph & Workflows", icon: <GitBranch className="h-4 w-4" />, progress: "langgraph" },
      { href: "/learn/evaluation", label: "LLM Evaluation", icon: <Scale className="h-4 w-4" />, progress: "evaluation" },
    ],
  },
  {
    title: "Build",
    items: [
      { href: "/lab/playground", label: "Workflow Playground", icon: <Workflow className="h-4 w-4" /> },
      { href: "/lab/transcripts", label: "Transcript Lab", icon: <MessageSquareText className="h-4 w-4" />, progress: "lab" },
      { href: "/lab/debug", label: "Debugging Lab", icon: <Bug className="h-4 w-4" /> },
    ],
  },
  {
    title: "Evaluate",
    items: [
      { href: "/lab/eval", label: "Eval Playground", icon: <FlaskConical className="h-4 w-4" /> },
      { href: "/lab/datasets", label: "Datasets", icon: <Database className="h-4 w-4" /> },
      { href: "/lab/experiments", label: "Experiments", icon: <ChartColumn className="h-4 w-4" /> },
      { href: "/lab/models", label: "Model Comparison", icon: <Gauge className="h-4 w-4" /> },
      { href: "/lab/cost", label: "Cost Lab", icon: <Coins className="h-4 w-4" /> },
      { href: "/lab/latency", label: "Latency Lab", icon: <Timer className="h-4 w-4" /> },
    ],
  },
  {
    title: "Prove it",
    items: [
      { href: "/capstone", label: "Capstone", icon: <Trophy className="h-4 w-4" /> },
      { href: "/glossary", label: "Glossary", icon: <BookA className="h-4 w-4" /> },
    ],
  },
];

// The theme lives on <html class="dark"> (set before paint by the inline script in layout.tsx).
function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}

function useTheme() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "dark",
  );
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("ael-theme", next);
    } catch {}
  };
  return { theme, toggle };
}

function MiniRing({ pct }: { pct: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0" aria-label={`${Math.round(pct * 100)}% complete`}>
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="2.5" />
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round" transform="rotate(-90 9 9)" />
    </svg>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const progress = useProgress();
  const hydrated = useHydrated((s) => s.hydrated);
  const pctFor = (p: NavItem["progress"]) => {
    if (!hydrated || !p) return null;
    if (p === "lab") return computeLabProgress(progress).pct;
    return computeTrackProgress(progress, p).pct;
  };
  return (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto px-3 pb-6 pt-4">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="6" cy="6" r="2.2" />
            <circle cx="18" cy="12" r="2.2" />
            <circle cx="6" cy="18" r="2.2" />
            <path d="M8 6.8 16 11M8 17.2 16 13" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">AI Engineering Lab</div>
          <div className="text-[11px] text-ink-3">LLM workflows · evaluation</div>
        </div>
      </Link>
      {NAV.map((group, gi) => (
        <div key={gi}>
          {group.title && <div className="mb-1.5 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">{group.title}</div>}
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const pct = pctFor(item.progress);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors",
                    active ? "bg-accent-soft font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  <span className={cn(active ? "text-accent" : "text-ink-3")}>{item.icon}</span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {pct !== null && <MiniRing pct={pct} />}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      <div className="mt-auto">
        <Link
          href="/settings"
          onClick={onNavigate}
          className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm", pathname.startsWith("/settings") ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-surface-2")}
        >
          <Settings className="h-4 w-4 text-ink-3" />
          Settings & data
        </Link>
      </div>
    </nav>
  );
}

function ModeBadge() {
  const mode = useSettings((s) => s.mode);
  const spend = useSettings((s) => s.liveSpendUsd);
  const hydrated = useHydrated((s) => s.hydrated);
  if (!hydrated) return <span className="h-6 w-24" />;
  return (
    <Link
      href="/settings"
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        mode === "live" ? "border-transparent bg-warn-soft text-warn-ink" : "border-line bg-surface-2 text-ink-2",
      )}
      title={mode === "live" ? "Live mode: real API calls cost money" : "Simulation mode: free, deterministic, no API key"}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", mode === "live" ? "bg-warn" : "bg-good")} />
      {mode === "live" ? `Live · ${fmtUsd(spend, { precise: spend < 1 })}` : "Simulation mode"}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const pathname = usePathname();
  useEffect(() => {
    hydrateAll();
  }, []);
  const fullBleed = pathname.startsWith("/lab/playground");

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="fade-in absolute left-0 top-0 h-full w-72 border-r border-line bg-surface" onClick={(e) => e.stopPropagation()}>
            <button className="absolute right-3 top-4 rounded-md p-1 text-ink-3 hover:bg-surface-2" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-4 w-4" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] px-4 backdrop-blur">
          <button className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="text-sm font-medium text-ink lg:hidden">AI Engineering Lab</div>
          <div className="flex-1" />
          <ModeBadge />
          <button onClick={toggle} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Toggle theme" title="Toggle light/dark">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>
        <main className={cn("flex-1", fullBleed ? "" : "mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8")}>{children}</main>
      </div>
    </div>
  );
}
