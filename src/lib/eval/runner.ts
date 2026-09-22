"use client";

import { isSimulated } from "@/config/models";
import { invokeLLM } from "@/lib/ai/client";
import { costFor } from "@/lib/ai/pricing";
import { parseStructured } from "@/lib/ai/schema";
import { getPromptVersion, getTask, renderPrompt } from "@/lib/ai/tasks";
import { INTENTS, PRODUCTS } from "@/lib/domain";
import type { DatasetExample } from "@/lib/store/datasets";
import { estimateTokens, sleep, uid } from "@/lib/utils";
import { classificationReport, latencyStats, wilsonInterval, type ClassMetrics } from "./metrics";

export type ExperimentTask = "classify_intent" | "full_analysis";

export interface ExperimentConfig {
  datasetId: string;
  datasetName: string;
  model: string;
  task: ExperimentTask;
  promptVersion: string;
  temperature: number;
  maxTokens: number;
}

export interface ExampleResult {
  exampleId: string;
  tags: string[];
  expected: string;
  predicted: string | null;
  correct: boolean;
  valid: boolean;
  error?: string;
  confidence?: number | null;
  expectedProduct?: string;
  predictedProduct?: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  raw: string;
  stopReason?: string;
}

export interface ExperimentMetrics {
  n: number;
  accuracy: number;
  accuracyCI: { low: number; high: number };
  macroF1: number;
  weightedF1: number;
  macroPrecision: number;
  macroRecall: number;
  perClass: ClassMetrics[];
  labels: string[];
  predictedLabels: string[];
  matrix: number[][];
  invalidRate: number;
  providerErrorRate: number;
  latency: { mean: number; p50: number; p90: number; p95: number; p99: number; max: number };
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCost: number;
  costPer1k: number;
  productAccuracy: number | null;
  byTag: { tag: string; n: number; accuracy: number }[];
  /** share of wrong answers the model was >= 0.8 confident about */
  overconfidentErrorRate: number;
}

export interface Experiment {
  id: string;
  name: string;
  createdAt: number;
  config: ExperimentConfig;
  results: ExampleResult[];
  metrics: ExperimentMetrics;
  simulated: boolean;
  prompt: { system: string; user: string };
}

export function computeMetrics(results: ExampleResult[]): ExperimentMetrics {
  const report = classificationReport(
    results.map((r) => ({ expected: r.expected, predicted: r.predicted })),
    [...INTENTS],
  );
  const n = results.length;
  const lat = latencyStats(results.map((r) => r.latencyMs));
  const tags = new Map<string, { n: number; ok: number }>();
  for (const r of results)
    for (const t of r.tags) {
      const cur = tags.get(t) ?? { n: 0, ok: 0 };
      cur.n++;
      if (r.correct) cur.ok++;
      tags.set(t, cur);
    }
  const withProduct = results.filter((r) => r.expectedProduct !== undefined && r.predictedProduct !== undefined);
  const wrong = results.filter((r) => !r.correct);
  const totalCost = results.reduce((a, r) => a + r.costUsd, 0);
  return {
    n,
    accuracy: report.accuracy,
    accuracyCI: wilsonInterval(report.correct, report.total),
    macroF1: report.macroF1,
    weightedF1: report.weightedF1,
    macroPrecision: report.macroPrecision,
    macroRecall: report.macroRecall,
    perClass: report.perClass,
    labels: report.labels,
    predictedLabels: report.predictedLabels,
    matrix: report.matrix,
    invalidRate: n ? results.filter((r) => !r.valid).length / n : 0,
    providerErrorRate: n ? results.filter((r) => r.error && r.error.startsWith("Provider")).length / n : 0,
    latency: lat,
    avgInputTokens: n ? results.reduce((a, r) => a + r.inputTokens, 0) / n : 0,
    avgOutputTokens: n ? results.reduce((a, r) => a + r.outputTokens + r.reasoningTokens, 0) / n : 0,
    totalCost,
    costPer1k: n ? (totalCost / n) * 1000 : 0,
    productAccuracy: withProduct.length ? withProduct.filter((r) => r.expectedProduct === r.predictedProduct).length / withProduct.length : null,
    byTag: [...tags.entries()].map(([tag, v]) => ({ tag, n: v.n, accuracy: v.ok / v.n })).sort((a, b) => a.accuracy - b.accuracy),
    overconfidentErrorRate: wrong.length ? wrong.filter((r) => (r.confidence ?? 0) >= 0.8).length / wrong.length : 0,
  };
}

export function buildPrompt(task: ExperimentTask, version: string, transcript: string) {
  const pv = getPromptVersion(task, version)!;
  return { system: pv.system, user: renderPrompt(pv.user, { transcript }) };
}

