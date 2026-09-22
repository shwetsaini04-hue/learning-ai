"use client";

import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import { GroupedBarChart, ScatterPlot } from "@/components/charts/Charts";
import { JudgeLab, RubricEditor } from "@/components/eval/JudgeLab";
import { MetricComparer } from "@/components/eval/MetricComparer";
import { ModelSelect } from "@/components/ModelSelect";
import { CodeBlock, Exercise, LessonShell, QuickCheck, Steps, Term, TryIt, WhyCard } from "@/components/learn/Learn";
import { Badge, Button, Callout, Card, Field, Input, Stat } from "@/components/ui";
import { transcriptToText } from "@/lib/domain";
import { pearson } from "@/lib/eval/metrics";
import { DEFAULT_RUBRIC, JUDGE_CASES, JUDGE_QUESTION, JUDGE_REFERENCE, runJudge, type Rubric } from "@/lib/eval/judge";
import { diffExperiments, runExperiment, type Experiment } from "@/lib/eval/runner";
import { builtinDatasets } from "@/lib/store/datasets";
import { useExperiments } from "@/lib/store/experiments";
import { useProgress } from "@/lib/store/progress";
import { findTranscript } from "@/lib/sim/transcripts";
import { cn, fmtPct, fmtUsd } from "@/lib/utils";

