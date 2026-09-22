"use client";

import { useMemo, useState } from "react";
import { HBarChart, LineChart } from "@/components/charts/Charts";
import { Badge, Card, Field, Input, Select, Slider, Stat, Toggle } from "@/components/ui";
import { ALL_MODELS, PRICING_LAST_VERIFIED } from "@/config/models";
import { getPricing } from "@/lib/ai/pricing";
import { useSettings } from "@/lib/store/settings";
import { fmtInt, fmtUsd } from "@/lib/utils";
import { LastVerified } from "@/components/learn/CodeBlock";

export interface CostInputs {
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  callsPerDay: number;
  days: number;
  cachedShare: number; // 0..1 of input tokens served from cache
  batch: boolean;
  callsPerTranscript: number;
}

export function computeCost(i: CostInputs) {
  const p = getPricing(i.model);
  const cachedRate = p.cachedInputPer1M ?? p.inputPer1M;
  const uncachedIn = i.inputTokens * (1 - i.cachedShare);
  const cachedIn = i.inputTokens * i.cachedShare;
  const disc = i.batch ? 0.5 : 1;
  const parts = {
    input: (uncachedIn * p.inputPer1M) / 1e6,
    cached: (cachedIn * cachedRate) / 1e6,
    output: (i.outputTokens * p.outputPer1M) / 1e6,
    reasoning: (i.reasoningTokens * p.outputPer1M) / 1e6,
  };
  const perCall = (parts.input + parts.cached + parts.output + parts.reasoning) * disc;
  const perTranscript = perCall * i.callsPerTranscript;
  return {
    parts: { input: parts.input * disc, cached: parts.cached * disc, output: parts.output * disc, reasoning: parts.reasoning * disc },
    perCall,
    perTranscript,
    per1k: perTranscript * 1000,
    per10k: perTranscript * 10_000,
    per100k: perTranscript * 100_000,
    perDay: perTranscript * i.callsPerDay,
    perMonth: perTranscript * i.callsPerDay * i.days,
  };
}

