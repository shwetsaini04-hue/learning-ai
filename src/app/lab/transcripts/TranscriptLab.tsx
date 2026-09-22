"use client";

import { Play, Wrench } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ModelSelect } from "@/components/ModelSelect";
import { WorkflowRunner } from "@/components/graph/WorkflowRunner";
import { Badge, Button, Callout, Card, Field, PageHeader, ProgressBar, Segmented, Slider, Stat } from "@/components/ui";
import { INTENTS } from "@/lib/domain";
import type { RunTrace } from "@/lib/engine/types";
import { classificationReport } from "@/lib/eval/metrics";
import { findTranscript, TRANSCRIPTS } from "@/lib/sim/transcripts";
import { FEEDBACK_DATASET_ID, useDatasets } from "@/lib/store/datasets";
import { useProgress } from "@/lib/store/progress";
import { cn, fmtMs, fmtPct, fmtUsd } from "@/lib/utils";
import { runWorkflowBatch, type BatchItemResult } from "@/lib/workflows/run";
import type { LLMNodeConfig, RouterConfig, WorkflowSpec } from "@/lib/workflows/spec";
import { getTemplate } from "@/lib/workflows/templates";

type Arch = "transcript_pipeline" | "single_call";

function configure(arch: Arch, model: string, version: string, threshold: number, review: boolean): WorkflowSpec {
  const s = getTemplate(arch);
  s.id = `${arch}-${model}-${version}-${threshold}-${review}`;
  s.nodes = s.nodes.map((n) => {
    if (n.kind === "llm") {
      const c = n.config as LLMNodeConfig;
      return { ...n, config: { ...c, model, promptVersion: c.task === "classify_intent" ? version : c.promptVersion } };
    }
    if (n.kind === "router") return { ...n, config: { ...(n.config as RouterConfig), value: threshold } };
    return n;
  });
  if (!review) {
    s.nodes = s.nodes.filter((n) => n.kind !== "human");
    s.edges = s.edges.filter((e) => e.target !== "human_review" && e.source !== "human_review");
    s.edges.push({ id: "confidence_gate->finalize:low", source: "confidence_gate", target: "finalize", branch: "low" });
  }
  return s;
}

