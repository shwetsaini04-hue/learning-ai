"use client";

import { ArrowRight, Bug, CheckCircle2, Circle, Search } from "lucide-react";
import Link from "next/link";
import { FlowDiagram } from "@/components/graph/FlowDiagram";
import { Badge, Card, PageHeader, ProgressBar } from "@/components/ui";
import { DEBUG_CHALLENGES } from "@/content/debugChallenges";
import { useHydrated } from "@/lib/store/hydration";
import { useProgress } from "@/lib/store/progress";

export function DebugLab() {
  const hydrated = useHydrated((s) => s.hydrated);
  const ch = useProgress((s) => s.challenges);
  const fixed = hydrated ? DEBUG_CHALLENGES.filter((c) => ch[c.id]?.fixed).length : 0;
  return (
    <div>
      <PageHeader
        eyebrow="Debugging Lab"
        title="Eight broken workflows. Find the bug from the trace."
        right={
          <div className="w-52">
            <div className="mb-1 flex justify-between text-xs text-ink-3">
              <span>Fixed</span>
              <span className="font-semibold text-ink">
                {fixed}/{DEBUG_CHALLENGES.length}
              </span>
            </div>
            <ProgressBar value={fixed / DEBUG_CHALLENGES.length} tone="good" />
          </div>
        }
      >
        Each challenge opens in the Playground with a real failure. Reproduce it, read the trace (input → prompt → raw output → parsed → state), diagnose the root cause, fix the graph, and
        verify automatically. Half of these fail loudly; the other half fail <strong>silently</strong> — the kind you only catch with good habits.
      </PageHeader>
      <Card className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm text-ink-2">
        <span className="flex items-center gap-2 font-semibold text-ink">
          <Search className="h-4 w-4 text-accent" /> Method
        </span>
        {["Reproduce (same input, T=0)", "Locate the failing node", "Compare prompt → raw → parsed", "Check state before/after", "Fix one thing", "Verify + regression"].map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-strong">{i + 1}</span>
            {s}
          </span>
        ))}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {DEBUG_CHALLENGES.map((c, i) => {
          const rec = hydrated ? ch[c.id] : undefined;
          return (
            <Link key={c.id} href={`/lab/playground?challenge=${c.id}`} className="group">
              <Card className="flex h-full flex-col overflow-hidden transition-colors group-hover:border-line-strong">
                <div className="flex items-start justify-between gap-2 px-4 pt-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-ink-3">
                      <Bug className="h-3.5 w-3.5" /> #{i + 1} · {c.category}
                    </div>
                    <div className="mt-1 text-base font-semibold text-ink">{c.title}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge>{"●".repeat(c.difficulty)}{"○".repeat(3 - c.difficulty)}</Badge>
                    {rec?.fixed ? (
                      <Badge tone="good">
                        <CheckCircle2 className="h-3 w-3" /> fixed
                      </Badge>
                    ) : rec?.diagnosed ? (
                      <Badge tone="warn">diagnosed</Badge>
                    ) : (
                      <Badge>
                        <Circle className="h-3 w-3" /> open
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="px-4 pt-2 text-sm text-ink-2">{c.symptom}</p>
                <div className="mt-3 flex-1 px-4">
                  <FlowDiagram spec={c.spec} maxHeight={200} compact className="pointer-events-none" />
                </div>
                <div className="mt-3 flex items-center justify-end gap-1 border-t border-line px-4 py-2 text-sm font-medium text-accent">
                  Debug it <ArrowRight className="h-4 w-4" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
