"use client";

import { Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ScatterPlot, SERIES } from "@/components/charts/Charts";
import { Badge, Callout, Card, CardHeader, Field, PageHeader, Segmented, Slider, Stat } from "@/components/ui";
import { SIMULATED_MODELS } from "@/config/models";
import { INTENTS } from "@/lib/domain";
import { classificationReport, latencyStats } from "@/lib/eval/metrics";
import { getBenchmark } from "@/lib/sim/transcripts";
import { cn, fmtMs, fmtPct, fmtUsd, mean } from "@/lib/utils";
import { simClassify, type SimPrediction } from "@/lessons/widgets/simData";

interface Row {
  id: string;
  label: string;
  acc: number;
  f1: number;
  invalid: number;
  p50: number;
  p95: number;
  inTok: number;
  outTok: number;
  costPer1k: number;
  consistency: number;
  color: string;
}

function summarize(id: string, label: string, preds: SimPrediction[], color: string, consistency: number): Row {
  const rep = classificationReport(preds.map((p) => ({ expected: p.gold, predicted: p.pred })), [...INTENTS]);
  const lat = latencyStats(preds.map((p) => p.latencyMs));
  return {
    id,
    label,
    acc: rep.accuracy,
    f1: rep.macroF1,
    invalid: rep.invalid / preds.length,
    p50: lat.p50,
    p95: lat.p95,
    inTok: 0,
    outTok: 0,
    costPer1k: mean(preds.map((p) => p.costUsd)) * 1000,
    consistency,
    color,
  };
}