export function TranscriptLab() {
  const [arch, setArch] = useState<Arch>("transcript_pipeline");
  const [model, setModel] = useState("sim:swift-m");
  const [version, setVersion] = useState("v3");
  const [threshold, setThreshold] = useState(0.7);
  const [review, setReview] = useState(true);
  const spec = useMemo(() => configure(arch, model, version, threshold, review), [arch, model, version, threshold, review]);
  const addFeedback = useDatasets((s) => s.addFeedback);
  const feedbackCount = useDatasets((s) => s.datasets.find((d) => d.id === FEEDBACK_DATASET_ID)?.examples.length ?? 0);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
  const bump = useProgress((s) => s.bump);

  const onRun = (t: RunTrace) => {
    bump("transcript_runs");
    const st = t.finalState;
    if (t.status === "success" && st.review_status === "corrected") {
      const intent = st.intent as (typeof INTENTS)[number];
      addFeedback({
        input: String(st.transcript),
        transcriptId: (st.transcript_id as string) ?? undefined,
        expected: { intent, product: (st.product as never) ?? undefined },
        tags: ["human-feedback", ...(findTranscript(String(st.transcript_id ?? ""))?.tags ?? [])],
        notes: String(st.reviewer_note ?? "corrected in Transcript Lab"),
      });
      setLastFeedback(`Saved correction (intent → ${intent}) to the “Human feedback” dataset.`);
    }
  };

  // batch
  const [batch, setBatch] = useState<BatchItemResult[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const runBatch = async () => {
    setBusy(true);
    setProgress(0);
    const res = await runWorkflowBatch(spec, TRANSCRIPTS, (d, n) => setProgress(d / n));
    setBatch(res);
    bump("transcript_runs", `batch of ${res.length} on ${spec.name}`);
    setBusy(false);
  };
  const batchStats = useMemo(() => {
    if (!batch) return null;
    const model = classificationReport(batch.map((b) => ({ expected: b.expected.intent, predicted: b.modelIntent })), [...INTENTS]);
    const system = classificationReport(batch.map((b) => ({ expected: b.expected.intent, predicted: (b.final.intent as string) ?? null })), [...INTENTS]);
    const reviewed = batch.filter((b) => b.reviewed).length;
    return {
      modelAcc: model.accuracy,
      systemAcc: system.accuracy,
      reviewed,
      reviewRate: reviewed / batch.length,
      cost: batch.reduce((a, b) => a + b.costUsd, 0),
      latency: batch.reduce((a, b) => a + b.latencyMs, 0) / batch.length,
      errors: batch.filter((b) => b.status === "error").length,
    };
  }, [batch]);

  return (
    <div>
      <PageHeader
        eyebrow="Transcript Analysis Lab"
        title="Customer call → structured, reviewed result"
        right={
          <Link href="/lab/playground?template=transcript_pipeline">
            <Button variant="outline" icon={<Wrench className="h-4 w-4" />}>
              Edit this pipeline
            </Button>
          </Link>
        }
      >
        A production-style pipeline: redact PII → clean → intent, product, sentiment and details <strong>in parallel</strong> → confidence check → <strong>human review</strong> if below the
        threshold → final JSON. Change the architecture, model, prompt and threshold, then run single calls or the whole set.
      </PageHeader>

      <Card className="mb-4 grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-5">
        <Field label="Architecture">
          <Segmented
            size="sm"
            value={arch}
            onChange={setArch}
            options={[
              { id: "transcript_pipeline", label: "Multi-node" },
              { id: "single_call", label: "Single call" },
            ]}
          />
        </Field>
        <Field label="Model (all LLM nodes)">
          <ModelSelect value={model} onChange={setModel} />
        </Field>
        <Field label="Intent prompt">
          <Segmented size="sm" value={version} onChange={setVersion} options={["v2", "v3", "v4"].map((v) => ({ id: v, label: v.toUpperCase() }))} />
        </Field>
        <Slider label="Review if confidence <" value={threshold} onChange={setThreshold} min={0.5} max={0.95} step={0.05} format={(v) => v.toFixed(2)} />
        <Field label="Human review">
          <Segmented size="sm" value={review ? "on" : "off"} onChange={(v) => setReview(v === "on")} options={[{ id: "on", label: "on" }, { id: "off", label: "off" }]} />
        </Field>
      </Card>

      {lastFeedback && (
        <Callout kind="success" className="mb-3">
          {lastFeedback}{" "}
          <Link href="/lab/datasets" className="font-medium text-accent">
            View dataset ({feedbackCount})
          </Link>
        </Callout>
      )}

      <WorkflowRunner spec={spec} defaultTranscript="t03" panels={["output", "state", "inspect", "trace", "python"]} onRunComplete={onRun} counter="transcript_runs" diagramHeight={640} />

      <h2 className="mb-2 mt-10 text-lg font-semibold text-ink">Run all 30 calls (with a simulated reviewer)</h2>
      <p className="mb-3 max-w-3xl text-sm text-ink-2">
        Every paused call is resolved by a simulated expert reviewer who fixes wrong fields. Compare the <strong>model&apos;s</strong> accuracy with the <strong>system&apos;s</strong>{" "}
        accuracy after review — and what that review rate costs in human time.
      </p>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={runBatch} disabled={busy} icon={<Play className="h-4 w-4" />}>
            Run batch
          </Button>
          {busy && <ProgressBar value={progress} className="max-w-xs" />}
        </div>
        {batch && batchStats && (
          <div className="fade-in mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Model accuracy" value={fmtPct(batchStats.modelAcc)} />
              <Stat label="System accuracy" value={fmtPct(batchStats.systemAcc)} tone="good" sub="after human review" />
              <Stat label="Review rate" value={fmtPct(batchStats.reviewRate, 0)} sub={`${batchStats.reviewed} of ${batch.length} calls`} />
              <Stat label="Human cost" value={`$${(batchStats.reviewed * 0.8).toFixed(2)}`} sub="@ $0.80 / review" />
              <Stat label="LLM cost" value={fmtUsd(batchStats.cost, { precise: true })} sub={`${fmtUsd((batchStats.cost / batch.length) * 1000)} / 1K`} />
              <Stat label="Avg latency" value={fmtMs(batchStats.latency)} sub="model time only" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="text-left text-[10.5px] uppercase tracking-wide text-ink-3">
                  <tr className="border-b border-line">
                    <th className="py-1.5">Call</th>
                    <th className="py-1.5">Gold</th>
                    <th className="py-1.5">Model said</th>
                    <th className="py-1.5">Final</th>
                    <th className="py-1.5">Reviewed</th>
                    <th className="py-1.5">Tags</th>
                    <th className="py-1.5 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.map((b) => {
                    const t = findTranscript(b.id)!;
                    const modelOk = b.modelIntent === b.expected.intent;
                    const finalOk = b.final.intent === b.expected.intent;
                    return (
                      <tr key={b.id} className="border-b border-line/60">
                        <td className="py-1.5 pr-2">
                          <span className="font-mono text-ink-3">{b.id}</span> <span className="text-ink">{t.title}</span>
                        </td>
                        <td className="py-1.5 font-mono">{b.expected.intent}</td>
                        <td className={cn("py-1.5 font-mono", modelOk ? "text-ink-2" : "text-bad-ink")}>{b.modelIntent ?? (b.error ? "error" : "—")}</td>
                        <td className={cn("py-1.5 font-mono", finalOk ? "text-good-ink" : "text-bad-ink")}>{String(b.final.intent ?? "—")}</td>
                        <td className="py-1.5">{b.reviewed ? <Badge tone="warn">reviewed</Badge> : <span className="text-ink-3">auto</span>}</td>
                        <td className="py-1.5">
                          <span className="flex flex-wrap gap-1">
                            {b.tags.slice(0, 2).map((x) => (
                              <Badge key={x}>{x}</Badge>
                            ))}
                          </span>
                        </td>
                        <td className="num py-1.5 text-right font-mono text-ink-2">{fmtUsd(b.costUsd, { precise: true })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Callout kind="info" title="Read the red cells">
              Red in “Model said” but green in “Final” = an error caught by review. Red in “Final” = an error that slipped through with high confidence. Raise the threshold and re-run: fewer
              slips, more reviews. That trade-off is a business decision you can now quantify.
            </Callout>
          </div>
        )}
      </Card>
    </div>
  );
}
