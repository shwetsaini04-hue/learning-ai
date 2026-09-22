import { ALL_MODELS, compatibleModelInfo, getModel, type ModelInfo, type Pricing } from "@/config/models";

/**
 * Pricing lookup with user overrides. The settings store pushes overrides here
 * so pure functions (simulator, cost lab) don't depend on React state.
 */
let overrides: Record<string, Partial<Pricing>> = {};

export function setPricingOverrides(o: Record<string, Partial<Pricing>>) {
  overrides = o ?? {};
}

export function resolveModel(id: string): ModelInfo {
  return getModel(id) ?? compatibleModelInfo(id);
}

export function getPricing(modelId: string): Pricing {
  const base = resolveModel(modelId).pricing;
  const o = overrides[modelId];
  return { ...base, ...(o ?? {}) };
}

export function costFor(modelId: string, inputTokens: number, outputTokens: number, reasoningTokens = 0, cachedInputTokens = 0) {
  const p = getPricing(modelId);
  const uncached = Math.max(0, inputTokens - cachedInputTokens);
  const cachedRate = p.cachedInputPer1M ?? p.inputPer1M;
  return (uncached * p.inputPer1M + cachedInputTokens * cachedRate + (outputTokens + reasoningTokens) * p.outputPer1M) / 1_000_000;
}

export function allModels() {
  return ALL_MODELS;
}
