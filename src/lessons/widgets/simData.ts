import { getModel } from "@/config/models";
import { parseStructured } from "@/lib/ai/schema";
import { getPromptVersion, renderPrompt, TASKS } from "@/lib/ai/tasks";
import { transcriptToText, type Transcript } from "@/lib/domain";
import { simulateLLM } from "@/lib/sim/mockLLM";

export interface SimPrediction {
  id: string;
  title: string;
  gold: string;
  pred: string | null;
  confidence: number | null;
  correct: boolean;
  valid: boolean;
  tags: string[];
  latencyMs: number;
  costUsd: number;
  raw: string;
}

/** Synchronous simulated classification — for instant, interactive teaching widgets. */
export function simClassify(modelId: string, version: string, items: Transcript[], temperature = 0, runIndex = 0): SimPrediction[] {
  const model = getModel(modelId)!;
  const pv = getPromptVersion("classify_intent", version)!;
  return items.map((t, i) => {
    const text = transcriptToText(t);
    const res = simulateLLM(
      {
        model: modelId,
        system: pv.system,
        prompt: renderPrompt(pv.user, { transcript: text }),
        temperature,
        maxTokens: 1024,
        task: "classify_intent",
        promptVersion: version,
        sim: { transcript: text, transcriptId: t.id, runIndex: runIndex * 1000 + i },
      },
      model,
    );
    const parsed = parseStructured(res.text, TASKS.classify_intent.schema);
    const pred = parsed.ok ? String(parsed.value!.intent) : null;
    return {
      id: t.id,
      title: t.title,
      gold: t.labels.intent,
      pred,
      confidence: parsed.ok ? Number(parsed.value!.confidence) : null,
      correct: pred === t.labels.intent,
      valid: parsed.ok,
      tags: t.tags,
      latencyMs: res.latencyMs,
      costUsd: res.costUsd,
      raw: res.text,
    };
  });
}
