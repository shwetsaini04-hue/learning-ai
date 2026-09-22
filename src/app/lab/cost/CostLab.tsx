"use client";

import { Play } from "lucide-react";
import { useState } from "react";
import { GroupedBarChart } from "@/components/charts/Charts";
import { ModelSelect } from "@/components/ModelSelect";
import { CostCalculator } from "@/components/labs/CostCalculator";
import { PricingTable } from "@/components/labs/PricingTable";
import { Button, Card, CardHeader, Field, PageHeader, Stat } from "@/components/ui";
import { transcriptToText } from "@/lib/domain";
import { MemoryCheckpointer } from "@/lib/engine/checkpointer";
import { TRANSCRIPTS } from "@/lib/sim/transcripts";
import { fmtInt, fmtMs, fmtUsd, mean } from "@/lib/utils";
import { runWorkflow } from "@/lib/workflows/run";
import type { LLMNodeConfig, WorkflowSpec } from "@/lib/workflows/spec";
import { getTemplate } from "@/lib/workflows/templates";

const ARCHS: { id: string; label: string }[] = [
  { id: "simple_chain", label: "Intent only (1 call)" },
  { id: "single_call", label: "Single call, all fields" },
  { id: "parallel", label: "3 parallel calls" },
  { id: "transcript_pipeline", label: "4 parallel calls + review" },
];

function withModel(spec: WorkflowSpec, model: string): WorkflowSpec {
  return { ...spec, checkpointer: true, nodes: spec.nodes.map((n) => (n.kind === "llm" ? { ...n, config: { ...(n.config as LLMNodeConfig), model } } : n)) };
}

function ArchitectureCost() {
  const [model, setModel] = useState("sim:swift-m");
  const [res, setRes] = useState<{ label: string; cost: number; tokens: number; calls: number; latency: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const out = [];
    for (const a of ARCHS) {
      const spec = withModel(getTemplate(a.id), model);
      const traces = await Promise.all(
        TRANSCRIPTS.slice(0, 12).map((t) => runWorkflow(spec, { transcript: transcriptToText(t), transcript_id: t.id }, { checkpointer: new MemoryCheckpointer(), threadId: t.id })),
      );
      out.push({
        label: a.label,
        cost: mean(traces.map((t) => t.totals.costUsd)),
        tokens: mean(traces.map((t) => t.totals.inputTokens + t.totals.outputTokens + t.totals.reasoningTokens)),
        calls: mean(traces.map((t) => t.totals.llmCalls)),
        latency: mean(traces.map((t) => t.totals.simLatencyMs)),
      });
    }
    setRes(out);
    setBusy(false);
  };
  return (
    <Card>
      <CardHeader title="Architecture changes the bill" subtitle="Measured by running each workflow on 12 calls (simulated). Latency is model time only (review pauses excluded)." />
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Model for every LLM node" className="w-64">
            <ModelSelect value={model} onChange={setModel} />
          </Field>
          <Button variant="primary" onClick={run} disabled={busy} icon={<Play className="h-4 w-4" />}>
            Measure
          </Button>
        </div>
        {res && (
          <>
            <GroupedBarChart groups={res.map((r) => r.label)} series={[{ label: "cost per 1K transcripts ($)", values: res.map((r) => r.cost * 1000) }]} format={(v) => `$${v.toFixed(2)}`} height={200} />
            <div className="grid gap-2 sm:grid-cols-4">
              {res.map((r) => (
                <Stat key={r.label} label={r.label} value={fmtUsd(r.cost * 1000)} sub={`${r.calls.toFixed(1)} calls · ${fmtInt(r.tokens)} tok · ${fmtMs(r.latency)}`} />
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export function CostLab() {
  return (
    <div>
      <PageHeader eyebrow="Cost lab" title="What will this cost at 20,000 calls a day?">
        Tokens × prices × calls. Change prompt length, output length, caching, batching and the model, and see per-request, per-1K/10K/100K and monthly cost. Prices are configuration —
        edit them below if the provider changed them.
      </PageHeader>
      <CostCalculator />
      <div className="mt-6 flex flex-col gap-6">
        <ArchitectureCost />
        <PricingTable />
      </div>
    </div>
  );
}
