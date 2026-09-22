import { allowedModels, checkToken, liveEnabled, serverLimits } from "@/lib/server/config";
import { callProvider, ProviderError } from "@/lib/server/providers";
import { checkRate } from "@/lib/server/rateLimit";

/**
 * POST /api/llm — the only place the app talks to real model providers.
 * Guards: live mode enabled, optional access token, model allowlist,
 * input size cap, output token cap, per-IP rate limit, daily cap.
 */
export async function POST(req: Request) {
  if (!liveEnabled()) {
    return Response.json({ error: "Live mode is not configured on this server (no provider API keys, or LIVE_LLM_ENABLED=false)." }, { status: 503 });
  }
  if (!checkToken(req.headers.get("x-lab-token"))) {
    return Response.json({ error: "This deployment requires a lab access token. Add it in Settings." }, { status: 401 });
  }
  let body: { model?: unknown; system?: unknown; prompt?: unknown; temperature?: unknown; maxTokens?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const model = typeof body.model === "string" ? body.model : "";
  const system = typeof body.system === "string" ? body.system : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const temperature = typeof body.temperature === "number" && body.temperature >= 0 && body.temperature <= 2 ? body.temperature : 0;
  const limits = serverLimits();
  const maxTokens = Math.min(limits.maxOutputTokens, typeof body.maxTokens === "number" && body.maxTokens > 0 ? Math.floor(body.maxTokens) : 512);

  if (!allowedModels().includes(model)) {
    return Response.json({ error: `Model "${model}" is not enabled on this server.` }, { status: 400 });
  }
  if (!prompt.trim()) return Response.json({ error: "Empty prompt." }, { status: 400 });
  if (system.length + prompt.length > limits.maxInputChars) {
    return Response.json({ error: `Input too large: ${system.length + prompt.length} chars (limit ${limits.maxInputChars}).` }, { status: 413 });
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const rate = checkRate(ip, limits.ratePerMinute, limits.dailyRequests);
  if (!rate.ok) {
    return Response.json({ error: rate.reason }, { status: 429, headers: { "retry-after": String(rate.retryAfter) } });
  }

  try {
    const out = await callProvider({ model, system, prompt, temperature, maxTokens });
    return Response.json(out, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof ProviderError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status });
  }
}
