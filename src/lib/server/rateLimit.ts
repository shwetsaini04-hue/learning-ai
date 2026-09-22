import "server-only";

/**
 * Best-effort in-memory limits. On serverless platforms (e.g. Vercel) each
 * instance has its own memory, so treat these as a guard rail, not a quota
 * system. For hard guarantees use a shared store (e.g. Upstash Redis / Vercel KV)
 * and provider-side spend limits.
 */

const windows = new Map<string, number[]>();
let day = new Date().toISOString().slice(0, 10);
let dailyCount = 0;

export function checkRate(key: string, perMinute: number, dailyLimit: number): { ok: true } | { ok: false; reason: string; retryAfter: number } {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    dailyCount = 0;
  }
  if (dailyCount >= dailyLimit) return { ok: false, reason: `Daily request limit (${dailyLimit}) reached on this server instance.`, retryAfter: 3600 };
  const list = (windows.get(key) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= perMinute) {
    const retryAfter = Math.ceil((60_000 - (now - list[0])) / 1000);
    return { ok: false, reason: `Rate limit: ${perMinute} requests per minute.`, retryAfter };
  }
  list.push(now);
  windows.set(key, list);
  dailyCount++;
  if (windows.size > 5000) {
    for (const [k, v] of windows) if (!v.some((t) => now - t < 60_000)) windows.delete(k);
  }
  return { ok: true };
}
