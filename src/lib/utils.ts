import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

let counter = 0;
export function uid(prefix = "id") {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Rough token estimate (~4 chars/token for English). Real tokenizers differ per model. */
export function estimateTokens(text: string) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function fmtUsd(n: number, opts: { precise?: boolean } = {}) {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "$0";
  if (abs < 0.01 || (opts.precise && abs < 1)) {
    // two significant digits for tiny per-call costs, e.g. $0.000084
    if (abs < 0.001) return `$${Number(n.toPrecision(2)).toFixed(Math.min(10, Math.max(4, 1 - Math.floor(Math.log10(abs)))))}`;
    return `$${n.toFixed(4)}`;
  }
  if (abs < 1000) return `$${n.toFixed(2)}`;
  if (abs < 1_000_000) return `$${(n / 1000).toFixed(abs < 10_000 ? 2 : 1)}K`;
  return `$${(n / 1_000_000).toFixed(2)}M`;
}

export function fmtMs(ms: number) {
  if (!isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function fmtInt(n: number) {
  if (!isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtCompact(n: number) {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n * 100) / 100);
  if (abs < 1_000_000) return `${(n / 1000).toFixed(abs < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function fmtPct(n: number, digits = 1) {
  if (!isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function deepClone<T>(v: T): T {
  if (v === undefined) return v;
  return JSON.parse(JSON.stringify(v)) as T;
}

export function stableStringify(v: unknown, indent = 2): string {
  return JSON.stringify(v, null, indent);
}

export function snakeCase(s: string) {
  return s
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}

export function download(filename: string, content: string, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A fresh run index for sampling (varies between clicks; only matters when temperature > 0). */
export function freshSeed(mod = 100_000) {
  return Date.now() % mod;
}
