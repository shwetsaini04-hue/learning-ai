"use client";

import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfusionMatrix, GroupedBarChart, LineChart } from "@/components/charts/Charts";
import { ModelSelect } from "@/components/ModelSelect";
import { TranscriptPicker, TranscriptView } from "@/components/graph/WorkflowRunner";
import { JsonBlock } from "@/components/learn/JsonView";
import { CodeBlock, Exercise, LessonShell, QuickCheck, Steps, Term, TryIt, WhyCard } from "@/components/learn/Learn";
import { Badge, Button, Callout, Card, Field, Segmented, Select, Slider, Stat } from "@/components/ui";
import { SIMULATED_MODELS } from "@/config/models";
import { invokeLLM } from "@/lib/ai/client";
import { parseStructured } from "@/lib/ai/schema";
import { getPromptVersion, renderPrompt, TASKS } from "@/lib/ai/tasks";
import { INTENTS, transcriptToText } from "@/lib/domain";
import { binaryMetrics, classificationReport, INVALID } from "@/lib/eval/metrics";
import { checkGroundedness, type ClaimCheck } from "@/lib/eval/similarity";
import { findTranscript, getBenchmark, TRANSCRIPTS } from "@/lib/sim/transcripts";
import { useProgress } from "@/lib/store/progress";
import { cn, fmtPct, freshSeed } from "@/lib/utils";
import { simClassify } from "./widgets/simData";

// ================================================================ B2.1
const ANSWERS: { id: string; text: string; grade: { correct: boolean; relevant: boolean; complete: boolean }; why: string }[] = [
  {
    id: "A",
    text: "The customer is interested in a personal loan and wants the full interest-rate details sent by email. Next step: send the rate details.",
    grade: { correct: true, relevant: true, complete: true },
    why: "States the intent, the product, what they asked for, and the next step — all supported by the call.",
  },
  {
    id: "B",
    text: "The customer is interested in a personal loan.",
    grade: { correct: true, relevant: true, complete: false },
    why: "True and on-topic, but omits what they asked for (rates) and the next step. A sales agent would miss the follow-up.",
  },
  {
    id: "C",
    text: "FinServe personal loans start at 10.75% for salaried customers and can be approved within 48 hours.",
    grade: { correct: false, relevant: false, complete: false },
    why: "Describes the product, not the customer. And “approved within 48 hours” was never said — an unsupported claim.",
  },
  {
    id: "D",
    text: "The customer is not interested; they only wanted to compare rates. Next step: close the lead.",
    grade: { correct: false, relevant: true, complete: true },
    why: "Answers both parts of the question (relevant, complete) — but gets the intent wrong. Complete and relevant is not the same as right.",
  },
];

