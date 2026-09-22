/**
 * Model + pricing registry.
 *
 * This file is CONFIGURATION, not application logic. Prices change often:
 * - Every entry carries `lastVerified` and `source`.
 * - Users can override any price in Settings (stored in their browser).
 * - The server only allows live calls to models listed here (allowlist).
 *
 * Simulated models are fictional. They exist so you can learn evaluation,
 * cost and latency trade-offs without spending money. Their "quality" numbers
 * are simulation parameters, NOT benchmarks of any real model.
 */

export type ProviderId = "simulated" | "anthropic" | "openai" | "compatible";

export interface Pricing {
  /** USD per 1M input tokens */
  inputPer1M: number;
  /** USD per 1M output tokens (reasoning/thinking tokens are billed as output) */
  outputPer1M: number;
  /** USD per 1M cached-input tokens (prompt caching), if supported */
  cachedInputPer1M?: number;
}

export interface SimProfile {
  /** base probability of a correct label on an average-difficulty example */
  quality: number;
  /** probability of following the output format when the prompt asks for JSON */
  formatDiscipline: number;
  /** 0..1 how well confidence tracks correctness */
  calibration: number;
  /** median time-to-first-token in ms */
  ttftMs: number;
  /** output tokens per second */
  tokensPerSec: number;
  /** lognormal sigma for latency jitter (bigger = heavier tail) */
  latencySigma: number;
  /** average hidden reasoning tokens per call (0 for non-reasoning models) */
  reasoningTokens: number;
  /** probability that a free-text summary contains an unsupported claim */
  hallucinationRate: number;
}

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  label: string;
  description: string;
  pricing: Pricing;
  supportsTemperature: boolean;
  reasoning?: boolean;
  contextWindow?: number;
  sim?: SimProfile;
  lastVerified: string;
  source: string;
}

export const PRICING_LAST_VERIFIED = "2026-09-22";

export const SIMULATED_MODELS: ModelInfo[] = [
  {
    id: "sim:atlas-l",
    provider: "simulated",
    label: "Atlas-L (simulated large)",
    description: "High quality, slower, expensive. Like a frontier general model.",
    pricing: { inputPer1M: 2.5, outputPer1M: 10, cachedInputPer1M: 0.25 },
    supportsTemperature: true,
    contextWindow: 200_000,
    sim: {
      quality: 0.93,
      formatDiscipline: 0.995,
      calibration: 0.8,
      ttftMs: 520,
      tokensPerSec: 65,
      latencySigma: 0.32,
      reasoningTokens: 0,
      hallucinationRate: 0.05,
    },
    lastVerified: PRICING_LAST_VERIFIED,
    source: "Fictional simulation profile",
  },
  {
    id: "sim:swift-m",
    provider: "simulated",
    label: "Swift-M (simulated mid)",
    description: "Good quality, fast, cheap. The usual production workhorse.",
    pricing: { inputPer1M: 0.4, outputPer1M: 1.6, cachedInputPer1M: 0.1 },
    supportsTemperature: true,
    contextWindow: 128_000,
    sim: {
      quality: 0.88,
      formatDiscipline: 0.985,
      calibration: 0.62,
      ttftMs: 260,
      tokensPerSec: 130,
      latencySigma: 0.3,
      reasoningTokens: 0,
      hallucinationRate: 0.09,
    },
    lastVerified: PRICING_LAST_VERIFIED,
    source: "Fictional simulation profile",
  },
  {
    id: "sim:pico-s",
    provider: "simulated",
    label: "Pico-S (simulated small)",
    description: "Very cheap and fast, noticeably weaker on hard or messy transcripts.",
    pricing: { inputPer1M: 0.1, outputPer1M: 0.4, cachedInputPer1M: 0.025 },
    supportsTemperature: true,
    contextWindow: 32_000,
    sim: {
      quality: 0.76,
      formatDiscipline: 0.93,
      calibration: 0.4,
      ttftMs: 150,
      tokensPerSec: 210,
      latencySigma: 0.28,
      reasoningTokens: 0,
      hallucinationRate: 0.16,
    },
    lastVerified: PRICING_LAST_VERIFIED,
    source: "Fictional simulation profile",
  },
  {
    id: "sim:sage-r",
    provider: "simulated",
    label: "Sage-R (simulated reasoning)",
    description: "Thinks before answering: best on hard cases, but hidden reasoning tokens add latency and cost.",
    pricing: { inputPer1M: 1.25, outputPer1M: 10, cachedInputPer1M: 0.125 },
    supportsTemperature: false,
    reasoning: true,
    contextWindow: 400_000,
    sim: {
      quality: 0.95,
      formatDiscipline: 0.997,
      calibration: 0.85,
      ttftMs: 800,
      tokensPerSec: 140,
      latencySigma: 0.4,
      reasoningTokens: 380,
      hallucinationRate: 0.03,
    },
    lastVerified: PRICING_LAST_VERIFIED,
    source: "Fictional simulation profile",
  },
];

