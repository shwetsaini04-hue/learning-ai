"use client";

import { cn } from "@/lib/utils";

function fmt(v: unknown, max = 160): string {
  if (typeof v === "string") {
    const s = v.length > max ? v.slice(0, max) + "…" : v;
    return JSON.stringify(s);
  }
  const j = JSON.stringify(v);
  if (j === undefined) return "undefined";
  return j.length > max ? j.slice(0, max) + "…" : j;
}

/**
 * Renders a flat state object key-by-key and highlights what changed
 * relative to `before`. This is the "state is information moving through
 * the graph" view.
 */
export function StateDiffView({
  state,
  before,
  className,
  hideKeys = [],
  maxValue = 160,
  showUnchanged = true,
}: {
  state: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  className?: string;
  hideKeys?: string[];
  maxValue?: number;
  showUnchanged?: boolean;
}) {
  const keys = Object.keys(state).filter((k) => !hideKeys.includes(k));
  return (
    <div className={cn("rounded-lg border border-line bg-code px-3 py-2 font-mono text-[12px] leading-6", className)}>
      <div className="text-ink-3">{"{"}</div>
      {keys.map((k) => {
        const changed = before !== undefined && before !== null && JSON.stringify(before[k]) !== JSON.stringify(state[k]);
        const isNull = state[k] === null || state[k] === undefined || (Array.isArray(state[k]) && (state[k] as unknown[]).length === 0);
        if (!showUnchanged && !changed) return null;
        return (
          <div key={k} className={cn("-mx-1 flex gap-1 rounded px-1 pl-4", changed && "flash bg-good-soft")}>
            <span className="shrink-0 text-[color:var(--s1)]">&quot;{k}&quot;</span>
            <span className="text-ink-3">:</span>
            <span className={cn("min-w-0 break-all", isNull ? "text-ink-3" : "text-ink")}>{fmt(state[k], maxValue)}</span>
            {changed && <span className="ml-auto shrink-0 pl-2 font-sans text-[10px] font-semibold uppercase text-good-ink">updated</span>}
          </div>
        );
      })}
      <div className="text-ink-3">{"}"}</div>
    </div>
  );
}

export function JsonBlock({ value, className, maxHeight }: { value: unknown; className?: string; maxHeight?: number }) {
  return (
    <pre className={cn("overflow-auto rounded-lg border border-line bg-code px-3 py-2 font-mono text-[12px] leading-5 text-ink", className)} style={{ maxHeight }}>
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
