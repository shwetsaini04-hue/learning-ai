"use client";

import { useMemo, useState } from "react";
import { HBarChart } from "@/components/charts/Charts";
import { Badge, Card, Field, Pill, TextArea } from "@/components/ui";
import { exactMatch, normalizedMatch, rougeL, semanticSimilarity, tokenF1 } from "@/lib/eval/similarity";

export const PAIRS: { id: string; label: string; expected: string; actual: string; lesson: string }[] = [
  { id: "label", label: "Same label", expected: "interested", actual: "interested", lesson: "Labels: exact match is perfect." },
  { id: "case", label: "Label, different case", expected: "not_interested", actual: "Not Interested", lesson: "Exact match says 0. Normalized match fixes formatting noise." },
  {
    id: "para",
    label: "Paraphrase",
    expected: "Customer is interested in a personal loan.",
    actual: "The customer wants to know more about getting a personal loan.",
    lesson: "Same meaning, different words. Exact match fails; token overlap is middling; semantic similarity is high.",
  },
  {
    id: "neg",
    label: "Negation trap",
    expected: "The customer is interested in a personal loan.",
    actual: "The customer is not interested in a personal loan.",
    lesson: "Opposite meaning, 90% shared words. Token F1 and ROUGE are fooled; a meaning-aware metric (or judge) must catch the negation.",
  },
  {
    id: "fluent",
    label: "Fluent but vague",
    expected: "Customer is interested; wants the interest rate details by email.",
    actual: "The call covered personal loan products and interest rates in a friendly manner.",
    lesson: "Topically similar, so similarity metrics look OK — but it never says the customer is interested. Similarity ≠ correctness.",
  },
];

export function MetricComparer({ compact }: { compact?: boolean }) {
  const [sel, setSel] = useState("para");
  const preset = PAIRS.find((p) => p.id === sel);
  const [expected, setExpected] = useState(preset?.expected ?? "");
  const [actual, setActual] = useState(preset?.actual ?? "");
  const choose = (id: string) => {
    const p = PAIRS.find((x) => x.id === id)!;
    setSel(id);
    setExpected(p.expected);
    setActual(p.actual);
  };
  const m = useMemo(() => {
    const tf = tokenF1(expected, actual);
    const sem = semanticSimilarity(expected, actual);
    return {
      exact: exactMatch(expected, actual),
      normalized: normalizedMatch(expected, actual),
      tokenF1: tf.f1,
      rouge: rougeL(expected, actual),
      semantic: sem.score,
      sem,
      tf,
    };
  }, [expected, actual]);
  return (
    <Card className="my-6 p-4">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {PAIRS.map((p) => (
          <Pill key={p.id} active={sel === p.id} onClick={() => choose(p.id)}>
            {p.label}
          </Pill>
        ))}
      </div>
      <div className={compact ? "grid gap-3" : "grid gap-3 md:grid-cols-2"}>
        <Field label="Expected (reference)">
          <TextArea rows={2} value={expected} onChange={(e) => { setExpected(e.target.value); setSel(""); }} />
        </Field>
        <Field label="Actual (model output)">
          <TextArea rows={2} value={actual} onChange={(e) => { setActual(e.target.value); setSel(""); }} />
        </Field>
      </div>
      <div className="mt-4">
        <HBarChart
          max={1}
          format={(v) => v.toFixed(2)}
          data={[
            { label: "Exact match", value: m.exact, tooltip: <span className="text-xs">1 only if strings are identical</span> },
            { label: "Normalized match", value: m.normalized, tooltip: <span className="text-xs">ignores case, punctuation, label synonyms</span> },
            { label: "Token F1", value: m.tokenF1, tooltip: <span className="text-xs">overlap of content words</span> },
            { label: "ROUGE-L", value: m.rouge, tooltip: <span className="text-xs">longest common word subsequence</span> },
            { label: "Semantic similarity*", value: m.semantic, tooltip: <span className="text-xs">meaning-level (concept vectors)</span> },
          ]}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
        <span>Concepts detected — expected:</span>
        {m.sem.expectedConcepts.map((c) => (
          <Badge key={c}>{c}</Badge>
        ))}
        <span className="ml-2">actual:</span>
        {m.sem.actualConcepts.map((c) => (
          <Badge key={c} tone={m.sem.expectedConcepts.includes(c) ? "good" : "warn"}>
            {c}
          </Badge>
        ))}
      </div>
      {preset && sel && <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">{preset.lesson}</div>}
      <p className="mt-2 text-[11px] text-ink-3">
        *Simulated embedding similarity: cosine over a transparent concept lexicon (with negation handling) instead of a neural embedding model, so you can see why two texts are “close”.
      </p>
    </Card>
  );
}