/**
 * Live models. Pricing as published by the providers, standard tier.
 * Anthropic: claude-api reference (cached 2026-06-24) — cache reads assumed at 0.1x input; verify.
 * OpenAI: developers.openai.com/api/docs/pricing (fetched 2026-09-22).
 */
export const LIVE_MODELS: ModelInfo[] = [
  {
    id: "claude-opus-5",
    provider: "anthropic",
    label: "Claude Opus 5",
    description: "Anthropic's frontier Opus model. Thinking on by default; no temperature control.",
    pricing: { inputPer1M: 5, outputPer1M: 25, cachedInputPer1M: 0.5 },
    supportsTemperature: false,
    reasoning: true,
    contextWindow: 1_000_000,
    lastVerified: PRICING_LAST_VERIFIED,
    source: "https://docs.claude.com/en/docs/about-claude/pricing",
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    label: "Claude Sonnet 5",
    description: "Balanced Anthropic model. Adaptive thinking; no temperature control.",
    pricing: { inputPer1M: 2, outputPer1M: 10, cachedInputPer1M: 0.2 },
    supportsTemperature: false,
    reasoning: true,
    contextWindow: 1_000_000,
    lastVerified: PRICING_LAST_VERIFIED,
    source: "https://docs.claude.com/en/docs/about-claude/pricing",
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    description: "Fast, low-cost Anthropic model. Supports temperature.",
    pricing: { inputPer1M: 1, outputPer1M: 5, cachedInputPer1M: 0.1 },
    supportsTemperature: true,
    contextWindow: 200_000,
    lastVerified: PRICING_LAST_VERIFIED,
    source: "https://docs.claude.com/en/docs/about-claude/pricing",
  },
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    label: "GPT-5.4 mini",
    description: "OpenAI small reasoning model. Reasoning tokens are billed as output.",
    pricing: { inputPer1M: 0.75, outputPer1M: 4.5, cachedInputPer1M: 0.075 },
    supportsTemperature: false,
    reasoning: true,
    lastVerified: PRICING_LAST_VERIFIED,
    source: "https://developers.openai.com/api/docs/pricing",
  },
  {
    id: "gpt-5.4-nano",
    provider: "openai",
    label: "GPT-5.4 nano",
    description: "OpenAI's cheapest current reasoning model.",
    pricing: { inputPer1M: 0.2, outputPer1M: 1.25, cachedInputPer1M: 0.02 },
    supportsTemperature: false,
    reasoning: true,
    lastVerified: PRICING_LAST_VERIFIED,
    source: "https://developers.openai.com/api/docs/pricing",
  },
  {
    id: "gpt-4.1-mini",
    provider: "openai",
    label: "GPT-4.1 mini",
    description: "Non-reasoning OpenAI model. Supports temperature (useful for consistency experiments).",
    pricing: { inputPer1M: 0.4, outputPer1M: 1.6, cachedInputPer1M: 0.1 },
    supportsTemperature: true,
    lastVerified: PRICING_LAST_VERIFIED,
    source: "https://developers.openai.com/api/docs/pricing",
  },
];

export const ALL_MODELS: ModelInfo[] = [...SIMULATED_MODELS, ...LIVE_MODELS];

export const DEFAULT_SIM_MODEL = "sim:swift-m";

export function getModel(id: string): ModelInfo | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

export function isSimulated(id: string) {
  return id.startsWith("sim:");
}

/**
 * OpenAI-compatible endpoints (Groq, Together, OpenRouter, a local Ollama, ...)
 * are configured purely through env vars on the server. Their model ids are
 * reported by /api/config and priced at 0 unless overridden in Settings.
 */
export function compatibleModelInfo(id: string): ModelInfo {
  return {
    id,
    provider: "compatible",
    label: `${id} (OpenAI-compatible)`,
    description: "Model served by an OpenAI-compatible endpoint configured on the server.",
    pricing: { inputPer1M: 0, outputPer1M: 0 },
    supportsTemperature: true,
    lastVerified: "n/a",
    source: "Configured via OPENAI_COMPATIBLE_* env vars",
  };
}
