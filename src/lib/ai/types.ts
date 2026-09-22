import type { ProviderId } from "@/config/models";

export type TaskId =
  | "classify_intent"
  | "extract_product"
  | "sentiment"
  | "full_analysis"
  | "extract_details"
  | "summarize"
  | "judge"
  | "custom";

export interface JudgeSimInput {
  question: string;
  reference: string;
  answer: string;
  context?: string;
  rubric: { strictness: number; penalizeUnsupported: boolean; requireLabelMatch: boolean; scale: number };
  /** position of the answer in pairwise mode (A/B) — used to model position bias */
  position?: "A" | "B";
}

export interface LLMRequest {
  model: string;
  system: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  task?: TaskId;
  promptVersion?: string;
  /** extra context the SIMULATOR needs (never sent to a real provider) */
  sim?: {
    transcript?: string;
    transcriptId?: string;
    runIndex?: number;
    judge?: JudgeSimInput;
  };
}

export interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  latencyMs: number;
  ttftMs: number;
  costUsd: number;
  model: string;
  provider: ProviderId;
  simulated: boolean;
  stopReason?: string;
}

export type LLMInvoker = (req: LLMRequest) => Promise<LLMResponse>;