// ================================================================ B3.1
export default function ExactSemantic() {
  return (
    <LessonShell id="b3-exact-semantic">
      <Steps items={["Exact", "Normalized", "Token overlap", "Semantic", "When each lies"]} />
      <p>
        The simplest evaluator compares strings. That&apos;s perfect for labels and terrible for sentences. Each metric below is more lenient than the last — and each can be fooled in its own
        way. Click through the presets, then edit the texts yourself.
      </p>
      <MetricComparer />
      <WhyCard
        what={<><Term>Exact match</Term> (identical), normalized match (case/punctuation/synonyms), token F1 &amp; ROUGE (word overlap), <Term>Semantic similarity</Term> (meaning, via <Term>Embeddings</Term>).</>}
        why={<>Free text has many correct phrasings; labels have one. You need the metric that matches how the output may legitimately vary.</>}
        when={<>Exact/normalized: labels, enums, IDs, numbers. Overlap metrics: extractive answers. Semantic: paraphrase-tolerant checks and retrieval quality.</>}
        whenNot={<>Don't use similarity as a correctness score for stance-bearing text — “interested” vs “not interested” share almost all words. Use a rubric/judge or structured fields instead.</>}
        how={<>Normalize first (lowercase, strip punctuation, map synonyms). For semantic similarity embed both texts and take cosine; pick a threshold by checking it against human labels.</>}
        real={<>Intent label: normalized match. CRM summary: judge on a rubric + groundedness. Extracted rate “10.75%”: exact numeric match.</>}
      />
      <Callout kind="tip" title="Design trick">
        The best way to make evaluation easy is to make outputs structured. Instead of grading the sentence “The customer seems keen…”, ask the model for{" "}
        <code>{`{"intent": "interested"}`}</code> <em>plus</em> a free-text note — then grade the field exactly and only the note with a judge.
      </Callout>
      <QuickCheck
        q={{
          id: "b3es",
          scenario: "Two summaries: “The customer is interested in a home loan.” vs “The customer isn't interested in a home loan.”",
          question: "Which metric is most dangerous to rely on here?",
          options: [
            { text: "Exact match", why: "It correctly scores 0 (they differ) — harsh, but not misleading here." },
            { text: "Token F1 / ROUGE", correct: true, why: "They share almost every word, so overlap is very high despite opposite meaning." },
            { text: "A rubric-based judge", why: "A decent judge (validated) would catch the negation." },
          ],
          takeaway: "Surface-overlap metrics can't see negation.",
        }}
      />
    </LessonShell>
  );
}

// ================================================================ B3.2
function JudgeCalibration() {
  const [rubric, setRubric] = useState<Rubric>(DEFAULT_RUBRIC);
  const [model, setModel] = useState("sim:swift-m");
  const [scores, setScores] = useState<(number | null)[] | null>(null);
  const [busy, setBusy] = useState(false);
  const completeExercise = useProgress((s) => s.completeExercise);
  const context = transcriptToText(findTranscript("t01")!);
  const run = async () => {
    setBusy(true);
    const out: (number | null)[] = [];
    for (const c of JUDGE_CASES) {
      const r = await runJudge(model, { question: JUDGE_QUESTION, reference: JUDGE_REFERENCE, answer: c.answer, context }, rubric);
      out.push(r.score);
    }
    setScores(out);
    const valid = out.map((s) => s ?? 3);
    const r = pearson(valid, JUDGE_CASES.map((c) => c.human));
    if (r >= 0.75) completeExercise("ex-judge-calibration");
    setBusy(false);
  };
  const r = scores ? pearson(scores.map((s) => s ?? 3), JUDGE_CASES.map((c) => c.human)) : null;
  const exact = scores ? scores.filter((s, i) => s === JUDGE_CASES[i].human).length : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 md:grid-cols-[1fr_1.3fr]">
        <div className="flex flex-col gap-3">
          <RubricEditor rubric={rubric} onChange={(x) => { setRubric(x); setScores(null); }} />
          <Field label="Judge model">
            <ModelSelect value={model} onChange={(m) => { setModel(m); setScores(null); }} />
          </Field>
          <Button variant="primary" onClick={run} disabled={busy} icon={<Play className="h-4 w-4" />}>
            Grade all 8 answers
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-xs text-ink-3">
            Question: “{JUDGE_QUESTION}” · transcript t01 · reference: “{JUDGE_REFERENCE}”
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-ink-3">
                <tr className="border-b border-line">
                  <th className="py-1 text-left font-medium">answer</th>
                  <th className="py-1 text-right font-medium">human</th>
                  <th className="py-1 text-right font-medium">judge</th>
                </tr>
              </thead>
              <tbody>
                {JUDGE_CASES.map((c, i) => (
                  <tr key={c.id} className="border-b border-line/60 align-top">
                    <td className="py-1.5 pr-2 text-ink-2">
                      {c.answer}
                      {scores && <div className="mt-0.5 text-[11px] text-ink-3">{c.note}</div>}
                    </td>
                    <td className="num py-1.5 text-right font-mono text-ink">{c.human}</td>
                    <td className={cn("num py-1.5 text-right font-mono", scores ? (Math.abs((scores[i] ?? 0) - c.human) >= 2 ? "text-bad-ink" : "text-ink") : "text-ink-3")}>{scores ? scores[i] ?? "∅" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {scores && r !== null && (
        <div className="fade-in grid gap-3 md:grid-cols-[1fr_1.2fr]">
          <div className="grid grid-cols-2 gap-2 self-start">
            <Stat label="Pearson r (judge vs human)" value={r.toFixed(2)} tone={r >= 0.75 ? "good" : "bad"} sub={r >= 0.75 ? "calibrated enough ✓" : "target ≥ 0.75"} />
            <Stat label="Exact agreement" value={`${exact}/8`} />
          </div>
          <ScatterPlot
            points={JUDGE_CASES.map((c, i) => ({ x: c.human + (i % 3) * 0.06 - 0.06, y: (scores[i] ?? 3) + ((i + 1) % 3) * 0.06 - 0.06, label: c.id, color: Math.abs((scores[i] ?? 3) - c.human) >= 2 ? "var(--s8)" : "var(--s1)" }))}
            xLabel="human score"
            yLabel="judge score"
            xMin={0.5}
            xMax={5.5}
            yMin={0.5}
            yMax={5.5}
            formatX={(v) => v.toFixed(0)}
            formatY={(v) => v.toFixed(0)}
            height={230}
          />
        </div>
      )}
    </div>
  );
}

function BiasProbe() {
  const [res, setRes] = useState<{ label: string; score: number | null }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const context = transcriptToText(findTranscript("t01")!);
  const short = "Interested; wants rate details by email.";
  const padded =
    "Having carefully analyzed the full conversation, it is evident that the customer demonstrates a meaningful degree of interest in the personal loan offering, and that before proceeding further they would appreciate receiving comprehensive interest-rate information via email for comparison purposes.";
  const run = async () => {
    setBusy(true);
    const base = { question: JUDGE_QUESTION, reference: JUDGE_REFERENCE, context };
    const out = [];
    out.push({ label: "Short correct answer", score: (await runJudge("sim:pico-s", { ...base, answer: short }, DEFAULT_RUBRIC)).score });
    out.push({ label: "Same content, padded ×5", score: (await runJudge("sim:pico-s", { ...base, answer: padded }, DEFAULT_RUBRIC)).score });
    out.push({ label: "Short answer, shown in position B", score: (await runJudge("sim:pico-s", { ...base, answer: short }, DEFAULT_RUBRIC, { position: "B" })).score });
    out.push({ label: "Short answer, shown in position A", score: (await runJudge("sim:pico-s", { ...base, answer: short }, DEFAULT_RUBRIC, { position: "A" })).score });
    setRes(out);
    setBusy(false);
  };
  return (
    <Card className="my-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-ink-2">Probe a small judge (Pico-S) for verbosity and position bias:</div>
        <Button size="sm" onClick={run} disabled={busy}>
          Run bias probe
        </Button>
      </div>
      {res && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {res.map((r) => (
            <div key={r.label} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
              <span className="text-ink-2">{r.label}</span>
              <Badge tone="accent">{r.score ?? "∅"} / 5</Badge>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-ink-3">Mitigations: explicit “don't reward length” rules, randomizing/swapping positions in pairwise comparisons, a stronger judge, and periodic human calibration.</p>
    </Card>
  );
}

export function LLMJudge() {
  return (
    <LessonShell id="b3-llm-judge">
      <Steps items={["Rubric", "Judge prompt", "Run", "Biases", "Validate against humans"]} />
      <p>
        When outputs are subjective (summaries, explanations, replies), you can ask another model to grade them against a <Term>Rubric</Term>: <Term>LLM-as-a-judge</Term>. It scales like
        code and understands language like a person. It&apos;s also a model — with biases, noise and blind spots — so you must evaluate the evaluator.
      </p>
      <h2>Build a rubric and run a judge</h2>
      <p>Edit the rubric levels and rules, grade an answer, and open the exact evaluation prompt that was sent. Try “Run 5×” to see how stable the judge is.</p>
      <JudgeLab />
      <h2>Judges have biases</h2>
      <BiasProbe />
      <h2>Calibrate the judge against humans</h2>
      <p>
        Eight answers were scored by a human expert. Your job: make the judge agree (Pearson r ≥ 0.75). Read the answers — which ones did the human punish, and why? Encode that in the rubric.
      </p>
      <Exercise id="ex-judge-calibration">
        <JudgeCalibration />
      </Exercise>
      <WhyCard
        what={<>A model that scores outputs using a rubric, optionally with a reference answer and the source context; returns a score and reasoning.</>}
        why={<>Human grading doesn't scale to every prompt change and thousands of outputs; string metrics can't grade meaning.</>}
        when={<>Subjective or open-ended outputs; pairwise comparisons of prompt versions; groundedness at claim level.</>}
        whenNot={<>Labels and structured fields (exact metrics are cheaper and perfect); or before you've validated the judge on human-scored examples.</>}
        how={<>Specific rubric → ask for reasoning then score → JSON output → temperature 0 → validate vs humans (correlation, agreement) → monitor drift. Prefer a different model family than the system under test.</>}
        real={<>Weekly: 200 CRM summaries judged for groundedness and completeness; 30 of them also human-graded to keep the judge's agreement above 0.8.</>}
      />
      <CodeBlock
        verified
        tabs={[
          {
            label: "LangSmith evaluator",
            code: `from langsmith import Client
from pydantic import BaseModel, Field
from langchain.chat_models import init_chat_model

class Grade(BaseModel):
    reasoning: str
    score: int = Field(ge=1, le=5)

judge = init_chat_model("anthropic:claude-sonnet-5").with_structured_output(Grade)

def summary_quality(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    g = judge.invoke(JUDGE_PROMPT.format(transcript=inputs["transcript"],
                                         reference=reference_outputs["summary"],
                                         answer=outputs["summary"]))
    return {"key": "summary_quality", "score": g.score / 5, "comment": g.reasoning}

client = Client()
client.evaluate(summarize_call, data="crm-summaries-v2",
                evaluators=[summary_quality], experiment_prefix="summ-prompt-v2",
                max_concurrency=4)`,
          },
        ]}
      />
    </LessonShell>
  );
}

// ================================================================ B3.3
function RegressionRunner() {
  const [base, setBase] = useState<Experiment | null>(null);
  const [cand, setCand] = useState<Experiment | null>(null);
  const [busy, setBusy] = useState(false);
  const [guess, setGuess] = useState("");
  const [checked, setChecked] = useState<boolean | null>(null);
  const add = useExperiments((s) => s.add);
  const bump = useProgress((s) => s.bump);
  const completeExercise = useProgress((s) => s.completeExercise);
  const ds = useMemo(() => builtinDatasets()[1], []);
  const run = async () => {
    setBusy(true);
    const cfg = { datasetId: ds.id, datasetName: ds.name, model: "sim:swift-m", task: "classify_intent" as const, temperature: 0, maxTokens: 512 };
    const b = await runExperiment({ ...cfg, promptVersion: "v3" }, ds.examples, undefined, { name: "Baseline: Swift-M · V3" });
    const c = await runExperiment({ ...cfg, promptVersion: "v4" }, ds.examples, undefined, { name: "Candidate: Swift-M · V4 (cost-cut)" });
    setBase(b);
    setCand(c);
    add(b);
    add(c);
    bump("experiments", "regression V3 vs V4");
    bump("experiments");
    setBusy(false);
  };
  const diff = base && cand ? diffExperiments(base, cand) : null;
  const slices = useMemo(() => {
    if (!base || !cand) return [];
    const tags = ["baseline", "sarcasm", "mixed-signals", "hinglish", "callback", "noisy-asr", "trust", "third-party", "price-sensitive"];
    return tags
      .map((t) => {
        const b = base.metrics.byTag.find((x) => x.tag === t);
        const c = cand.metrics.byTag.find((x) => x.tag === t);
        return b && c ? { t, b: b.accuracy, c: c.accuracy } : null;
      })
      .filter(Boolean) as { t: string; b: number; c: number }[];
  }, [base, cand]);
  return (
    <div className="flex flex-col gap-3">
      <Button variant="primary" onClick={run} disabled={busy} icon={<Play className="h-4 w-4" />} className="self-start">
        Run V3 (baseline) and V4 (candidate) on 120 calls
      </Button>
      {base && cand && diff && (
        <div className="fade-in flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Accuracy V3 → V4" value={`${fmtPct(base.metrics.accuracy, 0)} → ${fmtPct(cand.metrics.accuracy, 0)}`} tone={cand.metrics.accuracy < base.metrics.accuracy ? "bad" : "good"} />
            <Stat label="Cost / 1K calls" value={`${fmtUsd(base.metrics.costPer1k)} → ${fmtUsd(cand.metrics.costPer1k)}`} tone="good" />
            <Stat label="Fixed (✗→✓)" value={diff.fixed.length} tone="good" />
            <Stat label="Regressed (✓→✗)" value={checked ? diff.regressed.length : "?"} tone="bad" />
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Accuracy by slice</div>
            <GroupedBarChart
              groups={slices.map((s) => s.t)}
              series={[
                { label: "V3 baseline", values: slices.map((s) => s.b) },
                { label: "V4 candidate", values: slices.map((s) => s.c) },
              ]}
              max={1}
              format={(v) => fmtPct(v, 0)}
              height={220}
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="How many examples did V4 break (right in V3, wrong in V4)?" className="w-72">
              <Input value={guess} onChange={(e) => setGuess(e.target.value)} inputMode="numeric" />
            </Field>
            <Button
              onClick={() => {
                const ok = parseInt(guess, 10) === diff.regressed.length;
                setChecked(ok);
                if (ok) completeExercise("ex-regression");
              }}
            >
              Check
            </Button>
            {checked === false && <span className="text-sm text-bad-ink">Not quite — the aggregate accuracy hides flips in both directions. Count per example.</span>}
          </div>
          {checked && (
            <div className="rounded-lg border border-line p-3">
              <div className="mb-2 text-sm font-semibold text-ink">Regressed examples</div>
              <div className="flex flex-col gap-1">
                {diff.regressed.map((r) => (
                  <div key={r.exampleId} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-ink-3">{r.exampleId}</span>
                    <span className="font-mono text-ink">
                      {r.expected} → {r.predicted ?? "invalid"}
                    </span>
                    {r.tags.slice(0, 3).map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!checked && (
            <div className="text-xs text-ink-3">
              Hint: the difference in correct answers is {Math.round((base.metrics.accuracy - cand.metrics.accuracy) * base.metrics.n)} — but that&apos;s regressions <em>minus</em> fixes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Regression() {
  return (
    <LessonShell id="b3-regression">
      <p>
        A prompt is code. Changing it can fix five calls and break seven — and the average may barely move. <Term>Regression testing</Term> means re-running a frozen{" "}
        <Term>Evaluation dataset</Term> after every change and comparing <strong>per example</strong> against a baseline, with <Term>Prompt versioning</Term> so you know exactly what
        changed.
      </p>
      <h2>A cost-cutting prompt change</h2>
      <p>
        Prompt V4 is a compressed V3: guidelines and few-shot examples removed to cut input tokens by ~60%. Is it safe to ship? Run both and find out what broke.
      </p>
      <Exercise id="ex-regression">
        <RegressionRunner />
      </Exercise>
      <WhyCard
        what={<>Comparing a candidate (new prompt/model/code) against a baseline on the same frozen dataset, example by example and slice by slice.</>}
        why={<>LLM changes have non-local effects. Aggregate metrics hide concentrated damage to important slices (e.g. sarcasm → false leads).</>}
        when={<>Every prompt edit, model swap, parameter change or provider model update — ideally in CI, blocking merges on regressions.</>}
        whenNot={<>Don't block on tiny, statistically meaningless differences on small sets; look at which examples flipped and why.</>}
        how={<>Version prompts (id + text hash) → run baseline and candidate → diff: fixed / regressed / both-wrong → per-slice deltas → decide (ship, iterate, or ship with a guard).</>}
        real={<>V4 saved $0.12 per 1K calls but broke most sarcasm and mixed-signal calls. Decision: keep V3's guidelines, drop only the few-shot examples (V3b), re-test.</>}
      />
      <CodeBlock
        tabs={[
          {
            label: "CI regression gate (sketch)",
            code: `baseline = load_results("experiments/intent_v3.jsonl")
candidate = run_eval(prompt=PROMPTS["intent@v4"], dataset="intent-benchmark-v1")

regressed = [ex for ex in candidate if not ex.correct and baseline[ex.id].correct]
fixed     = [ex for ex in candidate if ex.correct and not baseline[ex.id].correct]

print(f"accuracy {baseline.acc:.3f} -> {candidate.acc:.3f} | fixed {len(fixed)} | regressed {len(regressed)}")
for tag in ["sarcasm", "callback", "hinglish"]:
    assert candidate.acc_by_tag[tag] >= baseline.acc_by_tag[tag] - 0.05, f"slice {tag} regressed"`,
          },
        ]}
      />
      <TryIt title="Compare many versions at once" href="/lab/experiments" cta="Open Experiments">
        Run V1–V4 across models, compare quality, cost and latency side by side, and inspect every flipped example.
      </TryIt>
    </LessonShell>
  );
}
