"use client";

import { invokeLLM } from "@/lib/ai/client";
import { MemoryCheckpointer } from "@/lib/engine/checkpointer";
import { runGraph } from "@/lib/engine/graph";
import type { EngineEvent, GraphState, RunTrace } from "@/lib/engine/types";
import { transcriptToText, type Transcript } from "@/lib/domain";
import { compileWorkflow, type HumanDecision } from "./compile";
import type { WorkflowSpec } from "./spec";

export interface WorkflowRunOptions {
  onEvent?: (e: EngineEvent) => void;
  pace?: (ms: number) => Promise<void>;
  gate?: (step: number, nodes: string[]) => Promise<void>;
  checkpointer?: MemoryCheckpointer | null;
  threadId?: string;
  resume?: { value: unknown };
  fromCheckpointId?: string;
  recursionLimit?: number;
  signal?: { aborted: boolean };
}

export function runWorkflow(spec: WorkflowSpec, input: GraphState | null, opts: WorkflowRunOptions = {}): Promise<RunTrace> {
  const def = compileWorkflow(spec, { llm: invokeLLM });
  return runGraph(def, input, {
    llm: invokeLLM,
    onEvent: opts.onEvent,
    pace: opts.pace,
    gate: opts.gate,
    checkpointer: opts.checkpointer ?? null,
    threadId: opts.threadId,
    resume: opts.resume,
    fromCheckpointId: opts.fromCheckpointId,
    recursionLimit: opts.recursionLimit ?? spec.recursionLimit ?? 25,
    signal: opts.signal,
  });
}

export interface BatchItemResult {
  id: string;
  expected: Transcript["labels"];
  final: GraphState;
  status: RunTrace["status"];
  error?: string;
  reviewed: boolean;
  /** what the workflow predicted BEFORE any human correction */
  modelIntent: string | null;
  modelProduct: string | null;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  llmCalls: number;
  tags: string[];
  difficulty: number;
}

/** A simulated reviewer: fixes wrong fields using gold labels (humans are good but slow and costly). */
export function simulatedReviewer(gold: Transcript["labels"]) {
  return (payload: { prediction?: Record<string, unknown> }): HumanDecision => {
    const corrections: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload.prediction ?? {})) {
      const g = (gold as unknown as Record<string, unknown>)[k];
      if (g !== undefined && JSON.stringify(g) !== JSON.stringify(v)) corrections[k] = g;
    }
    return Object.keys(corrections).length ? { action: "correct", corrections, note: "fixed by reviewer" } : { action: "approve" };
  };
}

export async function runWorkflowBatch(
  spec: WorkflowSpec,
  items: Transcript[],
  onProgress?: (done: number, total: number) => void,
  opts: { recursionLimit?: number; concurrency?: number } = {},
): Promise<BatchItemResult[]> {
  const results: BatchItemResult[] = new Array(items.length);
  const concurrency = opts.concurrency ?? 6;
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const t = items[i];
      const cpr = new MemoryCheckpointer();
      const threadId = `batch-${t.id}`;
      let trace = await runWorkflow({ ...spec, checkpointer: true }, { transcript: transcriptToText(t), transcript_id: t.id }, { checkpointer: cpr, threadId, recursionLimit: opts.recursionLimit });
      let reviewed = false;
      const firstPass = { ...trace.finalState };
      let spans = [...trace.spans];
      let totalLatency = trace.totals.simLatencyMs;
      let guard = 0;
      let preReview: GraphState | null = null;
      while (trace.status === "interrupted" && guard++ < 5) {
        reviewed = true;
        preReview = preReview ?? { ...trace.finalState };
        const payload = trace.interrupt?.payload as { prediction?: Record<string, unknown> };
        const decision = simulatedReviewer(t.labels)(payload ?? {});
        trace = await runWorkflow({ ...spec, checkpointer: true }, null, { checkpointer: cpr, threadId, resume: { value: decision }, recursionLimit: opts.recursionLimit });
        spans = [...spans, ...trace.spans];
        totalLatency += trace.totals.simLatencyMs;
      }
      const llmCalls = spans.flatMap((s) => s.llmCalls);
      const before = preReview ?? firstPass;
      results[i] = {
        id: t.id,
        expected: t.labels,
        final: trace.finalState,
        status: trace.status,
        error: trace.error ? `${trace.error.type}: ${trace.error.message}` : undefined,
        reviewed,
        modelIntent: (before.intent as string) ?? null,
        modelProduct: (before.product as string) ?? null,
        latencyMs: totalLatency,
        costUsd: llmCalls.reduce((a, c) => a + c.costUsd, 0),
        inputTokens: llmCalls.reduce((a, c) => a + c.inputTokens, 0),
        outputTokens: llmCalls.reduce((a, c) => a + c.outputTokens + c.reasoningTokens, 0),
        llmCalls: llmCalls.length,
        tags: t.tags,
        difficulty: t.difficulty,
      };
      done++;
      onProgress?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
