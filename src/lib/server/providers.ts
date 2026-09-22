import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getModel, type ProviderId } from "@/config/models";

/**
 * Provider adapters: one small function per provider, one common result shape.
 * Adding a provider = adding an adapter here + models in src/config/models.ts.
 */

export interface ProviderRequest {
  model: string;
  system: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
}

export interface ProviderResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  stopReason: string;
  latencyMs: number;
  provider: ProviderId;
  model: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

// Anthropic models with thinking on by default: keep it cheap for classification-style calls.
const ANTHROPIC_THINKING_DEFAULT = new Set(["claude-opus-5", "claude-sonnet-5"]);
const ANTHROPIC_FALLBACK_DEFAULT = new Set(["claude-opus-5"]);

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let compatibleClient: OpenAI | null = null;

async function callAnthropic(req: ProviderRequest): Promise<ProviderResult> {
  anthropicClient ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const info = getModel(req.model);
  const thinking = ANTHROPIC_THINKING_DEFAULT.has(req.model);
  const base = {
    model: req.model,
    // thinking tokens count toward max_tokens; leave room so the answer isn't cut off
    max_tokens: thinking ? Math.max(req.maxTokens, 1024) : req.maxTokens,
    system: req.system,
    messages: [{ role: "user" as const, content: req.prompt }],
    ...(info?.supportsTemperature ? { temperature: req.temperature } : {}),
    ...(thinking ? { output_config: { effort: "low" as const } } : {}),
  };
  const t0 = Date.now();
  try {
    let content: { type: string; text?: string }[];
    let usage: { input_tokens: number; output_tokens: number };
    let stop: string | null;
    if (ANTHROPIC_FALLBACK_DEFAULT.has(req.model)) {
      // server-side refusal fallbacks: a declined request is re-run on a recommended fallback model
      const msg = await anthropicClient.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
      content = msg.content;
      usage = msg.usage;
      stop = msg.stop_reason;
    } else {
      const msg = await anthropicClient.messages.create(base);
      content = msg.content;
      usage = msg.usage;
      stop = msg.stop_reason;
    }
    const text = content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return {
      text: stop === "refusal" ? "" : text,
      usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, reasoningTokens: 0 },
      stopReason: stop ?? "unknown",
      latencyMs: Date.now() - t0,
      provider: "anthropic",
      model: req.model,
    };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new ProviderError("Anthropic rate limit — try again shortly.", 429);
    if (e instanceof Anthropic.AuthenticationError) throw new ProviderError("Anthropic authentication failed — check ANTHROPIC_API_KEY on the server.", 502);
    if (e instanceof Anthropic.BadRequestError) throw new ProviderError(`Anthropic rejected the request: ${e.message}`, 400);
    if (e instanceof Anthropic.APIError) throw new ProviderError(`Anthropic API error ${e.status ?? ""}: ${e.message}`, 502);
    throw new ProviderError(`Could not reach Anthropic: ${(e as Error).message}`, 502);
  }
}

async function callOpenAIResponses(client: OpenAI, req: ProviderRequest, provider: ProviderId): Promise<ProviderResult> {
  const info = getModel(req.model);
  const reasoning = !!info?.reasoning;
  const t0 = Date.now();
  try {
    const res = await client.responses.create({
      model: req.model,
      instructions: req.system,
      input: req.prompt,
      // reasoning tokens count toward max_output_tokens
      max_output_tokens: reasoning ? Math.max(req.maxTokens, 1024) : req.maxTokens,
      ...(info?.supportsTemperature ? { temperature: req.temperature } : {}),
      ...(reasoning ? { reasoning: { effort: "low" as const } } : {}),
    });
    const reasoningTokens = res.usage?.output_tokens_details?.reasoning_tokens ?? 0;
    return {
      text: res.output_text ?? "",
      usage: {
        inputTokens: res.usage?.input_tokens ?? 0,
        // report visible output separately from reasoning (reasoning is billed as output too)
        outputTokens: Math.max(0, (res.usage?.output_tokens ?? 0) - reasoningTokens),
        reasoningTokens,
      },
      stopReason: res.status === "incomplete" ? res.incomplete_details?.reason ?? "incomplete" : "end_turn",
      latencyMs: Date.now() - t0,
      provider,
      model: req.model,
    };
  } catch (e) {
    if (e instanceof OpenAI.RateLimitError) throw new ProviderError("OpenAI rate limit — try again shortly.", 429);
    if (e instanceof OpenAI.AuthenticationError) throw new ProviderError("OpenAI authentication failed — check the API key on the server.", 502);
    if (e instanceof OpenAI.BadRequestError) throw new ProviderError(`OpenAI rejected the request: ${e.message}`, 400);
    if (e instanceof OpenAI.APIError) throw new ProviderError(`OpenAI API error ${e.status ?? ""}: ${e.message}`, 502);
    throw new ProviderError(`Could not reach OpenAI: ${(e as Error).message}`, 502);
  }
}

async function callCompatible(req: ProviderRequest): Promise<ProviderResult> {
  compatibleClient ??= new OpenAI({ apiKey: process.env.OPENAI_COMPATIBLE_API_KEY || "not-needed", baseURL: process.env.OPENAI_COMPATIBLE_BASE_URL });
  const t0 = Date.now();
  try {
    // Chat Completions is the most widely supported surface on compatible servers
    const res = await compatibleClient.chat.completions.create({
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      temperature: req.temperature,
      max_tokens: req.maxTokens,
    });
    return {
      text: res.choices[0]?.message?.content ?? "",
      usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0, reasoningTokens: 0 },
      stopReason: res.choices[0]?.finish_reason ?? "unknown",
      latencyMs: Date.now() - t0,
      provider: "compatible",
      model: req.model,
    };
  } catch (e) {
    if (e instanceof OpenAI.APIError) throw new ProviderError(`Compatible endpoint error ${e.status ?? ""}: ${e.message}`, 502);
    throw new ProviderError(`Could not reach the compatible endpoint: ${(e as Error).message}`, 502);
  }
}

export async function callProvider(req: ProviderRequest): Promise<ProviderResult> {
  const info = getModel(req.model);
  const provider: ProviderId = info?.provider ?? "compatible";
  switch (provider) {
    case "anthropic":
      return callAnthropic(req);
    case "openai":
      openaiClient ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      return callOpenAIResponses(openaiClient, req, "openai");
    case "compatible":
      return callCompatible(req);
    default:
      throw new ProviderError(`Model ${req.model} is simulated — it runs in the browser, not on the server.`, 400);
  }
}