/** Estimate before running — shown to the user as a cost guard. */
export function estimateExperiment(config: ExperimentConfig, examples: DatasetExample[]) {
  const pv = getPromptVersion(config.task, config.promptVersion)!;
  const base = estimateTokens(pv.system) + estimateTokens(pv.user.replace("{{transcript}}", ""));
  const inputTokens = examples.reduce((a, e) => a + base + estimateTokens(e.input) + 7, 0);
  const outPer = config.task === "full_analysis" ? 70 : 20;
  const outputTokens = examples.length * outPer;
  return { calls: examples.length, inputTokens, outputTokens, cost: costFor(config.model, inputTokens, outputTokens) };
}

export async function runExperiment(
  config: ExperimentConfig,
  examples: DatasetExample[],
  onProgress?: (done: number, total: number) => void,
  opts: { concurrency?: number; signal?: { aborted: boolean }; name?: string } = {},
): Promise<Experiment> {
  const simulated = isSimulated(config.model);
  const concurrency = opts.concurrency ?? (simulated ? 16 : 3);
  const task = getTask(config.task)!;
  const pv = getPromptVersion(config.task, config.promptVersion)!;
  const results: ExampleResult[] = new Array(examples.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < examples.length) {
      if (opts.signal?.aborted) return;
      const i = next++;
      const ex = examples[i];
      const prompt = renderPrompt(pv.user, { transcript: ex.input });
      try {
        const res = await invokeLLM({
          model: config.model,
          system: pv.system,
          prompt,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          task: config.task,
          promptVersion: pv.id,
          sim: { transcript: ex.input, transcriptId: ex.transcriptId, runIndex: i },
        });
        const parsed = parseStructured(res.text, task.schema);
        const predicted = parsed.ok ? String(parsed.value?.intent) : null;
        const predictedProduct = parsed.ok && config.task === "full_analysis" ? String(parsed.value?.product) : undefined;
        results[i] = {
          exampleId: ex.id,
          tags: ex.tags,
          expected: ex.expected.intent,
          predicted,
          correct: predicted === ex.expected.intent,
          valid: parsed.ok,
          error: parsed.ok ? undefined : parsed.error?.message,
          confidence: parsed.ok ? (parsed.value?.confidence as number) ?? null : null,
          expectedProduct: config.task === "full_analysis" && ex.expected.product ? ex.expected.product : undefined,
          predictedProduct: predictedProduct && (PRODUCTS as readonly string[]).includes(predictedProduct) ? predictedProduct : predictedProduct === undefined ? undefined : null,
          latencyMs: res.latencyMs,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          reasoningTokens: res.reasoningTokens,
          costUsd: res.costUsd,
          raw: res.text.slice(0, 240),
          stopReason: res.stopReason,
        };
      } catch (e) {
        results[i] = {
          exampleId: ex.id,
          tags: ex.tags,
          expected: ex.expected.intent,
          predicted: null,
          correct: false,
          valid: false,
          error: `Provider error: ${(e as Error).message}`,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          costUsd: 0,
          raw: "",
        };
      }
      done++;
      onProgress?.(done, examples.length);
      if (simulated && done % 20 === 0) await sleep(0);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, examples.length) }, worker));
  const finished = results.filter(Boolean);
  const modelShort = config.model.replace("sim:", "");
  return {
    id: uid("exp"),
    name: opts.name ?? `${modelShort} · ${pv.label.split(" · ")[0]} · ${config.datasetName.split(" (")[0]}`,
    createdAt: Date.now(),
    config,
    results: finished,
    metrics: computeMetrics(finished),
    simulated,
    prompt: { system: pv.system, user: pv.user },
  };
}

export interface ExperimentDiff {
  fixed: ExampleResult[];
  regressed: ExampleResult[];
  bothRight: number;
  bothWrong: number;
  common: number;
}

/** Regression analysis between a baseline and a candidate run on the same dataset. */
export function diffExperiments(baseline: Experiment, candidate: Experiment): ExperimentDiff {
  const b = new Map(baseline.results.map((r) => [r.exampleId, r]));
  const fixed: ExampleResult[] = [];
  const regressed: ExampleResult[] = [];
  let bothRight = 0;
  let bothWrong = 0;
  let common = 0;
  for (const c of candidate.results) {
    const base = b.get(c.exampleId);
    if (!base) continue;
    common++;
    if (base.correct && c.correct) bothRight++;
    else if (!base.correct && !c.correct) bothWrong++;
    else if (!base.correct && c.correct) fixed.push(c);
    else regressed.push(c);
  }
  return { fixed, regressed, bothRight, bothWrong, common };
}
