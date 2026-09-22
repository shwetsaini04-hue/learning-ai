"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

/** Container size tracked in state (never read refs during render). */
function useSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 600, h: 260 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];

function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * exp;
}

function Tooltip({ x, y, children, containerW }: { x: number; y: number; children: ReactNode; containerW: number }) {
  const left = Math.min(Math.max(8, x + 12), Math.max(8, containerW - 190));
  return (
    <div className="pointer-events-none absolute z-20 min-w-[120px] max-w-[220px] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg" style={{ left, top: Math.max(0, y - 10) }}>
      {children}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: i.color, opacity: i.dashed ? 0.6 : 1 }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Horizontal bars
export function HBarChart({
  data,
  max,
  format = (v) => String(v),
  color = "var(--s1)",
  height = 22,
  className,
}: {
  data: { label: string; value: number; color?: string; sub?: string; tooltip?: ReactNode }[];
  max?: number;
  format?: (v: number) => string;
  color?: string;
  height?: number;
  className?: string;
}) {
  const m = max ?? Math.max(1e-9, ...data.map((d) => d.value));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {data.map((d, i) => (
        <div key={d.label} className="grid grid-cols-[minmax(90px,30%)_1fr_auto] items-center gap-2 text-xs" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className="truncate text-ink-2" title={d.label}>
            {d.label}
            {d.sub && <span className="ml-1 text-ink-3">{d.sub}</span>}
          </span>
          <div className="relative rounded-sm bg-surface-2" style={{ height: Math.min(height, 20) }}>
            <div
              className="absolute left-0 top-0 h-full rounded-r transition-all duration-500"
              style={{ width: `${Math.max(0, Math.min(1, d.value / m)) * 100}%`, background: d.color ?? color, opacity: hover === null || hover === i ? 1 : 0.55 }}
            />
            {hover === i && d.tooltip && <div className="absolute left-2 top-full z-20 mt-1 rounded-lg border border-line bg-surface px-2 py-1 shadow-lg">{d.tooltip}</div>}
          </div>
          <span className="num w-16 text-right font-mono text-ink">{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Grouped vertical bars
export function GroupedBarChart({
  groups,
  series,
  height = 220,
  format = (v) => v.toFixed(2),
  max,
}: {
  groups: string[];
  series: { label: string; values: number[]; color?: string }[];
  height?: number;
  format?: (v: number) => string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const [hover, setHover] = useState<{ g: number; s: number; x: number; y: number } | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 40, r: 10, t: 12, b: 30 };
  const m = max ?? niceMax(Math.max(1e-9, ...series.flatMap((s) => s.values)));
  const gw = (W - pad.l - pad.r) / groups.length;
  const bw = Math.min(24, (gw * 0.7) / series.length);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / m);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * m);
  return (
    <div ref={ref} className="relative">
      {series.length > 1 && (
        <div className="mb-2">
          <Legend items={series.map((s, i) => ({ label: s.label, color: s.color ?? SERIES[i] }))} />
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="grouped bar chart">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-3)" className="num">
              {format(t)}
            </text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const gx = pad.l + gi * gw + (gw - bw * series.length - 2 * (series.length - 1)) / 2;
          return (
            <g key={g}>
              {series.map((s, si) => {
                const v = s.values[gi] ?? 0;
                const x = gx + si * (bw + 2);
                const top = y(v);
                const h = Math.max(0, y(0) - top);
                const r = Math.min(4, h, bw / 2);
                return (
                  <path
                    key={si}
                    d={`M ${x} ${y(0)} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} L ${x + bw - r} ${top} Q ${x + bw} ${top} ${x + bw} ${top + r} L ${x + bw} ${y(0)} Z`}
                    fill={s.color ?? SERIES[si]}
                    opacity={hover && (hover.g !== gi || hover.s !== si) ? 0.55 : 1}
                    onMouseEnter={(e) => {
                      const rect = ref.current?.getBoundingClientRect();
                      setHover({ g: gi, s: si, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
                    }}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
              <text x={pad.l + gi * gw + gw / 2} y={H - 10} textAnchor="middle" fontSize="10.5" fill="var(--ink-2)">
                {g.length > 16 ? g.slice(0, 15) + "…" : g}
              </text>
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth={1} />
      </svg>
      {hover && (
        <Tooltip x={hover.x} y={hover.y} containerW={size.w}>
          <div className="font-medium text-ink">{groups[hover.g]}</div>
          <div className="flex items-center gap-1.5 text-ink-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: series[hover.s].color ?? SERIES[hover.s] }} />
            {series[hover.s].label}: <span className="num font-mono text-ink">{format(series[hover.s].values[hover.g])}</span>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Histogram
export function Histogram({
  values,
  bins = 24,
  height = 180,
  format = (v) => String(Math.round(v)),
  markers = [],
  color = "var(--s1)",
  xLabel,
}: {
  values: number[];
  bins?: number;
  height?: number;
  format?: (v: number) => string;
  markers?: { value: number; label: string; color?: string }[];
  color?: string;
  xLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 34, r: 12, t: 18, b: 30 };
  const { counts, min, max } = useMemo(() => {
    if (!values.length) return { counts: [] as number[], min: 0, max: 1 };
    const mn = Math.min(...values);
    const mx = Math.max(...values);
    const span = mx - mn || 1;
    const c = new Array(bins).fill(0);
    values.forEach((v) => c[Math.min(bins - 1, Math.floor(((v - mn) / span) * bins))]++);
    return { counts: c, min: mn, max: mx };
  }, [values, bins]);
  const cMax = niceMax(Math.max(1, ...counts));
  const bw = (W - pad.l - pad.r) / bins;
  const x = (v: number) => pad.l + ((v - min) / (max - min || 1)) * (W - pad.l - pad.r);
  const y = (c: number) => pad.t + (H - pad.t - pad.b) * (1 - c / cMax);
  return (
    <div ref={ref} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="histogram">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(f * cMax)} y2={y(f * cMax)} stroke="var(--grid)" />
            <text x={pad.l - 6} y={y(f * cMax) + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-3)">
              {Math.round(f * cMax)}
            </text>
          </g>
        ))}
        {counts.map((c, i) => {
          const top = y(c);
          const h = y(0) - top;
          const bx = pad.l + i * bw + 1;
          const w = Math.max(1, bw - 2);
          const r = Math.min(3, h, w / 2);
          return (
            <path
              key={i}
              d={h > 0 ? `M ${bx} ${y(0)} L ${bx} ${top + r} Q ${bx} ${top} ${bx + r} ${top} L ${bx + w - r} ${top} Q ${bx + w} ${top} ${bx + w} ${top + r} L ${bx + w} ${y(0)} Z` : ""}
              fill={color}
              opacity={hover && hover.i !== i ? 0.55 : 0.9}
              onMouseEnter={(e) => {
                const rect = ref.current?.getBoundingClientRect();
                setHover({ i, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
              }}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--axis)" />
        {[min, (min + max) / 2, max].map((v, i) => (
          <text key={i} x={x(v)} y={H - 12} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize="10" fill="var(--ink-3)">
            {format(v)}
          </text>
        ))}
        {xLabel && (
          <text x={W / 2} y={H - 1} textAnchor="middle" fontSize="10" fill="var(--ink-3)">
            {xLabel}
          </text>
        )}
        {markers.map((m) => (
          <g key={m.label}>
            <line x1={x(m.value)} x2={x(m.value)} y1={pad.t - 6} y2={y(0)} stroke={m.color ?? "var(--ink)"} strokeWidth={1.5} strokeDasharray="0" />
            <text x={Math.min(W - 40, x(m.value) + 4)} y={pad.t - 6} fontSize="10.5" fontWeight={600} fill="var(--ink)">
              {m.label}
            </text>
          </g>
        ))}
      </svg>
      {hover && (
        <Tooltip x={hover.x} y={hover.y} containerW={size.w}>
          <div className="text-ink-2">
            {format(min + ((max - min) / bins) * hover.i)} – {format(min + ((max - min) / bins) * (hover.i + 1))}
          </div>
          <div className="num font-mono font-semibold text-ink">{counts[hover.i]} requests</div>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Line chart
export function LineChart({
  series,
  xs,
  height = 220,
  formatX = (v) => String(v),
  formatY = (v) => String(v),
  yMax,
  yMin = 0,
  xLabel,
}: {
  series: { label: string; values: number[]; color?: string }[];
  xs: number[];
  height?: number;
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  yMax?: number;
  yMin?: number;
  xLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const [hi, setHi] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 52, r: 16, t: 14, b: 32 };
  const all = series.flatMap((s) => s.values);
  const mx = yMax ?? niceMax(Math.max(1e-9, ...all));
  const x = (i: number) => pad.l + (xs.length <= 1 ? 0 : (i / (xs.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - yMin) / (mx - yMin || 1));
  return (
    <div ref={ref} className="relative">
      {series.length > 1 && (
        <div className="mb-2">
          <Legend items={series.map((s, i) => ({ label: s.label, color: s.color ?? SERIES[i] }))} />
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="line chart"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (xs.length - 1));
          setHi(Math.max(0, Math.min(xs.length - 1, i)));
        }}
        onMouseLeave={() => setHi(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = yMin + f * (mx - yMin);
          return (
            <g key={f}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
              <text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-3)">
                {formatY(v)}
              </text>
            </g>
          );
        })}
        {xs.map((v, i) =>
          i % Math.max(1, Math.ceil(xs.length / 7)) === 0 || i === xs.length - 1 ? (
            <text key={i} x={x(i)} y={H - 14} textAnchor="middle" fontSize="10" fill="var(--ink-3)">
              {formatX(v)}
            </text>
          ) : null,
        )}
        {xLabel && (
          <text x={(W + pad.l) / 2} y={H - 1} textAnchor="middle" fontSize="10" fill="var(--ink-3)">
            {xLabel}
          </text>
        )}
        {series.map((s, si) => (
          <path
            key={s.label}
            d={s.values.map((v, i) => `${i ? "L" : "M"} ${x(i)} ${y(v)}`).join(" ")}
            fill="none"
            stroke={s.color ?? SERIES[si]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {hi !== null && (
          <>
            <line x1={x(hi)} x2={x(hi)} y1={pad.t} y2={H - pad.b} stroke="var(--axis)" />
            {series.map((s, si) => (
              <circle key={si} cx={x(hi)} cy={y(s.values[hi])} r={4} fill={s.color ?? SERIES[si]} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </>
        )}
      </svg>
      {hi !== null && (
        <Tooltip x={((x(hi) / W) * (size.w))} y={20} containerW={size.w}>
          <div className="mb-0.5 font-medium text-ink">{formatX(xs[hi])}</div>
          {series.map((s, si) => (
            <div key={si} className="flex items-center gap-1.5 text-ink-2">
              <span className="h-2 w-2 rounded-sm" style={{ background: s.color ?? SERIES[si] }} />
              {s.label}: <span className="num font-mono text-ink">{formatY(s.values[hi])}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Scatter
export function ScatterPlot({
  points,
  xLabel,
  yLabel,
  formatX = (v) => String(v),
  formatY = (v) => String(v),
  height = 260,
  xMin,
  xMax,
  yMin,
  yMax,
  regions,
}: {
  points: { x: number; y: number; label: string; color?: string; size?: number; detail?: ReactNode }[];
  xLabel: string;
  yLabel: string;
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  height?: number;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  regions?: { x0: number; x1: number; y0: number; y1: number; label?: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const [hi, setHi] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 56, r: 20, t: 16, b: 38 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = xMin ?? Math.min(...xs) * 0.9;
  const x1 = xMax ?? Math.max(...xs) * 1.1 + 1e-9;
  const y0 = yMin ?? Math.min(...ys) * 0.95;
  const y1 = yMax ?? Math.max(...ys) * 1.05 + 1e-9;
  const x = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  return (
    <div ref={ref} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="scatter plot">
        {regions?.map((r, i) => (
          <g key={i}>
            <rect x={x(r.x0)} y={y(r.y1)} width={Math.max(0, x(r.x1) - x(r.x0))} height={Math.max(0, y(r.y0) - y(r.y1))} fill="var(--good-soft)" />
            {r.label && (
              <text x={x(r.x0) + 6} y={y(r.y1) + 14} fontSize="10.5" fill="var(--good-ink)">
                {r.label}
              </text>
            )}
          </g>
        ))}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(y0 + f * (y1 - y0))} y2={y(y0 + f * (y1 - y0))} stroke="var(--grid)" />
            <text x={pad.l - 6} y={y(y0 + f * (y1 - y0)) + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-3)">
              {formatY(y0 + f * (y1 - y0))}
            </text>
            <text x={x(x0 + f * (x1 - x0))} y={H - 20} textAnchor="middle" fontSize="10" fill="var(--ink-3)">
              {formatX(x0 + f * (x1 - x0))}
            </text>
          </g>
        ))}
        <text x={(W + pad.l) / 2} y={H - 4} textAnchor="middle" fontSize="10.5" fill="var(--ink-2)">
          {xLabel}
        </text>
        <text x={12} y={H / 2} textAnchor="middle" fontSize="10.5" fill="var(--ink-2)" transform={`rotate(-90 12 ${H / 2})`}>
          {yLabel}
        </text>
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
            <circle cx={x(p.x)} cy={y(p.y)} r={(p.size ?? 6) + 6} fill="transparent" />
            <circle cx={x(p.x)} cy={y(p.y)} r={p.size ?? 6} fill={p.color ?? SERIES[i % SERIES.length]} stroke="var(--surface)" strokeWidth={2} opacity={hi === null || hi === i ? 1 : 0.5} />
            <text x={x(p.x) + (p.size ?? 6) + 5} y={y(p.y) + 4} fontSize="10.5" fill="var(--ink-2)">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
      {hi !== null && (
        <Tooltip x={(x(points[hi].x) / W) * (size.w)} y={(y(points[hi].y) / H) * (size.h)} containerW={size.w}>
          <div className="font-medium text-ink">{points[hi].label}</div>
          <div className="text-ink-2">
            {xLabel}: <span className="font-mono text-ink">{formatX(points[hi].x)}</span>
          </div>
          <div className="text-ink-2">
            {yLabel}: <span className="font-mono text-ink">{formatY(points[hi].y)}</span>
          </div>
          {points[hi].detail}
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Confusion matrix
export function ConfusionMatrix({
  labels,
  predictedLabels,
  matrix,
  onCell,
  selected,
}: {
  labels: string[];
  predictedLabels?: string[];
  matrix: number[][];
  onCell?: (actual: number, predicted: number) => void;
  selected?: { a: number; p: number } | null;
}) {
  const cols = predictedLabels ?? labels;
  const rowTotals = matrix.map((r) => r.reduce((a, b) => a + b, 0));
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="p-1" />
            <th colSpan={cols.length} className="pb-1 text-center text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
              predicted →
            </th>
          </tr>
          <tr>
            <th className="p-1 text-left text-[10.5px] font-medium uppercase tracking-wide text-ink-3">actual ↓</th>
            {cols.map((c) => (
              <th key={c} className="min-w-[78px] p-1 text-center font-mono text-[11px] font-medium text-ink-2">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((r, ri) => (
            <tr key={r}>
              <td className="pr-2 font-mono text-[11px] font-medium text-ink-2">{r}</td>
              {cols.map((c, ci) => {
                const v = matrix[ri]?.[ci] ?? 0;
                const share = rowTotals[ri] ? v / rowTotals[ri] : 0;
                const diag = r === c;
                const sel = selected && selected.a === ri && selected.p === ci;
                return (
                  <td key={c} className="p-0.5">
                    <button
                      onClick={() => onCell?.(ri, ci)}
                      className={cn("flex h-12 w-full min-w-[78px] flex-col items-center justify-center rounded-md border transition-colors", sel ? "border-ink" : "border-transparent")}
                      style={{
                        background: v === 0 ? "var(--surface-2)" : diag ? `color-mix(in srgb, var(--s1) ${Math.round(15 + share * 70)}%, var(--surface))` : `color-mix(in srgb, var(--s8) ${Math.round(12 + share * 70)}%, var(--surface))`,
                      }}
                      title={`actual ${r}, predicted ${c}: ${v}`}
                    >
                      <span className={cn("num font-mono text-sm font-semibold", share > 0.55 ? "text-white" : "text-ink")}>{v}</span>
                      <span className={cn("text-[10px]", share > 0.55 ? "text-white/80" : "text-ink-3")}>{rowTotals[ri] ? `${Math.round(share * 100)}%` : ""}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex gap-3 text-[11px] text-ink-3">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "color-mix(in srgb, var(--s1) 60%, var(--surface))" }} />
          correct (diagonal)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "color-mix(in srgb, var(--s8) 60%, var(--surface))" }} />
          errors
        </span>
        <span>% = share of the actual class (row)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Sparkline
export function Sparkline({ values, color = "var(--s1)", height = 36, highlightLast = true }: { values: number[]; color?: string; height?: number; highlightLast?: boolean }) {
  const W = 160;
  const H = height;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (W - 6) + 3;
  const y = (v: number) => 3 + (H - 6) * (1 - (v - mn) / (mx - mn || 1));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={values.map((v, i) => `${i ? "L" : "M"} ${x(i)} ${y(v)}`).join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {highlightLast && values.length > 0 && <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={3.5} fill={color} stroke="var(--surface)" strokeWidth={2} />}
    </svg>
  );
}