export function ModelComparison() {
  const [version, setVersion] = useState("v3");
  const [minAcc, setMinAcc] = useState(0.9);
  const [maxP95, setMaxP95] = useState(3000);
  const [maxCost, setMaxCost] = useState(1.0);
  const [cascadeT, setCascadeT] = useState(0.8);
  const bench = useMemo(() => getBenchmark(), []);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const preds: Record<string, SimPrediction[]> = {};
    SIMULATED_MODELS.forEach((m, i) => {
      const p = simClassify(m.id, version, bench, 0);
      preds[m.id] = p;
      // reliability: agreement across 3 runs at temperature 0.7 on a 40-call sample
      const sample = bench.slice(0, 40);
      const runs = [1, 2, 3].map((k) => simClassify(m.id, version, sample, 0.7, k));
      const agree = mean(sample.map((_, j) => (runs[0][j].pred === runs[1][j].pred && runs[1][j].pred === runs[2][j].pred ? 1 : 0)));
      out.push(summarize(m.id, m.label.replace(/ \(simulated.*\)/, ""), p, SERIES[i], agree));
    });
    // cascade: small model first, escalate low-confidence calls to the large one
    const small = preds["sim:pico-s"];
    const large = preds["sim:atlas-l"];
    const cas: SimPrediction[] = small.map((s, j) => {
      const esc = (s.confidence ?? 0) < cascadeT || !s.valid;
      const l = large[j];
      return esc ? { ...l, latencyMs: s.latencyMs + l.latencyMs, costUsd: s.costUsd + l.costUsd } : s;
    });
    const escalated = small.filter((s) => (s.confidence ?? 0) < cascadeT || !s.valid).length;
    const r = summarize("cascade", `Cascade: Pico → Atlas (${Math.round((escalated / small.length) * 100)}% escalated)`, cas, SERIES[5], NaN);
    out.push(r);
    return out;
  }, [version, bench, cascadeT]);

  const meets = (r: Row) => r.acc >= minAcc && r.p95 <= maxP95 && r.costPer1k <= maxCost;

  return (
    <div>
      <PageHeader eyebrow="Model comparison" title="Quality ↔ Cost ↔ Latency ↔ Reliability">
        There is no “best model” — only the cheapest option that meets <em>your</em> requirements, measured on <em>your</em> data. All numbers below come from running the 120-call
        benchmark through the simulated models (swap in live models on the Experiments page).
      </PageHeader>
      <Card className="mb-4 grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-5">
        <Field label="Prompt version">
          <Segmented size="sm" value={version} onChange={setVersion} options={["v2", "v3", "v4"].map((v) => ({ id: v, label: v.toUpperCase() }))} />
        </Field>
        <Slider label="Required accuracy ≥" value={minAcc} onChange={setMinAcc} min={0.6} max={0.99} step={0.01} format={(v) => fmtPct(v, 0)} />
        <Slider label="Latency SLA: P95 ≤" value={maxP95} onChange={setMaxP95} min={500} max={8000} step={100} format={(v) => fmtMs(v)} />
        <Slider label="Budget: cost per 1K ≤" value={maxCost} onChange={setMaxCost} min={0.02} max={6} step={0.02} format={(v) => fmtUsd(v)} />
        <Slider label="Cascade: escalate if confidence <" value={cascadeT} onChange={setCascadeT} min={0.5} max={0.99} step={0.01} format={(v) => v.toFixed(2)} />
      </Card>

      <Card className="mb-4 overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-3 py-2">Option</th>
              <th className="px-3 py-2 text-right">Accuracy</th>
              <th className="px-3 py-2 text-right">Macro F1</th>
              <th className="px-3 py-2 text-right">Invalid</th>
              <th className="px-3 py-2 text-right">P50</th>
              <th className="px-3 py-2 text-right">P95</th>
              <th className="px-3 py-2 text-right">Cost / 1K</th>
              <th className="px-3 py-2 text-right">Consistency</th>
              <th className="px-3 py-2 text-center">Meets reqs?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const ok = meets(r);
              return (
                <tr key={r.id} className={cn(ok && "bg-good-soft")}>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                      <span className="font-medium text-ink">{r.label}</span>
                    </span>
                  </td>
                  <td className={cn("num px-3 py-2 text-right font-mono", r.acc < minAcc && "text-bad-ink")}>{fmtPct(r.acc)}</td>
                  <td className="num px-3 py-2 text-right font-mono">{r.f1.toFixed(3)}</td>
                  <td className="num px-3 py-2 text-right font-mono">{fmtPct(r.invalid)}</td>
                  <td className="num px-3 py-2 text-right font-mono">{fmtMs(r.p50)}</td>
                  <td className={cn("num px-3 py-2 text-right font-mono", r.p95 > maxP95 && "text-bad-ink")}>{fmtMs(r.p95)}</td>
                  <td className={cn("num px-3 py-2 text-right font-mono", r.costPer1k > maxCost && "text-bad-ink")}>{fmtUsd(r.costPer1k)}</td>
                  <td className="num px-3 py-2 text-right font-mono">{isNaN(r.consistency) ? "—" : fmtPct(r.consistency, 0)}</td>
                  <td className="px-3 py-2 text-center">{ok ? <Check className="mx-auto h-4 w-4 text-good-ink" /> : <X className="mx-auto h-4 w-4 text-bad-ink" />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Cost vs accuracy" subtitle="Green region = meets your accuracy and budget requirements" />
          <div className="px-4 pb-4">
            <ScatterPlot
              points={rows.map((r) => ({ x: r.costPer1k, y: r.acc, label: r.id === "cascade" ? "Cascade" : r.label.split(" ")[0], color: r.color, size: 5 + Math.min(8, r.p95 / 800), detail: <div className="text-ink-2">P95 {fmtMs(r.p95)}</div> }))}
              xLabel="cost per 1K calls ($)"
              yLabel="accuracy"
              formatX={(v) => `$${v.toFixed(2)}`}
              formatY={(v) => fmtPct(v, 0)}
              xMin={0}
              xMax={Math.max(...rows.map((r) => r.costPer1k)) * 1.15}
              yMin={Math.min(0.6, ...rows.map((r) => r.acc)) - 0.02}
              yMax={1}
              regions={[{ x0: 0, x1: maxCost, y0: minAcc, y1: 1, label: "meets requirements" }]}
            />
            <div className="mt-1 text-[11px] text-ink-3">Dot size grows with P95 latency.</div>
          </div>
        </Card>
        <div className="flex flex-col gap-3">
          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold text-ink">How to reason about it</div>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
              <li>
                <strong className="text-ink">Filter by hard requirements first</strong> (accuracy floor, latency SLA, budget). Among the survivors, prefer the cheapest and simplest.
              </li>
              <li>
                <strong className="text-ink">Check the slices you care about</strong>, not only the average — a model can win overall and lose on sarcasm.
              </li>
              <li>
                <strong className="text-ink">Reasoning models</strong> buy accuracy on hard cases with hidden tokens: more cost and latency on <em>every</em> call.
              </li>
              <li>
                <strong className="text-ink">Cascades</strong> send easy calls to a small model and escalate the rest — only as good as the small model&apos;s calibration.
              </li>
              <li>
                <strong className="text-ink">Reliability</strong>: invalid-output rate and run-to-run consistency matter as much as accuracy in a pipeline.
              </li>
            </ul>
          </Card>
          <Callout kind="info" title="Your answer to “which model is best?”">
            “For intent classification at 20K calls/day with a 3 s P95 SLA and $1 per 1K budget, {rows.filter(meets).map((r) => r.label).join(", ") || "no option"} meet
            {rows.filter(meets).length === 1 ? "s" : ""} the bar on our benchmark.” That&apos;s an engineering answer.
          </Callout>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Options meeting reqs" value={`${rows.filter(meets).length} / ${rows.length}`} />
            <Stat label="Cheapest passing" value={(() => {
              const p = rows.filter(meets).sort((a, b) => a.costPer1k - b.costPer1k)[0];
              return p ? fmtUsd(p.costPer1k) : "—";
            })()} sub={rows.filter(meets).sort((a, b) => a.costPer1k - b.costPer1k)[0]?.label ?? "relax a constraint"} />
          </div>
          <Badge>Simulated models — measure real ones on your own data</Badge>
        </div>
      </div>
    </div>
  );
}
