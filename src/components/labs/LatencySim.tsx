"use client";

import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Histogram, Legend } from "@/components/charts/Charts";
import { Button, Card, Field, Input, Segmented, Slider, Stat } from "@/components/ui";
import { latencyStats } from "@/lib/eval/metrics";
import { lognormal, mulberry32 } from "@/lib/sim/rng";
import { cn, fmtMs } from "@/lib/utils";

interface Step {
  name: string;
  ttft: number; // median ms
  outTokens: number;
  parallelGroup: boolean; // part of the 4 independent analyses
}

const DEFAULT_STEPS: Step[] = [
  { name: "Redact + clean", ttft: 5, outTokens: 0, parallelGroup: false },
  { name: "Classify intent", ttft: 380, outTokens: 20, parallelGroup: true },
  { name: "Extract product", ttft: 360, outTokens: 20, parallelGroup: true },
  { name: "Sentiment", ttft: 340, outTokens: 18, parallelGroup: true },
  { name: "Extract details", ttft: 420, outTokens: 45, parallelGroup: true },
];

type Arch = "sequential" | "parallel" | "single";

export function simulateLatency(steps: Step[], arch: Arch, tps: number, network: number, sigma: number, runs: number, seed = 1) {
  const rng = mulberry32(seed);
  const call = (s: Step) => (s.outTokens === 0 ? s.ttft : lognormal(rng, s.ttft, sigma) + (s.outTokens / tps) * 1000 + network * (0.7 + rng() * 0.6));
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    const pre = steps.filter((s) => !s.parallelGroup).reduce((a, s) => a + call(s), 0);
    const group = steps.filter((s) => s.parallelGroup);
    let g = 0;
    if (arch === "sequential") g = group.reduce((a, s) => a + call(s), 0);
    else if (arch === "parallel") g = Math.max(...group.map(call));
    else {
      const merged: Step = { name: "single", ttft: Math.max(...group.map((s) => s.ttft)) * 1.15, outTokens: group.reduce((a, s) => a + s.outTokens, 0), parallelGroup: true };
      g = call(merged);
    }
    out.push(pre + g);
  }
  return out;
}

