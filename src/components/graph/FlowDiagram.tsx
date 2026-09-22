"use client";

import { AlertTriangle, Bot, Check, Cpu, Hand, Split, Wrench } from "lucide-react";
import { useMemo } from "react";
import type { RouterConfig, WfNode, WfNodeKind, WorkflowSpec } from "@/lib/workflows/spec";
import { describeRouter } from "@/lib/workflows/compile";
import { cn } from "@/lib/utils";

export type NodeStatus = "idle" | "running" | "done" | "error" | "interrupted" | "queued";

const W = 168;
const H = 44;
const RW = 150;
const RH = 52;

export const KIND_COLOR: Record<WfNodeKind, string> = {
  start: "var(--n-io)",
  end: "var(--n-io)",
  llm: "var(--n-llm)",
  function: "var(--n-fn)",
  router: "var(--n-router)",
  human: "var(--n-human)",
  tool: "var(--n-tool)",
};

export function KindIcon({ kind, className }: { kind: WfNodeKind; className?: string }) {
  const cls = cn("h-3.5 w-3.5", className);
  switch (kind) {
    case "llm":
      return <Bot className={cls} />;
    case "function":
      return <Cpu className={cls} />;
    case "router":
      return <Split className={cls} />;
    case "human":
      return <Hand className={cls} />;
    case "tool":
      return <Wrench className={cls} />;
    default:
      return null;
  }
}

function size(n: WfNode) {
  if (n.kind === "router") return { w: RW, h: RH };
  if (n.kind === "start" || n.kind === "end") return { w: 96, h: 34 };
  return { w: W, h: H };
}

/** node center, given that spec x,y is the top-left of a 168-wide box (React Flow convention) */
function box(n: WfNode) {
  const s = size(n);
  const cx = n.x + W / 2;
  const cy = n.y + H / 2;
  return { cx, cy, w: s.w, h: s.h, x: cx - s.w / 2, y: cy - s.h / 2 };
}

