import "server-only";
import { LIVE_MODELS } from "@/config/models";

/**
 * Server-side configuration. Secrets are read from environment variables and
 * NEVER sent to the browser. /api/config only reports booleans and limits.
 */

function num(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function serverLimits() {
  return {
    maxInputChars: num("MAX_INPUT_CHARS", 16_000),
    maxOutputTokens: num("MAX_OUTPUT_TOKENS", 1024),
    ratePerMinute: num("RATE_LIMIT_PER_MINUTE", 20),
    dailyRequests: num("DAILY_REQUEST_LIMIT", 500),
  };
}

export function providersConfigured() {
  return {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    compatible: !!process.env.OPENAI_COMPATIBLE_BASE_URL && !!process.env.OPENAI_COMPATIBLE_MODELS,
  };
}

export function compatibleModels(): string[] {
  return (process.env.OPENAI_COMPATIBLE_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function liveEnabled() {
  const p = providersConfigured();
  return process.env.LIVE_LLM_ENABLED !== "false" && (p.anthropic || p.openai || p.compatible);
}

export function allowedModels(): string[] {
  const p = providersConfigured();
  return [
    ...LIVE_MODELS.filter((m) => (m.provider === "anthropic" && p.anthropic) || (m.provider === "openai" && p.openai)).map((m) => m.id),
    ...(p.compatible ? compatibleModels() : []),
  ];
}

export function requiresToken() {
  return !!process.env.LAB_ACCESS_TOKEN;
}

export function checkToken(header: string | null) {
  const expected = process.env.LAB_ACCESS_TOKEN;
  if (!expected) return true;
  if (!header || header.length !== expected.length) return false;
  // constant-time-ish comparison
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}