export function LatencySim({ compact }: { compact?: boolean }) {
  const [steps, setSteps] = useState<Step[]>(DEFAULT_STEPS);
  const [arch, setArch] = useState<Arch>("sequential");
  const [tps, setTps] = useState(120);
  const [network, setNetwork] = useState(60);
  const [sigma, setSigma] = useState(0.35);
  const [seed, setSeed] = useState(1);
  const runs = 600;
  const all = useMemo(
    () => ({
      sequential: simulateLatency(steps, "sequential", tps, network, sigma, runs, seed),
      parallel: simulateLatency(steps, "parallel", tps, network, sigma, runs, seed),
      single: simulateLatency(steps, "single", tps, network, sigma, runs, seed),
    }),
    [steps, tps, network, sigma, seed],
  );
  const cur = all[arch];
  const st = latencyStats(cur);
  const W = 640;
  const med = (s: Step) => (s.outTokens === 0 ? s.ttft : s.ttft + (s.outTokens / tps) * 1000 + network);
  // gantt of median timings for the chosen architecture
  const bars: { name: string; start: number; dur: number }[] = [];
  let t = 0;
  steps.filter((s) => !s.parallelGroup).forEach((s) => {
    bars.push({ name: s.name, start: t, dur: med(s) });
    t += med(s);
  });
  const group = steps.filter((s) => s.parallelGroup);
  if (arch === "sequential")
    group.forEach((s) => {
      bars.push({ name: s.name, start: t, dur: med(s) });
      t += med(s);
    });
  else if (arch === "parallel") group.forEach((s) => bars.push({ name: s.name, start: t, dur: med(s) }));
  else bars.push({ name: "Single call (all fields)", start: t, dur: Math.max(...group.map((s) => s.ttft)) * 1.15 + (group.reduce((a, s) => a + s.outTokens, 0) / tps) * 1000 + network });
  const total = Math.max(...bars.map((b) => b.start + b.dur));
  return (
    <Card className="my-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={arch}
          onChange={setArch}
          options={[
            { id: "sequential", label: "Sequential" },
            { id: "parallel", label: "Parallel" },
            { id: "single", label: "Single call" },
          ]}
        />
        <Button size="sm" variant="ghost" onClick={() => setSeed(seed + 1)} icon={<Play className="h-3.5 w-3.5" />}>
          Re-sample {runs} runs
        </Button>
      </div>
      <div className="mt-4">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Timeline of a typical run (medians)</div>
        <svg viewBox={`0 0 ${W} ${bars.length * 26 + 24}`} className="h-auto w-full" role="img" aria-label="latency timeline">
          {bars.map((b, i) => (
            <g key={i}>
              <text x={0} y={i * 26 + 16} fontSize="11" fill="var(--ink-2)">
                {b.name}
              </text>
              <rect x={150 + (b.start / total) * (W - 230)} y={i * 26 + 5} width={Math.max(2, (b.dur / total) * (W - 230))} height={15} rx={4} fill={b.name.includes("Redact") ? "var(--n-fn)" : "var(--n-llm)"} />
              <text x={150 + ((b.start + b.dur) / total) * (W - 230) + 6} y={i * 26 + 16} fontSize="10.5" fill="var(--ink-3)" className="num">
                {fmtMs(b.dur)}
              </text>
            </g>
          ))}
          <text x={150} y={bars.length * 26 + 18} fontSize="11" fontWeight={600} fill="var(--ink)">
            End-to-end ≈ {fmtMs(total)}
          </text>
        </svg>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Distribution over {runs} simulated runs</div>
          <Histogram
            values={cur}
            format={(v) => fmtMs(v)}
            markers={[
              { value: st.p50, label: `P50 ${fmtMs(st.p50)}` },
              { value: st.p95, label: `P95 ${fmtMs(st.p95)}`, color: "var(--bad)" },
            ]}
            xLabel="end-to-end latency"
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="P50 (median)" value={fmtMs(st.p50)} />
            <Stat label="P95" value={fmtMs(st.p95)} tone="warn" />
            <Stat label="P99" value={fmtMs(st.p99)} tone="bad" />
            <Stat label="Mean" value={fmtMs(st.mean)} />
          </div>
          <table className="mt-1 w-full text-xs">
            <thead className="text-ink-3">
              <tr className="border-b border-line">
                <th className="py-1 text-left font-medium">architecture</th>
                <th className="py-1 text-right font-medium">P50</th>
                <th className="py-1 text-right font-medium">P95</th>
              </tr>
            </thead>
            <tbody>
              {(["sequential", "parallel", "single"] as Arch[]).map((a) => {
                const s = latencyStats(all[a]);
                return (
                  <tr key={a} className={cn("border-b border-line/60", a === arch && "bg-accent-soft")}>
                    <td className="py-1.5 text-ink">{a}</td>
                    <td className="num py-1.5 text-right font-mono">{fmtMs(s.p50)}</td>
                    <td className="num py-1.5 text-right font-mono">{fmtMs(s.p95)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {!compact && (
        <div className="mt-5 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Slider label="Generation speed (tokens/sec)" value={tps} onChange={setTps} min={20} max={300} step={10} format={(v) => `${v} tok/s`} />
            <Slider label="Network overhead per call" value={network} onChange={setNetwork} min={0} max={400} step={10} format={(v) => `${v} ms`} />
            <Slider label="Tail heaviness (lognormal σ)" value={sigma} onChange={setSigma} min={0.05} max={0.9} step={0.05} format={(v) => v.toFixed(2)} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Per-step settings (median TTFT, output tokens)</div>
            <div className="flex flex-col gap-1.5">
              {steps.map((s, i) => (
                <div key={s.name} className="grid grid-cols-[1fr_90px_80px] items-center gap-2 text-xs">
                  <span className="truncate text-ink-2">{s.name}</span>
                  <Field label="">
                    <Input
                      type="number"
                      value={s.ttft}
                      onChange={(e) => setSteps(steps.map((x, k) => (k === i ? { ...x, ttft: Math.max(1, Number(e.target.value)) } : x)))}
                      className="h-7 text-xs"
                    />
                  </Field>
                  <Field label="">
                    <Input
                      type="number"
                      value={s.outTokens}
                      onChange={(e) => setSteps(steps.map((x, k) => (k === i ? { ...x, outTokens: Math.max(0, Number(e.target.value)) } : x)))}
                      className="h-7 text-xs"
                    />
                  </Field>
                </div>
              ))}
            </div>
            <div className="mt-2">
              <Legend items={[{ label: "function step", color: "var(--n-fn)" }, { label: "LLM step", color: "var(--n-llm)" }]} />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