export function CostCalculator({ compact, initial }: { compact?: boolean; initial?: Partial<CostInputs> }) {
  useSettings((s) => s.pricingOverrides); // re-render when prices change
  const [c, setC] = useState<CostInputs>({
    model: "sim:swift-m",
    inputTokens: 1100,
    outputTokens: 40,
    reasoningTokens: 0,
    callsPerDay: 20_000,
    days: 30,
    cachedShare: 0,
    batch: false,
    callsPerTranscript: 1,
    ...initial,
  });
  const set = <K extends keyof CostInputs>(k: K, v: CostInputs[K]) => setC({ ...c, [k]: v });
  const r = computeCost(c);
  const p = getPricing(c.model);
  const promptXs = [200, 500, 1000, 1500, 2000, 3000, 4000];
  const outXs = [10, 50, 100, 200, 400, 800];
  const compare = useMemo(
    () =>
      ALL_MODELS.map((m) => ({ label: m.label.replace(" (simulated", " (sim"), value: computeCost({ ...c, model: m.id }).perMonth, id: m.id }))
        .sort((a, b) => a.value - b.value),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c.inputTokens, c.outputTokens, c.reasoningTokens, c.callsPerDay, c.days, c.cachedShare, c.batch, c.callsPerTranscript],
  );
  return (
    <Card className="my-6 p-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-3">
          <Field label="Model" hint={<LastVerified date={PRICING_LAST_VERIFIED} />}>
            <Select value={c.model} onChange={(v) => set("model", v)} options={ALL_MODELS.map((m) => ({ value: m.id, label: m.label, group: m.provider === "simulated" ? "Simulated" : `Live · ${m.provider}` }))} />
          </Field>
          <div className="text-xs text-ink-3">
            ${p.inputPer1M}/M input · ${p.outputPer1M}/M output{p.cachedInputPer1M !== undefined ? ` · $${p.cachedInputPer1M}/M cached input` : ""} — edit prices in Settings.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Input tokens / call">
              <Input type="number" min={0} value={c.inputTokens} onChange={(e) => set("inputTokens", Math.max(0, Number(e.target.value)))} />
            </Field>
            <Field label="Output tokens / call">
              <Input type="number" min={0} value={c.outputTokens} onChange={(e) => set("outputTokens", Math.max(0, Number(e.target.value)))} />
            </Field>
            <Field label="Reasoning tokens / call" hint="billed as output">
              <Input type="number" min={0} value={c.reasoningTokens} onChange={(e) => set("reasoningTokens", Math.max(0, Number(e.target.value)))} />
            </Field>
            <Field label="LLM calls / transcript">
              <Input type="number" min={1} value={c.callsPerTranscript} onChange={(e) => set("callsPerTranscript", Math.max(1, Number(e.target.value)))} />
            </Field>
            <Field label="Transcripts / day">
              <Input type="number" min={0} value={c.callsPerDay} onChange={(e) => set("callsPerDay", Math.max(0, Number(e.target.value)))} />
            </Field>
            <Field label="Days / month">
              <Input type="number" min={1} max={31} value={c.days} onChange={(e) => set("days", Math.max(1, Number(e.target.value)))} />
            </Field>
          </div>
          <Slider label="Input served from prompt cache" value={c.cachedShare} onChange={(v) => set("cachedShare", v)} min={0} max={0.95} step={0.05} format={(v) => `${Math.round(v * 100)}%`} />
          <Toggle checked={c.batch} onChange={(v) => set("batch", v)} label={<span className="text-sm">Batch API (~50% off, results within hours)</span>} />
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Per transcript" value={fmtUsd(r.perTranscript, { precise: true })} />
            <Stat label="Per 1K" value={fmtUsd(r.per1k)} />
            <Stat label="Per 10K" value={fmtUsd(r.per10k)} />
            <Stat label="Per 100K" value={fmtUsd(r.per100k)} />
            <Stat label="Per day" value={fmtUsd(r.perDay)} />
            <Stat label="Per month" value={fmtUsd(r.perMonth)} tone="warn" sub={`${fmtInt(c.callsPerDay * c.days)} transcripts`} />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Where the money goes (per transcript)</div>
            <HBarChart
              format={(v) => fmtUsd(v * c.callsPerTranscript, { precise: true })}
              data={[
                { label: "Input (uncached)", value: r.parts.input, color: "var(--s1)" },
                { label: "Input (cached)", value: r.parts.cached, color: "var(--s3)" },
                { label: "Output", value: r.parts.output, color: "var(--s2)" },
                { label: "Reasoning", value: r.parts.reasoning, color: "var(--s7)" },
              ]}
            />
          </div>
          {!compact && (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Monthly cost by model (same workload)</div>
              <HBarChart data={compare.map((m) => ({ label: m.label, value: m.value, color: m.id === c.model ? "var(--s2)" : "var(--s1)" }))} format={(v) => fmtUsd(v)} />
            </div>
          )}
        </div>
      </div>
      {!compact && (
        <div className="mt-5 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Monthly cost vs prompt length</div>
            <LineChart xs={promptXs} series={[{ label: "monthly", values: promptXs.map((x) => computeCost({ ...c, inputTokens: x }).perMonth) }]} formatX={(v) => `${v}`} formatY={(v) => fmtUsd(v)} height={180} xLabel="input tokens per call" />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Monthly cost vs output length</div>
            <LineChart xs={outXs} series={[{ label: "monthly", values: outXs.map((x) => computeCost({ ...c, outputTokens: x }).perMonth) }]} formatX={(v) => `${v}`} formatY={(v) => fmtUsd(v)} height={180} xLabel="output tokens per call" />
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge>Prices are configuration, not code</Badge>
        <Badge>Verify at the provider before budgeting</Badge>
      </div>
    </Card>
  );
}
