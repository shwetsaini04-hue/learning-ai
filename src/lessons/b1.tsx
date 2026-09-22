"use client";

import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfusionMatrix, HBarChart } from "@/components/charts/Charts";
import { TranscriptView } from "@/components/graph/WorkflowRunner";
import { CodeBlock, Exercise, LessonShell, QuickCheck, Steps, Term, TryIt, WhyCard } from "@/components/learn/Learn";
import { Badge, Button, Callout, Card, Stat } from "@/components/ui";
import { INTENTS, LABELING_GUIDELINES, PRODUCTS, type Intent } from "@/lib/domain";
import { classificationReport, cohensKappa, kappaLabel, wilsonInterval } from "@/lib/eval/metrics";
import { findTranscript, getBenchmark } from "@/lib/sim/transcripts";
import { useProgress } from "@/lib/store/progress";
import { cn, fmtPct } from "@/lib/utils";
import { simClassify } from "./widgets/simData";

// ================================================================ B1.1
function VibeCheck() {
  const [stage, setStage] = useState<"demo" | "verdict" | "eval">("demo");
  const [verdict, setVerdict] = useState<"ship" | "hold" | null>(null);
  const results = useMemo(() => simClassify("sim:pico-s", "v2", getBenchmark()), []);
  const demo = useMemo(() => results.filter((r) => r.correct && r.tags.includes("baseline")).slice(0, 5), [results]);
  const report = useMemo(() => classificationReport(results.map((r) => ({ expected: r.gold, predicted: r.pred })), [...INTENTS]), [results]);
  const tags = useMemo(() => {
    const m = new Map<string, { n: number; ok: number }>();
    results.forEach((r) =>
      r.tags.filter((t) => !(PRODUCTS as readonly string[]).includes(t)).forEach((t) => {
        const c = m.get(t) ?? { n: 0, ok: 0 };
        c.n++;
        if (r.correct) c.ok++;
        m.set(t, c);
      }),
    );
    return [...m.entries()].map(([t, v]) => ({ t, acc: v.ok / v.n, n: v.n })).sort((a, b) => a.acc - b.acc);
  }, [results]);
  const ci = wilsonInterval(5, 5);
  return (
    <Card className="my-6 overflow-hidden">
      <div className="border-b border-line bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink">The demo that went well</div>
      <div className="p-4">
        <p className="mb-3 text-sm text-ink-2">A teammate ran a new, cheap classifier (small model, prompt V2) on five calls and shared the results:</p>
        <div className="flex flex-col gap-1.5">
          {demo.map((d) => {
            const t = findTranscript(d.id)!;
            const cust = t.turns.filter((x) => x.speaker === "Customer").slice(-1)[0]?.text ?? "";
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-ink-2">“{cust}”</span>
                <Badge tone="accent">{d.pred}</Badge>
                <Check className="h-4 w-4 text-good-ink" />
              </div>
            );
          })}
        </div>
        {stage === "demo" && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">5 out of 5 correct. Ship it to 20,000 calls a day?</span>
            <Button variant="primary" size="sm" icon={<ThumbsUp className="h-3.5 w-3.5" />} onClick={() => { setVerdict("ship"); setStage("verdict"); }}>
              Ship it
            </Button>
            <Button size="sm" icon={<ThumbsDown className="h-3.5 w-3.5" />} onClick={() => { setVerdict("hold"); setStage("verdict"); }}>
              Not yet
            </Button>
          </div>
        )}
        {stage !== "demo" && (
          <div className="mt-4 flex flex-col gap-3">
            <Callout kind={verdict === "hold" ? "success" : "warn"} title={verdict === "hold" ? "Good instinct." : "Hmm — let's check first."}>
              With n = 5, a 95% confidence interval on accuracy runs from <strong>{fmtPct(ci.low, 0)}</strong> to <strong>{fmtPct(ci.high, 0)}</strong>. And the five were easy, clear calls.
            </Callout>
            {stage === "verdict" && (
              <Button variant="primary" onClick={() => setStage("eval")} className="self-start">
                Run it on 120 labeled calls
              </Button>
            )}
          </div>
        )}
        {stage === "eval" && (
          <div className="fade-in mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Accuracy" value={fmtPct(report.accuracy)} tone={report.accuracy < 0.8 ? "bad" : "good"} />
              <Stat label="Wrong calls / day" value={Math.round((1 - report.accuracy) * 20000).toLocaleString()} tone="bad" sub="at 20K calls/day" />
              <Stat label="Invalid outputs" value={report.invalid} />
              <Stat label="Macro F1" value={report.macroF1.toFixed(2)} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Accuracy by slice</div>
                <HBarChart data={tags.map((t) => ({ label: t.t, sub: `n=${t.n}`, value: t.acc, color: t.acc < 0.7 ? "var(--s8)" : "var(--s1)" }))} max={1} format={(v) => fmtPct(v, 0)} />
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Confusion matrix</div>
                <ConfusionMatrix labels={report.labels} predictedLabels={report.predictedLabels} matrix={report.matrix} />
              </div>
            </div>
            <Callout kind="info" title="What happened">
              The demo only contained easy calls. Sarcasm, contradictions and hesitant customers — the calls that matter most for sales — are where this model fails. Nobody could have seen
              that by looking at five examples.
            </Callout>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function WhyEval() {
  return (
    <LessonShell id="b1-why-eval">
      <Steps items={["The vibe check", "Why LLM eval is hard", "What to measure", "The evaluation stack"]} />
      <p>
        Traditional software is tested with exact expectations: <code>add(2, 2) == 4</code>. LLM outputs are open-ended, sometimes have several correct answers, vary between runs, and fail
        silently in fluent language. That&apos;s why so many teams end up evaluating by <em>vibes</em> — and why they get surprised in production.
      </p>
      <VibeCheck />
      <h2>Why evaluating LLMs is genuinely hard</h2>
      <div className="my-4 grid gap-2 sm:grid-cols-2">
        {[
          ["Many right answers", "“Customer wants a loan” and “caller is interested in borrowing” are both correct summaries."],
          ["Fluent failures", "Wrong answers look as confident and well-written as right ones."],
          ["Non-determinism", "The same input can produce different outputs (temperature, model updates)."],
          ["Long tails", "Rare inputs (sarcasm, code-mixing, noise) cause most failures — and are missing from demos."],
          ["Subjectivity", "Tone, helpfulness and completeness need rubrics, not string equality."],
          ["Moving targets", "Providers update models; your traffic drifts; a prompt tweak fixes one case and breaks three."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="text-sm font-semibold text-ink">{t}</div>
            <div className="text-xs text-ink-2">{d}</div>
          </div>
        ))}
      </div>
      <h2>Deterministic vs subjective metrics</h2>
      <div className="my-4 overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-3 py-2">Output</th>
              <th className="px-3 py-2">Metric type</th>
              <th className="px-3 py-2">Examples</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-surface text-ink-2">
            <tr>
              <td className="px-3 py-2 text-ink">Labels (intent, product)</td>
              <td className="px-3 py-2">Deterministic</td>
              <td className="px-3 py-2">accuracy, precision, recall, F1, confusion matrix</td>
            </tr>
            <tr>
              <td className="px-3 py-2 text-ink">Structured JSON</td>
              <td className="px-3 py-2">Deterministic</td>
              <td className="px-3 py-2">schema validity rate, field-level accuracy</td>
            </tr>
            <tr>
              <td className="px-3 py-2 text-ink">Summaries, CRM notes</td>
              <td className="px-3 py-2">Subjective → rubric</td>
              <td className="px-3 py-2">groundedness, completeness, relevance (human or validated LLM judge)</td>
            </tr>
            <tr>
              <td className="px-3 py-2 text-ink">The whole system</td>
              <td className="px-3 py-2">Operational</td>
              <td className="px-3 py-2">cost per 1K calls, P95 latency, invalid-output rate, review rate</td>
            </tr>
          </tbody>
        </table>
      </div>
      <WhyCard
        what={<>Measuring an LLM system's quality, cost, latency and reliability on a fixed, labeled set of examples — repeatedly.</>}
        why={<>You can't improve what you can't measure, and you can't compare prompt V2 vs V3 by looking at five outputs.</>}
        when={<>Before shipping, on every prompt/model change (regression), and continuously on production samples.</>}
        whenNot={<>Don't over-invest in elaborate metrics before you have a small, honest labeled set. 50 good examples beat 5,000 unlabeled ones.</>}
        how={<>Layered: format checks → deterministic metrics against <Term>Ground truth</Term> → rubric-based judging for subjective outputs → human review → production monitoring.</>}
        real={<>Every prompt change to the intent classifier runs against 120 labeled calls; the PR shows accuracy, per-slice F1, invalid rate, cost/1K and P95 vs the current version.</>}
      />
      <QuickCheck
        q={{
          id: "b1w",
          scenario: "Your manager asks: “Is the new prompt better?” You have 30 labeled calls.",
          question: "What's the most honest answer you can give?",
          options: [
            { text: "Yes, it looked better on the examples I tried", why: "That's a vibe check." },
            { text: "Accuracy on the 30 calls went from X to Y; here are the calls that flipped each way and the slices affected — with 30 examples the uncertainty is large", correct: true, why: "Numbers, per-example evidence, and honest uncertainty." },
            { text: "We need 10,000 labels before we can say anything", why: "Small honest evaluations are still far better than none." },
          ],
          takeaway: "Report measurements with their uncertainty and the examples behind them.",
        }}
      />
    </LessonShell>
  );
}

// ================================================================ B1.2
const ANNOTATE_IDS = ["t03", "t05", "t08", "t11", "t15", "t20", "t22", "t27"];

function Annotate() {
  const [labels, setLabels] = useState<Record<string, Intent>>({});
  const [submitted, setSubmitted] = useState(false);
  const completeExercise = useProgress((s) => s.completeExercise);
  const all = ANNOTATE_IDS.every((id) => labels[id]);
  const gold = ANNOTATE_IDS.map((id) => findTranscript(id)!.labels.intent as string);
  const mine = ANNOTATE_IDS.map((id) => labels[id] ?? "");
  const k = cohensKappa(mine, gold, [...INTENTS]);
  return (
    <div className="flex flex-col gap-3">
      <details className="rounded-lg border border-line bg-surface-2 p-3 text-sm" open>
        <summary className="cursor-pointer font-semibold text-ink">Labeling guidelines</summary>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink-2">{LABELING_GUIDELINES}</pre>
      </details>
      {ANNOTATE_IDS.map((id, i) => {
        const t = findTranscript(id)!;
        const g = t.labels.intent;
        const mineL = labels[id];
        return (
          <div key={id} className={cn("rounded-xl border p-3", submitted ? (mineL === g ? "border-good/40" : "border-bad/40") : "border-line")}>
            <div className="mb-2 flex items-center justify-between text-xs text-ink-3">
              <span>
                Call {i + 1} of {ANNOTATE_IDS.length}
              </span>
              {submitted && (mineL === g ? <Badge tone="good">agrees with reference</Badge> : <Badge tone="bad">reference: {g}</Badge>)}
            </div>
            <TranscriptView id={id} showNote={submitted} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {INTENTS.map((l) => (
                <button
                  key={l}
                  disabled={submitted}
                  onClick={() => setLabels((cur) => ({ ...cur, [id]: l }))}
                  className={cn(
                    "rounded-md border px-2.5 py-1 font-mono text-xs",
                    mineL === l ? "border-accent bg-accent text-white" : "border-line text-ink-2 hover:border-line-strong",
                    submitted && l === g && mineL !== l && "border-good text-good-ink",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {!submitted ? (
        <Button
          variant="primary"
          disabled={!all}
          className="self-start"
          onClick={() => {
            setSubmitted(true);
            completeExercise("ex-annotate");
          }}
        >
          {all ? "Submit labels & compare" : `Label all ${ANNOTATE_IDS.length} calls to submit`}
        </Button>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Agreement" value={fmtPct(k.observed, 0)} />
          <Stat label="Cohen's κ" value={k.kappa.toFixed(2)} sub={kappaLabel(k.kappa)} />
          <Stat label="Chance agreement" value={fmtPct(k.expected, 0)} />
        </div>
      )}
      {submitted && (
        <Callout kind="info" title="Read the notes under each call">
          Disagreements usually cluster on guideline edge cases (callbacks, “I'll think about it”, final-position-wins). If careful humans disagree there, a model scoring “wrong” on those
          calls may be telling you the guideline is ambiguous — fix the guideline before blaming the model.
        </Callout>
      )}
    </div>
  );
}

export function GroundTruth() {
  return (
    <LessonShell id="b1-ground-truth">
      <p>
        Every metric compares a prediction to a <Term>Ground truth</Term> label. Ground truth isn&apos;t handed down from above — people create it, following guidelines, and people
        disagree. Before you trust any accuracy number, you should know how consistent your labels are.
      </p>
      <div className="my-4 grid gap-2 sm:grid-cols-2">
        {[
          ["Reference answer", "The expected output for one input (a label, or an ideal summary)."],
          ["Test case", "Input + reference + tags (e.g. sarcasm, hinglish) + optional notes."],
          ["Evaluation dataset", "A frozen collection of test cases you re-run after every change."],
          ["Rubric", "Explicit criteria for subjective scores: what makes a 5 vs a 3."],
          ["Human evaluation", "Experts label or score outputs. Accurate, slow, expensive — the calibration source."],
          ["Automated evaluation", "Code metrics or LLM judges. Fast and cheap — only trustworthy once validated against humans."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="text-sm font-semibold text-ink">{t}</div>
            <div className="text-xs text-ink-2">{d}</div>
          </div>
        ))}
      </div>
      <h2>Label them yourself</h2>
      <p>These eight calls are deliberately borderline. Label them using the guidelines, then compare with the reference labels and see your agreement beyond chance (κ).</p>
      <Exercise id="ex-annotate">
        <Annotate />
      </Exercise>
      <WhyCard
        what={<>Reference labels produced by people following written guidelines; the yardstick for every automated metric.</>}
        why={<>Without it, “accuracy” is undefined. With bad or inconsistent labels, accuracy is noise.</>}
        when={<>Build a small set (50–150) early; grow it with production failures and human-review corrections.</>}
        whenNot={<>Don't label thousands of easy examples. Spend label effort on hard, ambiguous and business-critical slices.</>}
        how={<>Write guidelines → two people label a sample → compute <Term t="Inter-annotator agreement">agreement (κ)</Term> → discuss disagreements → refine guidelines → label the rest.</>}
        real={<>The team found “callback requested” split annotators 50/50 between interested and unclear. They added rule 1c; κ rose from 0.52 to 0.81 — and model “accuracy” jumped with no model change.</>}
      />
      <h2>Datasets in code</h2>
      <CodeBlock
        verified
        tabs={[
          {
            label: "LangSmith dataset",
            code: `from langsmith import Client

client = Client()   # LANGSMITH_API_KEY from the environment
dataset = client.create_dataset(dataset_name="intent-benchmark-v1")
client.create_examples(
    dataset_id=dataset.id,
    examples=[
        {"inputs": {"transcript": t05_text}, "outputs": {"intent": "not_interested"},
         "metadata": {"tags": ["sarcasm", "hard"]}},
        {"inputs": {"transcript": t22_text}, "outputs": {"intent": "unclear"},
         "metadata": {"tags": ["callback"]}},
    ],
)`,
          },
          {
            label: "plain JSONL",
            code: `# datasets/intent_benchmark_v1.jsonl — version it in git like code
{"id": "t05", "input": "Agent: …\\nCustomer: Oh wonderful, another loan call…", "expected": {"intent": "not_interested"}, "tags": ["sarcasm", "hard"]}
{"id": "t22", "input": "Agent: …\\nCustomer: I'm driving. Can you call me after 6 pm…", "expected": {"intent": "unclear"}, "tags": ["callback"]}`,
          },
        ]}
      />
      <TryIt title="Build your own evaluation dataset" href="/lab/datasets" cta="Open Datasets">
        Clone the handcrafted set, add your own calls, tag them, and run experiments on it.
      </TryIt>
    </LessonShell>
  );
}

