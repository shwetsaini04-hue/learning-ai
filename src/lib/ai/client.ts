"use client";

import { getModel, isSimulated } from "@/config/models";
import { simulateLLM } from "@/lib/sim/mockLLM";
import { useSettings } from "@/lib/store/settings";
import { costFor, resolveModel } from "./pricing";
import type { LLMRequest, LLMResponse } from "./types";

/**
 * AI EXPERIMENT LAYER (client side)
 *
 *   UI  ->  invokeLLM()  ->  simulator            (free, deterministic)
 *                        ->  POST /api/llm  ->  provider adapter  ->  real model
 *
 * The UI never talks to a provider directly and never sees an API key.
 */

export class LLMError extends Error {
  constructor(
    message: string,
    public kind: "config" | "limit" | "provider" | "network",
  ) {
    super(message);
  }
}

export const CLIENT_LIMITS = {
  maxInputChars: 16_000,
  maxOutputTokens: 1024,
};

export async function invokeLLM(req: LLMRequest): Promise<LLMResponse> {
  if (isSimulated(req.model)) {
    const m = getModel(req.model);
    if (!m) throw new LLMError(`Unknown simulated model ${req.model}`, "config");
    return simulateLLM(req, m);
  }

  const s = useSettings.getState();
  if (s.mode !== "live") {
    throw new LLMError("Live mode is off. Enable it in Settings to call real models, or choose a simulated model.", "config");
  }
  if (s.liveSpendUsd >= s.budgetUsd) {
    throw new LLMError(
      `Budget guard: estimated live spend $${s.liveSpendUsd.toFixed(4)} reached your limit of $${s.budgetUsd}. Raise it or reset the counter in Settings.`,
      "limit",
    );
  }
  const chars = req.system.length + req.prompt.length;
  if (chars > CLIENT_LIMITS.maxInputChars) {
    throw new LLMError(`Input too large (${chars} chars > ${CLIENT_LIMITS.maxInputChars}). Shorten the transcript or prompt.`, "limit");
  }

  let res: Response;
  try {
    res = await fetch("/api/llm", {
      method: "POST",
      headers: { "content-type": "application/json", ...(s.labToken ? { "x-lab-token": s.labToken } : {}) },
      body: JSON.stringify({
        model: req.model,
        system: req.system,
        prompt: req.prompt,
        temperature: req.temperature,
        maxTokens: Math.min(req.maxTokens, CLIENT_LIMITS.maxOutputTokens),
      }),
    });
  } catch (e) {
    throw new LLMError(`Network error calling /api/llm: ${(e as Error).message}`, "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new LLMError(data?.error ?? `Request failed with status ${res.status}`, res.status === 429 || res.status === 413 ? "limit" : "provider");
  }
  const info = resolveModel(req.model);
  const inputTokens = data.usage?.inputTokens ?? 0;
  const outputTokens = data.usage?.outputTokens ?? 0;
  const reasoningTokens = data.usage?.reasoningTokens ?? 0;
  const costUsd = costFor(req.model, inputTokens, outputTokens, reasoningTokens);
  s.addLiveSpend(costUsd);
  return {
    text: data.text ?? "",
    inputTokens,
    outputTokens,
    reasoningTokens,
    latencyMs: data.latencyMs ?? 0,
    ttftMs: data.latencyMs ?? 0,
    costUsd,
    model: req.model,
    provider: info.provider,
    simulated: false,
    stopReason: data.stopReason,
  };
}

export interface ServerConfig {
  liveEnabled: boolean;
  requiresToken: boolean;
  providers: { anthropic: boolean; openai: boolean; compatible: boolean };
  compatibleModels: string[];
  allowedModels: string[];
  limits: { maxInputChars: number; maxOutputTokens: number; ratePerMinute: number; dailyRequests: number };
}

let configCache: Promise<ServerConfig | null> | null = null;
export function fetchServerConfig(force = false): Promise<ServerConfig | null> {
  if (!configCache || force) {
    configCache = fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return configCache;
}