function GradeAnswers() {
  const [marks, setMarks] = useState<Record<string, { correct: boolean; relevant: boolean; complete: boolean }>>(
    Object.fromEntries(ANSWERS.map((a) => [a.id, { correct: false, relevant: false, complete: false }])),
  );
  const [checked, setChecked] = useState(false);
  const score = ANSWERS.reduce((acc, a) => acc + (["correct", "relevant", "complete"] as const).filter((k) => marks[a.id][k] === a.grade[k]).length, 0);
  return (
    <Card className="my-6 p-4">
      <div className="mb-2 text-sm text-ink-2">
        <strong className="text-ink">Question:</strong> “Summarize what the customer wants and the next step.” — for this call:
      </div>
      <TranscriptView id="t01" showNote={false} />
      <div className="mt-4 flex flex-col gap-2">
        {ANSWERS.map((a) => (
          <div key={a.id} className="rounded-lg border border-line p-3">
            <div className="mb-2 flex gap-2 text-sm">
              <Badge tone="accent">{a.id}</Badge>
              <span className="text-ink">{a.text}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["correct", "relevant", "complete"] as const).map((k) => {
                const on = marks[a.id][k];
                const right = checked && on === a.grade[k];
                const wrong = checked && on !== a.grade[k];
                return (
                  <button
                    key={k}
                    disabled={checked}
                    onClick={() => setMarks((m) => ({ ...m, [a.id]: { ...m[a.id], [k]: !m[a.id][k] } }))}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs font-medium",
                      on ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-3",
                      right && "ring-2 ring-good/60",
                      wrong && "ring-2 ring-bad/60",
                    )}
                  >
                    {on ? "✓" : "✗"} {k}
                  </button>
                );
              })}
            </div>
            {checked && (
              <div className="mt-2 text-xs text-ink-2">
                <strong className="text-ink">Expert grading:</strong> {(["correct", "relevant", "complete"] as const).map((k) => `${a.grade[k] ? "✓" : "✗"} ${k}`).join(" · ")} — {a.why}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        {!checked ? (
          <Button variant="primary" onClick={() => setChecked(true)}>
            Compare with expert grading
          </Button>
        ) : (
          <>
            <Badge tone={score >= 10 ? "good" : "warn"}>
              {score} / 12 judgments match
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => setChecked(false)}>
              Try again
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

export default function CorrectnessRelevance() {
  return (
    <LessonShell id="b2-correctness-relevance">
      <p>
        “Is this answer good?” is really several separate questions. Mixing them up is how teams end up arguing about vibes. Three of the most useful, for any generated text:
      </p>
      <div className="my-4 grid gap-2 sm:grid-cols-3">
        {[
          ["Correctness", "Is what it says right?", "Correctness"],
          ["Relevance", "Does it answer the question that was asked?", "Relevance"],
          ["Completeness", "Does it include everything important?", "Completeness"],
        ].map(([t, d, term]) => (
          <div key={t} className="rounded-xl border border-line bg-surface p-3">
            <div className="text-sm font-semibold text-ink">
              <Term t={term}>{t}</Term>
            </div>
            <div className="text-xs text-ink-2">{d}</div>
          </div>
        ))}
      </div>
      <h2>Grade four answers</h2>
      <p>Toggle each dimension for each answer, then compare with an expert. Notice how the dimensions vary independently.</p>
      <GradeAnswers />
      <WhyCard
        what={<>Independent quality dimensions. Correctness compares to ground truth; relevance compares to the question; completeness compares to a checklist of must-have facts.</>}
        why={<>A single “quality score” hides WHY an output is bad — and therefore how to fix it (prompt? retrieval? model?).</>}
        when={<>Correctness for every labeled field. Relevance and completeness for free-text outputs (summaries, notes, replies).</>}
        whenNot={<>Don't grade labels on “relevance” — a label is either the right label or not.</>}
        how={<>Correctness: exact/normalized match or rubric. Completeness: a list of required facts per example (“mentions rate request”, “states next step”). Relevance: rubric or judge.</>}
        real={<>CRM summaries are graded on: correct intent, mentions every requested_info item (completeness), no unsupported claims (groundedness), ≤ 3 sentences.</>}
      />
      <QuickCheck
        q={{
          id: "b2c",
          scenario: "Summaries are almost always correct, but sales says they're useless.",
          question: "Which dimension is most likely failing?",
          options: [
            { text: "Correctness", why: "The scenario says they're correct." },
            { text: "Completeness or relevance — they omit what agents need (asked-for info, next step)", correct: true, why: "Correct-but-useless usually means missing the facts that matter to the reader." },
            { text: "Latency", why: "Not a quality dimension of the text." },
          ],
          takeaway: "Define what 'useful' means as concrete, checkable criteria.",
        }}
      />
    </LessonShell>
  );
}

// ================================================================ B2.2
function ClaimChecker() {
  const [tid, setTid] = useState("t04");
  const [model, setModel] = useState("sim:pico-s");
  const [version, setVersion] = useState("v1");
  const [temp, setTemp] = useState(0.7);
  const [summary, setSummary] = useState<string | null>(null);
  const [claims, setClaims] = useState<ClaimCheck[]>([]);
  const [batch, setBatch] = useState<{ key: string; rate: number; n: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const bump = useProgress((s) => s.bump);
  const summarizeOnce = async (id: string, runIndex: number, v: string, m: string) => {
    const t = findTranscript(id)!;
    const text = transcriptToText(t);
    const pv = getPromptVersion("summarize", v)!;
    const res = await invokeLLM({ model: m, system: pv.system, prompt: renderPrompt(pv.user, { transcript: text }), temperature: temp, maxTokens: 400, task: "summarize", promptVersion: v, sim: { transcript: text, transcriptId: id, runIndex } });
    const p = parseStructured(res.text, TASKS.summarize.schema);
    const s = p.ok ? String(p.value!.summary) : res.text;
    return { s, checks: checkGroundedness(s, text) };
  };
  const one = async () => {
    setBusy(true);
    try {
      const r = await summarizeOnce(tid, freshSeed(10000), version, model);
      setSummary(r.s);
      setClaims(r.checks);
      bump("groundedness_checks");
    } catch (e) {
      setSummary(`Error: ${(e as Error).message}`);
      setClaims([]);
    }
    setBusy(false);
  };
  const many = async () => {
    setBusy(true);
    const out: { key: string; rate: number; n: number }[] = [];
    for (const v of ["v1", "v2"]) {
      let bad = 0;
      let n = 0;
      for (const [i, t] of TRANSCRIPTS.entries()) {
        const r = await summarizeOnce(t.id, 500 + i, v, model);
        n++;
        if (r.checks.some((c) => !c.supported)) bad++;
      }
      out.push({ key: `${model.replace("sim:", "")} · ${v.toUpperCase()}`, rate: bad / n, n });
    }
    setBatch(out);
    setBusy(false);
  };
  return (
    <Card className="my-6 p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Transcript" className="sm:col-span-2">
          <TranscriptPicker value={tid} onChange={setTid} allowCustom={false} />
        </Field>
        <Field label="Model">
          <ModelSelect value={model} onChange={setModel} />
        </Field>
        <Field label="Prompt">
          <Segmented size="sm" value={version} onChange={setVersion} options={[{ id: "v1", label: "V1 free" }, { id: "v2", label: "V2 grounded" }]} />
        </Field>
      </div>
      <Slider className="mt-3" label="Temperature" value={temp} onChange={setTemp} min={0} max={1.2} step={0.1} format={(v) => v.toFixed(1)} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={one} disabled={busy} icon={<Play className="h-4 w-4" />}>
          Generate & check a summary
        </Button>
        <Button onClick={many} disabled={busy}>
          Hallucination rate over 30 calls (V1 vs V2)
        </Button>
      </div>
      {summary && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <TranscriptView id={tid} showNote={false} />
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Summary, claim by claim</div>
            {claims.map((c, i) => (
              <div key={i} className={cn("rounded-lg border px-3 py-2 text-sm", c.supported ? "border-good/40 bg-good-soft" : "border-bad/40 bg-bad-soft")}>
                <div className="text-ink">{c.claim}</div>
                <div className="mt-0.5 text-xs text-ink-2">
                  {c.supported ? "✓ supported" : "✗ unsupported"} — {c.reason}
                </div>
              </div>
            ))}
            {!claims.length && <JsonBlock value={summary} />}
          </div>
        </div>
      )}
      {batch.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Share of summaries with ≥ 1 unsupported claim</div>
          <GroupedBarChart groups={batch.map((b) => b.key)} series={[{ label: "hallucination rate", values: batch.map((b) => b.rate) }]} max={Math.max(0.3, ...batch.map((b) => b.rate))} format={(v) => fmtPct(v, 0)} height={180} />
        </div>
      )}
      <p className="mt-3 text-xs text-ink-3">
        The checker here is a transparent heuristic (numbers, dates and commitments must appear in the transcript; content must overlap). Production systems use an NLI model or an LLM judge
        per claim — which must itself be validated.
      </p>
    </Card>
  );
}

export function Groundedness() {
  return (
    <LessonShell id="b2-groundedness">
      <p>
        A summary can be fluent, relevant and <em>wrong</em> in the most dangerous way: by adding facts that were never said. <Term>Groundedness</Term> (faithfulness) asks, for every
        claim: <strong>can I point to where the source says that?</strong> A claim you can&apos;t support is a <Term>Hallucination</Term>.
      </p>
      <ClaimChecker />
      <Callout kind="tip" title="Try this">
        Pico-S + V1 at temperature 0.7 invents rates, dates and promises. Switch to V2 (“only facts stated in the transcript”) and re-run the 30-call comparison. Then try Atlas-L.
      </Callout>
      <WhyCard
        what={<>The fraction of claims in an output that are supported by the provided source (transcript, retrieved documents).</>}
        why={<>An invented “the agent confirmed 10.25%” in a CRM note can become a promise the bank didn't make — a compliance incident.</>}
        when={<>Summaries, notes, RAG answers, agent drafts — anything generated from a source.</>}
        whenNot={<>Pure classification labels (use correctness), or creative text where invention is the point.</>}
        how={<>Split output into atomic claims → check each against the source (NLI / LLM judge / rules for numbers &amp; dates) → report % supported and the unsupported claims.</>}
        real={<>Every CRM note gets a groundedness score; notes below 100% are shown to the agent with the unsupported sentence highlighted before saving.</>}
      />
      <CodeBlock
        tabs={[
          {
            label: "claim-level judge (sketch)",
            code: `from pydantic import BaseModel

class ClaimVerdict(BaseModel):
    claim: str
    supported: bool
    evidence: str | None      # quote from the transcript, or None

class GroundednessReport(BaseModel):
    verdicts: list[ClaimVerdict]

judge = init_chat_model("anthropic:claude-sonnet-5").with_structured_output(GroundednessReport)
report = judge.invoke(
    "Split the SUMMARY into atomic claims. For each, quote the TRANSCRIPT evidence "
    "or mark it unsupported. Do not use outside knowledge.\\n\\n"
    f"TRANSCRIPT:\\n{transcript}\\n\\nSUMMARY:\\n{summary}"
)
groundedness = sum(v.supported for v in report.verdicts) / len(report.verdicts)`,
          },
        ]}
      />
    </LessonShell>
  );
}

// ================================================================ B2.3
function ConsistencySampler() {
  const [tid, setTid] = useState("t20");
  const [model, setModel] = useState("sim:swift-m");
  const [temp, setTemp] = useState(0.8);
  const [n, setN] = useState(15);
  const [out, setOut] = useState<{ labels: string[]; valid: number } | null>(null);
  const [sweep, setSweep] = useState<{ t: number; agree: number; valid: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const sample = async (t: number, k: number) => {
    const tr = findTranscript(tid)!;
    const text = transcriptToText(tr);
    const pv = getPromptVersion("classify_intent", "v2")!;
    const labels: string[] = [];
    let valid = 0;
    for (let i = 0; i < k; i++) {
      const res = await invokeLLM({ model, system: pv.system, prompt: renderPrompt(pv.user, { transcript: text }), temperature: t, maxTokens: 256, task: "classify_intent", promptVersion: "v2", sim: { transcript: text, transcriptId: tid, runIndex: 900 + i } });
      const p = parseStructured(res.text, TASKS.classify_intent.schema);
      if (p.ok) valid++;
      labels.push(p.ok ? String(p.value!.intent) : "invalid");
    }
    return { labels, valid };
  };
  const agreement = (labels: string[]) => {
    const c: Record<string, number> = {};
    labels.forEach((l) => (c[l] = (c[l] ?? 0) + 1));
    return Math.max(...Object.values(c)) / labels.length;
  };
  const run = async () => {
    setBusy(true);
    setOut(await sample(temp, n));
    setBusy(false);
  };
  const runSweep = async () => {
    setBusy(true);
    const res: { t: number; agree: number; valid: number }[] = [];
    for (const t of [0, 0.3, 0.6, 0.9, 1.2]) {
      const s = await sample(t, 12);
      res.push({ t, agree: agreement(s.labels), valid: s.valid / 12 });
    }
    setSweep(res);
    setBusy(false);
  };
  const dist = out ? out.labels.reduce<Record<string, number>>((a, l) => ((a[l] = (a[l] ?? 0) + 1), a), {}) : {};
  const majority = out ? Object.entries(dist).sort((a, b) => b[1] - a[1])[0] : null;
  return (
    <Card className="my-6 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Transcript">
          <TranscriptPicker value={tid} onChange={setTid} allowCustom={false} />
        </Field>
        <Field label="Model">
          <ModelSelect value={model} onChange={setModel} />
        </Field>
        <Slider label="Samples" value={n} onChange={setN} min={5} max={30} step={1} format={(v) => String(v)} />
      </div>
      <Slider className="mt-3" label="Temperature" value={temp} onChange={setTemp} min={0} max={1.5} step={0.1} format={(v) => v.toFixed(1)} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={run} disabled={busy} icon={<Play className="h-4 w-4" />}>
          Sample {n}×
        </Button>
        <Button onClick={runSweep} disabled={busy}>
          Sweep temperature 0 → 1.2
        </Button>
      </div>
      {out && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {out.labels.map((l, i) => (
              <span key={i} className={cn("rounded-md px-2 py-1 font-mono text-[11px]", l === "invalid" ? "bg-bad-soft text-bad-ink" : l === majority?.[0] ? "bg-accent-soft text-ink" : "bg-warn-soft text-warn-ink")}>
                {l}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Agreement (majority share)" value={fmtPct(agreement(out.labels), 0)} tone={agreement(out.labels) > 0.9 ? "good" : "warn"} />
            <Stat label="Validity rate" value={fmtPct(out.valid / out.labels.length, 0)} />
            <Stat label="Majority vote" value={majority?.[0] ?? "—"} sub={`gold: ${findTranscript(tid)!.labels.intent}`} />
          </div>
        </div>
      )}
      {sweep.length > 0 && (
        <div className="mt-4">
          <LineChart
            xs={sweep.map((s) => s.t)}
            series={[
              { label: "agreement", values: sweep.map((s) => s.agree) },
              { label: "validity", values: sweep.map((s) => s.valid) },
            ]}
            yMax={1}
            formatX={(v) => `T=${v}`}
            formatY={(v) => fmtPct(v, 0)}
            height={200}
          />
        </div>
      )}
    </Card>
  );
}

export function ValidityConsistency() {
  return (
    <LessonShell id="b2-structured-consistency">
      <Steps items={["Validity", "Consistency", "Temperature", "Self-consistency"]} />
      <p>
        Two cheap, automatic, high-value metrics. <strong>Validity</strong>: what share of outputs pass the schema? <Term>Consistency</Term>: does the same input give the same answer?
        Neither needs ground truth — you can compute both on production traffic.
      </p>
      <h2>Ask the same question many times</h2>
      <p>t20 is a borderline call. Sample it at temperature 0, then 0.8. Then sweep temperature and watch agreement and validity fall.</p>
      <ConsistencySampler />
      <WhyCard
        what={<>Validity = % outputs that parse and pass the schema. Consistency = agreement across repeated runs on the same input.</>}
        why={<>Invalid outputs crash pipelines or silently drop data; inconsistent outputs make every single-run metric noisy and erode user trust.</>}
        when={<>Validity: always, in CI and in production monitoring. Consistency: when choosing temperature, comparing models, or estimating uncertainty.</>}
        whenNot={<>Don't mistake consistency for correctness: a model can be consistently wrong (t05 at temperature 0).</>}
        how={<>Run N samples → majority share = agreement. <strong>Self-consistency</strong>: use the majority vote as the answer and the agreement as a confidence signal (costs N× calls).</>}
        real={<>Monitoring shows invalid-output rate 0.4% → suddenly 3% after a provider model update: an alert fires before any user notices.</>}
      />
      <CodeBlock
        tabs={[
          {
            label: "measure it",
            code: `from collections import Counter

def consistency(classify, transcript: str, n: int = 10) -> tuple[str, float]:
    labels = [classify(transcript).intent for _ in range(n)]      # n API calls!
    label, count = Counter(labels).most_common(1)[0]
    return label, count / n          # majority vote + agreement

def validity_rate(raw_outputs: list[str]) -> float:
    ok = 0
    for raw in raw_outputs:
        try:
            IntentResult.model_validate_json(raw); ok += 1
        except ValidationError:
            pass
    return ok / len(raw_outputs)`,
          },
        ]}
      />
    </LessonShell>
  );
}

// ================================================================ B2.4
function ConfusionLab() {
  const [model, setModel] = useState("sim:pico-s");
  const [version, setVersion] = useState("v2");
  const [cell, setCell] = useState<{ a: number; p: number } | null>(null);
  const [threshold, setThreshold] = useState(0);
  const data = useMemo(() => simClassify(model, version, getBenchmark()), [model, version]);
  const report = useMemo(() => classificationReport(data.map((d) => ({ expected: d.gold, predicted: d.pred })), [...INTENTS]), [data]);
  const predLabel = (p: string | null) => (p && (INTENTS as readonly string[]).includes(p) ? p : INVALID);
  const cellItems = cell ? data.filter((d) => d.gold === report.labels[cell.a] && predLabel(d.pred) === report.predictedLabels[cell.p]) : [];
  // binary view: positive = interested, accept only if confidence >= threshold
  const bin = (t: number) => {
    let tp = 0,
      fp = 0,
      fn = 0,
      tn = 0;
    data.forEach((d) => {
      const predPos = d.pred === "interested" && (d.confidence ?? 0) >= t;
      const pos = d.gold === "interested";
      if (predPos && pos) tp++;
      else if (predPos && !pos) fp++;
      else if (!predPos && pos) fn++;
      else tn++;
    });
    return { tp, fp, fn, tn, ...binaryMetrics(tp, fp, fn, tn) };
  };
  const b = bin(threshold);
  const xs = [0, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
  const curve = xs.map(bin);
  return (
    <Card className="my-6 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Model (simulated)">
          <Select value={model} onChange={(v) => { setModel(v); setCell(null); }} options={SIMULATED_MODELS.map((m) => ({ value: m.id, label: m.label }))} />
        </Field>
        <Field label="Prompt version">
          <Segmented size="sm" value={version} onChange={(v) => { setVersion(v); setCell(null); }} options={["v1", "v2", "v3", "v4"].map((v) => ({ id: v, label: v.toUpperCase() }))} />
        </Field>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Confusion matrix · 120 benchmark calls · click a cell</div>
          <ConfusionMatrix labels={report.labels} predictedLabels={report.predictedLabels} matrix={report.matrix} onCell={(a, p) => setCell({ a, p })} selected={cell} />
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Per-class metrics</div>
          <table className="w-full text-xs">
            <thead className="text-ink-3">
              <tr className="border-b border-line">
                <th className="py-1 text-left font-medium">class</th>
                <th className="py-1 pl-3 text-right font-medium">precision</th>
                <th className="py-1 pl-3 text-right font-medium">recall</th>
                <th className="py-1 pl-3 text-right font-medium">F1</th>
                <th className="py-1 pl-3 text-right font-medium">support</th>
              </tr>
            </thead>
            <tbody>
              {report.perClass.map((c) => (
                <tr key={c.label} className="border-b border-line/60">
                  <td className="py-1.5 font-mono text-ink">{c.label}</td>
                  <td className="num py-1.5 pl-3 text-right font-mono">{c.precision.toFixed(3)}</td>
                  <td className="num py-1.5 pl-3 text-right font-mono">{c.recall.toFixed(3)}</td>
                  <td className="num py-1.5 pl-3 text-right font-mono font-semibold text-ink">{c.f1.toFixed(3)}</td>
                  <td className="num py-1.5 pl-3 text-right font-mono text-ink-3">{c.support}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="Accuracy" value={fmtPct(report.accuracy)} />
            <Stat label="Macro F1" value={report.macroF1.toFixed(3)} />
            <Stat label="Invalid" value={report.invalid} />
          </div>
        </div>
      </div>
      {cell && (
        <div className="mt-4 rounded-lg border border-line p-3">
          <div className="mb-2 text-xs text-ink-3">
            actual <span className="font-mono text-ink">{report.labels[cell.a]}</span> · predicted <span className="font-mono text-ink">{report.predictedLabels[cell.p]}</span> — {cellItems.length} calls
          </div>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {cellItems.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-ink-3">{d.id}</span>
                <span className="flex-1 truncate text-ink-2">{findTranscript(d.id)!.turns.filter((t) => t.speaker === "Customer").slice(-1)[0]?.text}</span>
                {d.tags.slice(0, 2).map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
                <span className="font-mono text-ink-3">{d.confidence ?? "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-2 text-sm font-semibold text-ink">Binary view: “interested” leads sent to sales</div>
        <Slider label="Only send if confidence ≥" value={threshold} onChange={setThreshold} min={0} max={0.95} step={0.05} format={(v) => v.toFixed(2)} />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="TP" value={b.tp} sub="real leads sent" />
          <Stat label="FP" value={b.fp} sub="junk leads sent" tone={b.fp ? "bad" : undefined} />
          <Stat label="FN" value={b.fn} sub="real leads missed" tone={b.fn ? "warn" : undefined} />
          <Stat label="Precision" value={b.precision.toFixed(3)} />
          <Stat label="Recall" value={b.recall.toFixed(3)} />
        </div>
        <div className="mt-3">
          <LineChart xs={xs} series={[{ label: "precision", values: curve.map((c) => c.precision) }, { label: "recall", values: curve.map((c) => c.recall) }, { label: "F1", values: curve.map((c) => c.f1) }]} yMin={0} yMax={1} formatX={(v) => `≥${v}`} formatY={(v) => v.toFixed(2)} height={200} xLabel="confidence threshold" />
        </div>
      </div>
    </Card>
  );
}

export function ClassificationMetrics() {
  return (
    <LessonShell id="b2-classification-metrics">
      <p>
        Transcript intent is a classification problem, so you get classical metrics — and they tell you much more than accuracy. The key question for each class:{" "}
        <strong>when the model says it, is it right?</strong> (<Term>Precision</Term>) and <strong>when it&apos;s true, does the model catch it?</strong> (<Term>Recall</Term>).
      </p>
      <div className="my-4 grid gap-3 md:grid-cols-2">
        <Card className="p-4 text-sm">
          <div className="font-semibold text-ink">For the class “interested” (leads for sales)</div>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-ink-2">
            <li>
              <strong className="text-ink">TP</strong> — said interested, was interested (a real lead)
            </li>
            <li>
              <strong className="text-ink">FP</strong> — said interested, wasn&apos;t (wasted agent time)
            </li>
            <li>
              <strong className="text-ink">FN</strong> — missed an interested customer (lost sale)
            </li>
            <li>
              <strong className="text-ink">Precision</strong> = TP / (TP + FP) · <strong className="text-ink">Recall</strong> = TP / (TP + FN) · <strong className="text-ink">F1</strong> = 2PR / (P + R)
            </li>
          </ul>
        </Card>
        <Card className="p-4 text-sm">
          <div className="font-semibold text-ink">Why not just accuracy?</div>
          <p className="mt-2 text-ink-2">
            If 60% of calls are “not interested”, a model that always says “not interested” scores 60% accuracy and finds zero leads. Per-class metrics and the{" "}
            <Term>Confusion matrix</Term> expose that immediately.
          </p>
        </Card>
      </div>
      <h2>Explore a real (simulated) run</h2>
      <p>
        Start with Pico-S + V2. Click the biggest off-diagonal cell — those are the systematic mistakes. Then switch to V3 and see which cells shrink. Finally, move the confidence slider in
        the binary view: precision rises, recall falls. Where you set it is a business decision.
      </p>
      <ConfusionLab />
      <WhyCard
        what={<>Per-class precision/recall/F1, macro-F1 (unweighted mean over classes) and the confusion matrix (actual × predicted counts).</>}
        why={<>They reveal WHICH errors happen and their business cost — and they're robust to class imbalance where accuracy isn't.</>}
        when={<>Every classification step: intent, product, sentiment, next_action.</>}
        whenNot={<>Free-text outputs (use rubric/groundedness metrics). And don't compare F1 across datasets with different class mixes.</>}
        how={<>Collect (expected, predicted) pairs; count; compute. Treat invalid outputs as errors (their own column) — never silently drop them.</>}
        real={<>“Precision for interested = 0.84, recall = 0.88. Most FPs are callbacks (‘call me after 6’) labeled interested → add guideline + examples to the prompt.”</>}
      />
      <CodeBlock
        tabs={[
          {
            label: "scikit-learn",
            code: `from sklearn.metrics import classification_report, confusion_matrix

labels = ["interested", "not_interested", "unclear"]
y_true = [ex["expected"]["intent"] for ex in dataset]
y_pred = [pred or "invalid" for pred in predictions]      # keep failures visible!

print(classification_report(y_true, y_pred, labels=labels, digits=3, zero_division=0))
print(confusion_matrix(y_true, y_pred, labels=labels + ["invalid"]))`,
          },
        ]}
      />
      <Exercise id="ex-prf-by-hand" />
      <TryIt title="Run a full experiment" href="/lab/experiments" cta="Open Experiments">
        Pick a dataset, model and prompt version; get P/R/F1, latency percentiles, cost and an error-analysis table.
      </TryIt>
    </LessonShell>
  );
}
