import { mean, percentile } from "@/lib/utils";

export interface ClassMetrics {
  label: string;
  tp: number;
  fp: number;
  fn: number;
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ClassificationReport {
  labels: string[];
  /** matrix[actualIndex][predictedIndex]; predicted includes an extra "invalid" column when present */
  matrix: number[][];
  predictedLabels: string[];
  accuracy: number;
  perClass: ClassMetrics[];
  macroF1: number;
  weightedF1: number;
  macroPrecision: number;
  macroRecall: number;
  total: number;
  correct: number;
  invalid: number;
}

export const INVALID = "∅ invalid";

/**
 * Multi-class report. Invalid/unparseable predictions (null) count as wrong
 * and appear as their own column — they are errors, not "skip".
 */
export function classificationReport(pairs: { expected: string; predicted: string | null }[], labels: string[]): ClassificationReport {
  const hasInvalid = pairs.some((p) => p.predicted === null || !labels.includes(p.predicted));
  const predictedLabels = hasInvalid ? [...labels, INVALID] : [...labels];
  const matrix = labels.map(() => predictedLabels.map(() => 0));
  let correct = 0;
  let invalid = 0;
  for (const { expected, predicted } of pairs) {
    const ai = labels.indexOf(expected);
    if (ai === -1) continue;
    const pv = predicted !== null && labels.includes(predicted) ? predicted : INVALID;
    if (pv === INVALID) invalid++;
    const pi = predictedLabels.indexOf(pv);
    matrix[ai][pi]++;
    if (pv === expected) correct++;
  }
  const total = pairs.filter((p) => labels.includes(p.expected)).length;
  const perClass: ClassMetrics[] = labels.map((label, i) => {
    const tp = matrix[i][i];
    const fn = matrix[i].reduce((a, b) => a + b, 0) - tp;
    const fp = labels.reduce((acc, _, r) => acc + (r === i ? 0 : matrix[r][i]), 0);
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { label, tp, fp, fn, support: tp + fn, precision, recall, f1 };
  });
  const withSupport = perClass.filter((c) => c.support > 0);
  const macroF1 = withSupport.length ? mean(withSupport.map((c) => c.f1)) : 0;
  const macroPrecision = withSupport.length ? mean(withSupport.map((c) => c.precision)) : 0;
  const macroRecall = withSupport.length ? mean(withSupport.map((c) => c.recall)) : 0;
  const weightedF1 = total ? perClass.reduce((a, c) => a + c.f1 * c.support, 0) / total : 0;
  return {
    labels,
    matrix,
    predictedLabels,
    accuracy: total ? correct / total : 0,
    perClass,
    macroF1,
    weightedF1,
    macroPrecision,
    macroRecall,
    total,
    correct,
    invalid,
  };
}

/** Binary metrics for one positive class (e.g. "interested" leads). */
export function binaryMetrics(tp: number, fp: number, fn: number, tn: number) {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const accuracy = tp + fp + fn + tn === 0 ? 0 : (tp + tn) / (tp + fp + fn + tn);
  return { precision, recall, f1, accuracy };
}

/** Cohen's kappa: agreement between two annotators beyond chance. */
export function cohensKappa(a: string[], b: string[], labels: string[]) {
  const n = Math.min(a.length, b.length);
  if (!n) return { kappa: 0, observed: 0, expected: 0 };
  let agree = 0;
  const ca = new Map<string, number>();
  const cb = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    ca.set(a[i], (ca.get(a[i]) ?? 0) + 1);
    cb.set(b[i], (cb.get(b[i]) ?? 0) + 1);
  }
  const po = agree / n;
  const pe = labels.reduce((acc, l) => acc + ((ca.get(l) ?? 0) / n) * ((cb.get(l) ?? 0) / n), 0);
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { kappa, observed: po, expected: pe };
}

export function kappaLabel(k: number) {
  if (k < 0) return "worse than chance";
  if (k < 0.2) return "slight";
  if (k < 0.4) return "fair";
  if (k < 0.6) return "moderate";
  if (k < 0.8) return "substantial";
  return "almost perfect";
}

export function latencyStats(values: number[]) {
  return {
    mean: mean(values),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length ? Math.max(...values) : 0,
  };
}

/** Pearson correlation — used to validate an LLM judge against human scores. */
export function pearson(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/** Wilson score interval: how uncertain is an accuracy measured on n examples? */
export function wilsonInterval(successes: number, n: number, z = 1.96) {
  if (!n) return { low: 0, high: 0 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}