export function FlowDiagram({
  spec,
  status = {},
  activeEdges = new Set<string>(),
  visitedEdges = new Set<string>(),
  selected,
  onSelect,
  className,
  maxHeight = 560,
  subtitles,
  compact,
}: {
  spec: WorkflowSpec;
  status?: Record<string, NodeStatus>;
  activeEdges?: Set<string>;
  visitedEdges?: Set<string>;
  selected?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  maxHeight?: number;
  subtitles?: Record<string, string>;
  compact?: boolean;
}) {
  const byId = useMemo(() => new Map(spec.nodes.map((n) => [n.id, n])), [spec]);
  const bounds = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    spec.nodes.forEach((n) => {
      const b = box(n);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    });
    const hasBack = spec.edges.some((e) => {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      return s && t && t.y < s.y - 10;
    });
    return { x: minX - 40, y: minY - 24, w: maxX - minX + 80 + (hasBack ? 70 : 0), h: maxY - minY + 60 };
  }, [spec, byId]);

  const edges = spec.edges.map((e) => {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) return null;
    const a = box(s);
    const b = box(t);
    let d: string;
    let lx: number;
    let ly: number;
    if (b.cy < a.cy - 10) {
      // back edge (loop): go around the right side
      const x1 = a.x + a.w;
      const y1 = a.cy;
      const x2 = b.x + b.w;
      const y2 = b.cy;
      const bulge = Math.max(x1, x2) + 60;
      d = `M ${x1} ${y1} C ${bulge} ${y1}, ${bulge} ${y2}, ${x2 + 6} ${y2}`;
      lx = bulge - 18;
      ly = (y1 + y2) / 2;
    } else if (Math.abs(b.cy - a.cy) < 10) {
      const leftToRight = b.cx > a.cx;
      const x1 = leftToRight ? a.x + a.w : a.x;
      const x2 = leftToRight ? b.x - 6 : b.x + b.w + 6;
      d = `M ${x1} ${a.cy} L ${x2} ${b.cy}`;
      lx = (x1 + x2) / 2;
      ly = a.cy - 8;
    } else {
      const x1 = a.cx;
      const y1 = a.y + a.h;
      const x2 = b.cx;
      const y2 = b.y - 6;
      const dy = Math.max(30, (y2 - y1) / 2);
      d = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
      lx = x1 + (x2 - x1) * 0.5;
      ly = y1 + (y2 - y1) * 0.45;
    }
    return { e, d, lx, ly };
  });

  return (
    <div className={cn("w-full overflow-auto rounded-xl border border-line bg-surface", className)} style={{ maxHeight }}>
      <svg
        viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
        className="mx-auto block h-auto w-full"
        style={{ maxWidth: Math.max(360, bounds.w * (compact ? 0.85 : 1.05)), minWidth: compact ? 280 : 320 }}
        role="img"
        aria-label={`Workflow diagram: ${spec.name}`}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--axis)" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
          </marker>
        </defs>
        {edges.map((x) => {
          if (!x) return null;
          const active = activeEdges.has(x.e.id);
          const visited = visitedEdges.has(x.e.id);
          return (
            <g key={x.e.id}>
              <path
                d={x.d}
                fill="none"
                stroke={active || visited ? "var(--accent)" : "var(--axis)"}
                strokeWidth={active ? 2.2 : visited ? 1.8 : 1.4}
                className={active ? "edge-active" : undefined}
                markerEnd={active || visited ? "url(#arrow-active)" : "url(#arrow)"}
                opacity={visited || active ? 1 : 0.9}
              />
              {x.e.branch && (
                <g>
                  <rect x={x.lx - x.e.branch.length * 3.4 - 5} y={x.ly - 9} width={x.e.branch.length * 6.8 + 10} height={17} rx={5} fill="var(--surface)" stroke={visited ? "var(--accent)" : "var(--border)"} />
                  <text x={x.lx} y={x.ly + 3.5} textAnchor="middle" fontSize="10.5" fontFamily="var(--font-mono)" fill={visited ? "var(--accent)" : "var(--ink-2)"}>
                    {x.e.branch}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        {spec.nodes.map((n) => {
          const b = box(n);
          const st = status[n.id] ?? "idle";
          const color = KIND_COLOR[n.kind];
          const isSel = selected === n.id;
          const strokeColor = st === "error" ? "var(--bad)" : st === "running" ? "var(--accent)" : st === "interrupted" ? "var(--n-human)" : isSel ? "var(--accent)" : "var(--border-strong)";
          const clickable = !!onSelect;
          const sub = subtitles?.[n.id];
          return (
            <g
              key={n.id}
              onClick={() => onSelect?.(n.id)}
              style={{ cursor: clickable ? "pointer" : "default" }}
              role={clickable ? "button" : undefined}
              aria-label={`${n.label} (${n.kind}) ${st}`}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={(ev) => {
                if (clickable && (ev.key === "Enter" || ev.key === " ")) onSelect?.(n.id);
              }}
            >
              {n.kind === "router" ? (
                <>
                  <polygon
                    points={`${b.cx},${b.y} ${b.x + b.w},${b.cy} ${b.cx},${b.y + b.h} ${b.x},${b.cy}`}
                    fill={st === "done" ? "var(--warn-soft)" : "var(--surface)"}
                    stroke={st === "done" ? "var(--n-router)" : strokeColor}
                    strokeWidth={isSel || st === "running" ? 2 : 1.3}
                  />
                  <text x={b.cx} y={b.cy + 4} textAnchor="middle" fontSize="11.5" fontWeight={600} fill="var(--ink)">
                    {n.label.length > 20 ? n.label.slice(0, 19) + "…" : n.label}
                  </text>
                </>
              ) : n.kind === "start" || n.kind === "end" ? (
                <>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.h / 2} fill={st === "done" ? "var(--surface-3)" : "var(--surface-2)"} stroke={strokeColor} strokeWidth={1.2} />
                  <text x={b.cx} y={b.cy + 4} textAnchor="middle" fontSize="11" fontWeight={700} letterSpacing="0.06em" fill="var(--ink-2)" fontFamily="var(--font-mono)">
                    {n.kind === "start" ? "START" : "END"}
                  </text>
                </>
              ) : (
                <>
                  {st === "running" && <rect x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} rx={12} fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={4} className="node-running" />}
                  <rect
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                    rx={9}
                    fill={st === "done" ? "var(--surface-2)" : st === "error" ? "var(--bad-soft)" : st === "interrupted" ? "var(--surface-2)" : "var(--surface)"}
                    stroke={strokeColor}
                    strokeWidth={isSel || st === "running" || st === "error" ? 2 : 1.2}
                  />
                  <rect x={b.x} y={b.y + 7} width={3.5} height={b.h - 14} rx={1.75} fill={color} />
                  <text x={b.x + 14} y={sub ? b.cy - 2 : b.cy + 4} fontSize="12" fontWeight={600} fill="var(--ink)">
                    {n.label.length > 21 ? n.label.slice(0, 20) + "…" : n.label}
                  </text>
                  {sub && (
                    <text x={b.x + 14} y={b.cy + 12} fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">
                      {sub.length > 26 ? sub.slice(0, 25) + "…" : sub}
                    </text>
                  )}
                  {st === "done" && (
                    <g transform={`translate(${b.x + b.w - 18}, ${b.cy - 7})`}>
                      <circle cx="7" cy="7" r="7" fill="var(--good)" />
                      <path d="M4 7.2 6.2 9.4 10.2 5" stroke="white" strokeWidth="1.7" fill="none" strokeLinecap="round" />
                    </g>
                  )}
                  {st === "error" && (
                    <g transform={`translate(${b.x + b.w - 18}, ${b.cy - 7})`}>
                      <circle cx="7" cy="7" r="7" fill="var(--bad)" />
                      <path d="M7 3.6v4.4M7 10.2v.4" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
                    </g>
                  )}
                  {st === "interrupted" && (
                    <g transform={`translate(${b.x + b.w - 18}, ${b.cy - 7})`}>
                      <circle cx="7" cy="7" r="7" fill="var(--n-human)" />
                      <path d="M5 4.5v5M9 4.5v5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
                    </g>
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function RouterSummary({ node }: { node: WfNode }) {
  return <code className="font-mono text-xs text-ink-2">{describeRouter(node.config as RouterConfig)}</code>;
}

export function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-n-llm" /> LLM
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-n-fn" /> Function
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rotate-45 bg-n-router" /> Router
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-n-human" /> Human
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-n-tool" /> Tool
      </span>
      <span className="flex items-center gap-1">
        <Check className="h-3 w-3 text-good-ink" /> ran
      </span>
      <span className="flex items-center gap-1">
        <AlertTriangle className="h-3 w-3 text-bad-ink" /> error
      </span>
    </div>
  );
}
