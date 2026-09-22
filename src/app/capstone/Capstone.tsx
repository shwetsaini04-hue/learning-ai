"use client";

import { Check, CheckCircle2, Circle, Download, Play, Sparkles, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ConfusionMatrix, HBarChart } from "@/components/charts/Charts";
import { ModelSelect } from "@/components/ModelSelect";
import { FlowDiagram } from "@/components/graph/FlowDiagram";
import { Badge, Button, Callout, Card, Field, PageHeader, ProgressBar, Segmented, Stat, TextArea } from "@/components/ui";
import { CAPSTONE_BRIEF, CAPSTONE_TARGETS, DESIGN_QUESTIONS, JUSTIFICATION_RUBRIC } from "@/content/capstone";
import { invokeLLM } from "@/lib/ai/client";
import { INTENTS, PRODUCTS } from "@/lib/domain";
import { classificationReport } from "@/lib/eval/metrics";
import { CAPSTONE_STEPS } from "@/lib/progress-calc";
import { getCapstoneSet } from "@/lib/sim/transcripts";
import { useHydrated } from "@/lib/store/hydration";
import { useProgress } from "@/lib/store/progress";
import { useSettings } from "@/lib/store/settings";
import { useWorkflows } from "@/lib/store/workflows";
import { cn, download, fmtMs, fmtPct, fmtUsd, mean } from "@/lib/utils";
import { runWorkflowBatch, type BatchItemResult } from "@/lib/workflows/run";
import type { LLMNodeConfig, WorkflowSpec } from "@/lib/workflows/spec";

type Step = (typeof CAPSTONE_STEPS)[number];
const STEP_LABEL: Record<Step, string> = {
  brief: "Brief",
  design: "Design review",
  build: "Build",
  evaluate: "Evaluate",
  analyze: "Error analysis",
  regression: "Regression",
  final: "Final report",
};

interface EvalSummary {
  modelAcc: number;
  systemAcc: number;
  macroF1: number;
  reviewRate: number;
  costPer1k: number;
  avgLatency: number;
  errors: number;
  n: number;
}
interface SlimResult {
  id: string;
  expected: string;
  model: string | null;
  final: string | null;
  reviewed: boolean;
  tags: string[];
}

function summarize(res: BatchItemResult[]): { summary: EvalSummary; slim: SlimResult[] } {
  const model = classificationReport(res.map((b) => ({ expected: b.expected.intent, predicted: b.modelIntent })), [...INTENTS]);
  const system = classificationReport(res.map((b) => ({ expected: b.expected.intent, predicted: (b.final.intent as string) ?? null })), [...INTENTS]);
  return {
    summary: {
      modelAcc: model.accuracy,
      systemAcc: system.accuracy,
      macroF1: system.macroF1,
      reviewRate: res.filter((b) => b.reviewed).length / res.length,
      costPer1k: mean(res.map((b) => b.costUsd)) * 1000,
      avgLatency: mean(res.map((b) => b.latencyMs)),
      errors: res.filter((b) => b.status === "error").length,
      n: res.length,
    },
    slim: res.map((b) => ({ id: b.id, expected: b.expected.intent, model: b.modelIntent, final: (b.final.intent as string) ?? null, reviewed: b.reviewed, tags: b.tags.filter((t) => !(PRODUCTS as readonly string[]).includes(t)) })),
  };
}

function targetChecks(s: EvalSummary) {
  return [
    { label: `System accuracy ≥ ${fmtPct(CAPSTONE_TARGETS.systemAccuracy, 0)}`, ok: s.systemAcc >= CAPSTONE_TARGETS.systemAccuracy, value: fmtPct(s.systemAcc) },
    { label: `Review rate ≤ ${fmtPct(CAPSTONE_TARGETS.maxReviewRate, 0)}`, ok: s.reviewRate <= CAPSTONE_TARGETS.maxReviewRate, value: fmtPct(s.reviewRate) },
    { label: `LLM cost ≤ ${fmtUsd(CAPSTONE_TARGETS.maxCostPer1k)} / 1K calls`, ok: s.costPer1k <= CAPSTONE_TARGETS.maxCostPer1k, value: fmtUsd(s.costPer1k) },
    { label: "No pipeline errors", ok: s.errors === 0, value: String(s.errors) },
  ];
}

// ------------------------------------------------------------------ design review
function DesignStep({ onDone }: { onDone: (score: number, data: unknown) => void }) {
  const prev = useProgress((s) => s.capstone.design);
  const mode = useSettings((s) => s.mode);
  const [picks, setPicks] = useState<Record<string, number[]>>(((prev?.data as { picks?: Record<string, number[]> })?.picks) ?? {});
  const [text, setText] = useState(((prev?.data as { text?: string })?.text) ?? "");
  const [submitted, setSubmitted] = useState(!!prev?.done);
  const [aiModel, setAiModel] = useState("claude-haiku-4-5");
  const [ai, setAi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const qScore = (qid: string) => {
    const q = DESIGN_QUESTIONS.find((x) => x.id === qid)!;
    const p = picks[qid] ?? [];
    const correct = q.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
    if (!q.multi) return p.length === 1 && correct.includes(p[0]) ? 1 : 0;
    const good = p.filter((i) => correct.includes(i)).length;
    const bad = p.filter((i) => !correct.includes(i)).length;
    return Math.max(0, (good - bad) / correct.length);
  };
  const covered = JUSTIFICATION_RUBRIC.filter((r) => r.patterns.test(text));
  const totalW = DESIGN_QUESTIONS.reduce((a, q) => a + q.weight, 0) + 3;
  const score = (DESIGN_QUESTIONS.reduce((a, q) => a + q.weight * qScore(q.id), 0) + 3 * (covered.length / JUSTIFICATION_RUBRIC.length)) / totalW;

  const askAI = async () => {
    setBusy(true);
    try {
      const res = await invokeLLM({
        model: aiModel,
        system: "You are a senior AI engineer reviewing a junior engineer's system design. Be specific, kind and brief.",
        prompt: `Brief:\n${CAPSTONE_BRIEF.goal}\nConstraints:\n- ${CAPSTONE_BRIEF.constraints.join("\n- ")}\n\nThe engineer's justification of their architecture:\n"""${text}"""\n\nGive 3 strengths and 3 concrete improvements (bullets). Mention anything risky for compliance, quality, cost or latency.`,
        temperature: 0.3,
        maxTokens: 600,
      });
      setAi(res.text);
    } catch (e) {
      setAi(`Could not get AI feedback: ${(e as Error).message}`);
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {DESIGN_QUESTIONS.map((q, qi) => (
        <Card key={q.id} className="p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="text-ink-3">{qi + 1}.</span> {q.question} {q.multi && <Badge tone="accent">select all that apply</Badge>}
            {submitted && <Badge tone={qScore(q.id) === 1 ? "good" : qScore(q.id) > 0 ? "warn" : "bad"}>{Math.round(qScore(q.id) * 100)}%</Badge>}
          </div>
          <div className="flex flex-col gap-1.5">
            {q.options.map((o, i) => {
              const on = (picks[q.id] ?? []).includes(i);
              return (
                <button
                  key={i}
                  disabled={submitted}
                  onClick={() =>
                    setPicks((p) => {
                      const cur = p[q.id] ?? [];
                      return { ...p, [q.id]: q.multi ? (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]) : [i] };
                    })
                  }
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm",
                    !submitted && (on ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:border-line-strong"),
                    submitted && o.correct && "border-good bg-good-soft text-ink",
                    submitted && on && !o.correct && "border-bad bg-bad-soft text-ink",
                    submitted && !on && !o.correct && "border-line text-ink-3",
                  )}
                >
                  {o.text}
                  {submitted && (on || o.correct) && <span className="mt-0.5 block text-xs text-ink-2">{o.feedback}</span>}
                </button>
              );
            })}
          </div>
        </Card>
      ))}
      <Card className="p-4">
        <Field label="Justify your architecture in 3–6 sentences (graded on which key concerns you address)">
          <TextArea rows={6} value={text} onChange={(e) => setText(e.target.value)} disabled={submitted} placeholder="e.g. PII is redacted before any model call because… Intent and product run in parallel to… Calls below a confidence of 0.75 pause for review via interrupt() with a Postgres checkpointer…" />
        </Field>
        {submitted && (
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {JUSTIFICATION_RUBRIC.map((r) => {
              const ok = r.patterns.test(text);
              return (
                <div key={r.concept} className="flex items-start gap-2 text-xs">
                  {ok ? <Check className="mt-0.5 h-3.5 w-3.5 text-good-ink" /> : <Circle className="mt-0.5 h-3.5 w-3.5 text-ink-3" />}
                  <span className={ok ? "text-ink" : "text-ink-2"}>
                    {r.concept}
                    {!ok && <span className="block text-ink-3">{r.tip}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        {!submitted ? (
          <Button
            variant="primary"
            onClick={() => {
              setSubmitted(true);
              onDone(score, { picks, text, score });
            }}
            disabled={Object.keys(picks).length < DESIGN_QUESTIONS.length || text.trim().length < 40}
          >
            Submit design for review
          </Button>
        ) : (
          <>
            <Badge tone={score >= 0.7 ? "good" : "warn"}>Design score {Math.round(score * 100)}%</Badge>
            <Button variant="ghost" size="sm" onClick={() => setSubmitted(false)}>
              Revise
            </Button>
          </>
        )}
        {submitted && mode === "live" && (
          <span className="flex items-center gap-2">
            <ModelSelect value={aiModel} onChange={setAiModel} className="w-52" />
            <Button size="sm" onClick={askAI} disabled={busy} icon={<Sparkles className="h-3.5 w-3.5" />}>
              AI design feedback
            </Button>
          </span>
        )}
      </div>
      {submitted && score < 0.7 && <Callout kind="warn">You need 70% to pass this step. Read the feedback under each option, then revise.</Callout>}
      {ai && (
        <Card className="whitespace-pre-wrap p-4 text-sm text-ink-2">
          <div className="mb-1 font-semibold text-ink">AI reviewer</div>
          {ai}
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ main
export function Capstone() {
  const hydrated = useHydrated((s) => s.hydrated);
  const cap = useProgress((s) => s.capstone);
  const capstoneStep = useProgress((s) => s.capstoneStep);
  const buildDone = useProgress((s) => s.exercises["ex-capstone-build"]?.status === "completed");
  const draft = useWorkflows((s) => s.drafts["ex:ex-capstone-build"]);
  const isDone = (s: Step) => hydrated && !!cap[s]?.done;
  const firstOpen = CAPSTONE_STEPS.find((s) => !isDone(s)) ?? "final";
  // until the learner picks a step, show the first unfinished one
  const [chosenStep, setStep] = useState<Step | null>(null);
  const step: Step = chosenStep ?? (hydrated ? firstOpen : "brief");

  useEffect(() => {
    if (hydrated && buildDone && !cap.build?.done) capstoneStep("build", { done: true });
  }, [hydrated, buildDone, cap.build?.done, capstoneStep]);

  // evaluate
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const evalData = cap.evaluate?.data as { summary: EvalSummary; slim: SlimResult[] } | undefined;
  const runEval = async (spec: WorkflowSpec) => {
    setBusy(true);
    const res = await runWorkflowBatch(spec, getCapstoneSet(), (d, n) => setProgress(d / n));
    const s = summarize(res);
    const ok = targetChecks(s.summary).every((c) => c.ok);
    capstoneStep("evaluate", { done: ok, score: s.summary.systemAcc, data: s });
    setBusy(false);
  };

  // analyze
  const slices = useMemo(() => {
    if (!evalData) return [];
    const m = new Map<string, { n: number; err: number }>();
    evalData.slim.forEach((r) =>
      r.tags.forEach((t) => {
        const c = m.get(t) ?? { n: 0, err: 0 };
        c.n++;
        if (r.model !== r.expected) c.err++;
        m.set(t, c);
      }),
    );
    return [...m.entries()].filter(([, v]) => v.n >= 3).map(([t, v]) => ({ t, rate: v.err / v.n, n: v.n })).sort((a, b) => b.rate - a.rate);
  }, [evalData]);
  const [slicePick, setSlicePick] = useState("");

  // regression
  const [variantModel, setVariantModel] = useState("sim:pico-s");
  const [variantPrompt, setVariantPrompt] = useState("v4");
  const [candidate, setCandidate] = useState<{ summary: EvalSummary; slim: SlimResult[] } | null>(null);
  const [decision, setDecision] = useState<"ship" | "hold" | null>(null);
  const runVariant = async () => {
    if (!draft) return;
    setBusy(true);
    const spec: WorkflowSpec = {
      ...draft,
      nodes: draft.nodes.map((n) => (n.kind === "llm" ? { ...n, config: { ...(n.config as LLMNodeConfig), model: variantModel, promptVersion: (n.config as LLMNodeConfig).task === "classify_intent" ? variantPrompt : (n.config as LLMNodeConfig).promptVersion } } : n)),
    };
    const res = await runWorkflowBatch(spec, getCapstoneSet(), (d, n) => setProgress(d / n));
    setCandidate(summarize(res));
    setDecision(null);
    setBusy(false);
  };
  const regDiff = useMemo(() => {
    if (!evalData || !candidate) return null;
    const base = new Map(evalData.slim.map((r) => [r.id, r]));
    let fixed = 0;
    let regressed = 0;
    candidate.slim.forEach((c) => {
      const b = base.get(c.id);
      if (!b) return;
      const bOk = b.model === b.expected;
      const cOk = c.model === c.expected;
      if (!bOk && cOk) fixed++;
      if (bOk && !cOk) regressed++;
    });
    const s = candidate.summary;
    const shouldShip = s.modelAcc >= evalData.summary.modelAcc - 0.01 && regressed <= fixed && s.costPer1k <= CAPSTONE_TARGETS.maxCostPer1k && s.reviewRate <= CAPSTONE_TARGETS.maxReviewRate && s.errors === 0;
    return { fixed, regressed, shouldShip };
  }, [evalData, candidate]);

  const doneCount = CAPSTONE_STEPS.filter(isDone).length;
  const designScore = cap.design?.score ?? 0;

  const report = () => {
    const s = evalData?.summary;
    const lines = [
      "# Capstone report — Transcript Analysis LLM System",
      "",
      `Generated ${new Date().toISOString()}`,
      "",
      `- Design review score: ${Math.round(designScore * 100)}%`,
      `- Build requirements: ${buildDone ? "passed" : "not passed"}`,
      s ? `- Evaluation (n=${s.n}): model accuracy ${fmtPct(s.modelAcc)}, system accuracy ${fmtPct(s.systemAcc)}, macro F1 ${s.macroF1.toFixed(3)}, review rate ${fmtPct(s.reviewRate)}, cost ${fmtUsd(s.costPer1k)}/1K, avg latency ${fmtMs(s.avgLatency)}` : "- Evaluation: not run",
      slices[0] ? `- Weakest slice: ${slices[0].t} (${fmtPct(slices[0].rate, 0)} model error rate)` : "",
      cap.regression?.data ? `- Regression decision: ${JSON.stringify(cap.regression.data)}` : "",
      "",
      "## Pipeline",
      "```json",
      JSON.stringify(draft ?? {}, null, 2),
      "```",
    ];
    download("capstone-report.md", lines.filter(Boolean).join("\n"), "text/markdown");
  };

  const improvements: string[] = [];
  if (evalData) {
    const s = evalData.summary;
    if (s.modelAcc < 0.88) improvements.push("Model accuracy before review is below 88% — try the V3 prompt (guidelines + examples) or a stronger model on the classifier only.");
    if (s.reviewRate > 0.25) improvements.push("Review rate is high — check calibration (a better-calibrated model) or lower the threshold slightly and measure the slip rate.");
    if (s.costPer1k > 1.2) improvements.push("Cost per 1K is significant — consider merging analyses into one structured call, a cheaper model for sentiment/details, or prompt caching.");
    if (slices[0] && slices[0].rate > 0.2) improvements.push(`The '${slices[0].t}' slice fails ${fmtPct(slices[0].rate, 0)} of the time — add guideline text and examples for it, then regression-test that slice.`);
    if (!improvements.length) improvements.push("Strong result. Next: collect production feedback, grow the dataset with real failures, and add monitoring for invalid-output and review rates.");
  }

  return (
    <div>
      <PageHeader
        eyebrow="Capstone"
        title="Build and defend a Transcript Analysis LLM System"
        right={
          <div className="w-52">
            <div className="mb-1 flex justify-between text-xs text-ink-3">
              <span>Progress</span>
              <span className="font-semibold text-ink">
                {doneCount}/{CAPSTONE_STEPS.length}
              </span>
            </div>
            <ProgressBar value={doneCount / CAPSTONE_STEPS.length} tone="good" />
          </div>
        }
      >
        Everything from both tracks, end to end: decide the architecture, build it, evaluate it against quality, cost and review-rate targets, analyze its errors, and make a data-driven release
        decision.
      </PageHeader>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {CAPSTONE_STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => setStep(s)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
              step === s ? "border-accent bg-accent text-white" : isDone(s) ? "border-good/40 bg-good-soft text-ink" : "border-line bg-surface text-ink-2",
            )}
          >
            {isDone(s) ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="font-mono">{i + 1}</span>}
            {STEP_LABEL[s]}
          </button>
        ))}
      </div>

      {step === "brief" && (
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-accent">{CAPSTONE_BRIEF.company}</div>
          <p className="mt-2 text-sm text-ink-2">
            <strong className="text-ink">Volume:</strong> {CAPSTONE_BRIEF.volume}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            <strong className="text-ink">Goal:</strong> {CAPSTONE_BRIEF.goal}
          </p>
          <div className="mt-3 text-sm font-semibold text-ink">Constraints</div>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">
            {CAPSTONE_BRIEF.constraints.map((c) => (
              <li key={c} className="my-0.5">
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-3 text-sm font-semibold text-ink">Targets you will be evaluated against (on 60 held-out calls)</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Stat label="System accuracy (after review)" value={`≥ ${fmtPct(CAPSTONE_TARGETS.systemAccuracy, 0)}`} />
            <Stat label="Human review rate" value={`≤ ${fmtPct(CAPSTONE_TARGETS.maxReviewRate, 0)}`} />
            <Stat label="LLM cost" value={`≤ ${fmtUsd(CAPSTONE_TARGETS.maxCostPer1k)} / 1K`} />
          </div>
          <Button
            variant="primary"
            className="mt-4"
            onClick={() => {
              capstoneStep("brief", { done: true });
              setStep("design");
            }}
          >
            Accept the brief
          </Button>
        </Card>
      )}

      {step === "design" && (
        <DesignStep
          onDone={(score, data) => {
            capstoneStep("design", { done: score >= 0.7, score, data });
          }}
        />
      )}

      {step === "build" && (
        <Card className="p-5">
          <div className="text-sm text-ink-2">Build your pipeline in the Workflow Playground. The builder checks these requirements automatically:</div>
          <ul className="mt-2 grid gap-1 text-sm text-ink-2 sm:grid-cols-2">
            {["PII redaction before any LLM call", "Intent classification", "Product extraction", "Confidence gate (router on confidence)", "Human review for low confidence", "Structured final output", "Persistence (checkpointer) on", "No linter errors; runs on 3 test calls"].map((r) => (
              <li key={r} className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-ink-3" />
                {r}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href="/lab/playground?exercise=ex-capstone-build">
              <Button variant="primary" icon={<Wrench className="h-4 w-4" />}>
                Open the builder
              </Button>
            </Link>
            {buildDone ? <Badge tone="good">✓ requirements passed</Badge> : <Badge>not passed yet</Badge>}
          </div>
          {draft && (
            <div className="mt-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Your current pipeline</div>
              <FlowDiagram spec={draft} maxHeight={420} compact />
            </div>
          )}
        </Card>
      )}

      {step === "evaluate" && (
        <Card className="p-5">
          {!draft || !buildDone ? (
            <Callout kind="warn">Finish the Build step first — the evaluation runs YOUR pipeline.</Callout>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="text-sm text-ink-2">
                Runs your pipeline on 60 held-out calls (30 hard handcrafted + 30 generated). Paused calls are resolved by a simulated expert reviewer. Each review costs human time; each LLM call
                costs tokens.
              </div>
              <div className="flex items-center gap-3">
                <Button variant="primary" onClick={() => runEval(draft)} disabled={busy} icon={<Play className="h-4 w-4" />}>
                  Run evaluation
                </Button>
                {busy && <ProgressBar value={progress} className="max-w-xs" />}
              </div>
              {evalData && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Model accuracy" value={fmtPct(evalData.summary.modelAcc)} sub="before review" />
                    <Stat label="System accuracy" value={fmtPct(evalData.summary.systemAcc)} sub="after review" />
                    <Stat label="Macro F1 (system)" value={evalData.summary.macroF1.toFixed(3)} />
                    <Stat label="Avg model latency" value={fmtMs(evalData.summary.avgLatency)} />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {targetChecks(evalData.summary).map((c) => (
                      <div key={c.label} className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-sm", c.ok ? "border-good/40 bg-good-soft" : "border-bad/40 bg-bad-soft")}>
                        <span className="text-ink">{c.label}</span>
                        <span className="font-mono text-ink">
                          {c.value} {c.ok ? "✓" : "✗"}
                        </span>
                      </div>
                    ))}
                  </div>
                  {!targetChecks(evalData.summary).every((c) => c.ok) && (
                    <Callout kind="warn" title="Targets not met — iterate">
                      Adjust your pipeline in the builder (model per node, prompt versions, threshold) and re-run. Improving one target often costs another — that&apos;s the point.
                    </Callout>
                  )}
                </>
              )}
            </div>
          )}
        </Card>
      )}

      {step === "analyze" && (
        <Card className="p-5">
          {!evalData ? (
            <Callout kind="warn">Run the evaluation first.</Callout>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Model predictions (before review)</div>
                  {(() => {
                    const r = classificationReport(evalData.slim.map((x) => ({ expected: x.expected, predicted: x.model })), [...INTENTS]);
                    return <ConfusionMatrix labels={r.labels} predictedLabels={r.predictedLabels} matrix={r.matrix} />;
                  })()}
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Your task</div>
                  <p className="text-sm text-ink-2">Group the model&apos;s errors by slice. Which tag (with at least 3 calls) has the highest model error rate?</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {slices.map((s) => (
                      <button key={s.t} onClick={() => setSlicePick(s.t)} className={cn("rounded-md border px-2 py-1 text-xs", slicePick === s.t ? "border-accent bg-accent-soft" : "border-line")}>
                        {s.t}
                      </button>
                    ))}
                  </div>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="primary"
                    disabled={!slicePick}
                    onClick={() => {
                      const ok = slicePick === slices[0]?.t || (slices[0] && slices.find((s) => s.t === slicePick)?.rate === slices[0].rate);
                      capstoneStep("analyze", { done: !!ok, data: { pick: slicePick } });
                    }}
                  >
                    Check
                  </Button>
                  {cap.analyze && (cap.analyze.done ? <Callout kind="success" className="mt-3">Correct. That&apos;s where to focus guideline and prompt work next.</Callout> : <Callout kind="warn" className="mt-3">Not the worst slice — count errors per tag.</Callout>)}
                </div>
              </div>
              {cap.analyze?.done && (
                <HBarChart max={1} format={(v) => fmtPct(v, 0)} data={slices.map((s) => ({ label: s.t, sub: `n=${s.n}`, value: s.rate, color: s.rate > 0.2 ? "var(--s8)" : "var(--s1)" }))} />
              )}
            </div>
          )}
        </Card>
      )}

      {step === "regression" && (
        <Card className="p-5">
          {!evalData || !draft ? (
            <Callout kind="warn">Run the evaluation first — it is your baseline.</Callout>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="text-sm text-ink-2">A teammate proposes a change to cut cost. Apply it to your pipeline, run it on the same 60 calls, and decide whether to ship.</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Model for all LLM nodes">
                  <ModelSelect value={variantModel} onChange={setVariantModel} />
                </Field>
                <Field label="Intent prompt version">
                  <Segmented size="sm" value={variantPrompt} onChange={setVariantPrompt} options={["v2", "v3", "v4"].map((v) => ({ id: v, label: v.toUpperCase() }))} />
                </Field>
                <div className="flex items-end">
                  <Button variant="primary" onClick={runVariant} disabled={busy} icon={<Play className="h-4 w-4" />}>
                    Run candidate
                  </Button>
                </div>
              </div>
              {busy && <ProgressBar value={progress} />}
              {candidate && regDiff && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Stat label="Model accuracy" value={`${fmtPct(evalData.summary.modelAcc, 0)} → ${fmtPct(candidate.summary.modelAcc, 0)}`} />
                    <Stat label="Fixed / regressed" value={`${regDiff.fixed} / ${regDiff.regressed}`} tone={regDiff.regressed > regDiff.fixed ? "bad" : "good"} />
                    <Stat label="Review rate" value={`${fmtPct(evalData.summary.reviewRate, 0)} → ${fmtPct(candidate.summary.reviewRate, 0)}`} />
                    <Stat label="Cost / 1K" value={`${fmtUsd(evalData.summary.costPer1k)} → ${fmtUsd(candidate.summary.costPer1k)}`} />
                    <Stat label="Errors" value={candidate.summary.errors} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">Your call:</span>
                    <Button size="sm" variant={decision === "ship" ? "primary" : "outline"} onClick={() => setDecision("ship")}>
                      Ship it
                    </Button>
                    <Button size="sm" variant={decision === "hold" ? "primary" : "outline"} onClick={() => setDecision("hold")}>
                      Don&apos;t ship
                    </Button>
                    {decision && (
                      <Button
                        size="sm"
                        onClick={() => {
                          const ok = (decision === "ship") === regDiff.shouldShip;
                          capstoneStep("regression", { done: ok, data: { variantModel, variantPrompt, decision, shouldShip: regDiff.shouldShip } });
                        }}
                      >
                        Submit decision
                      </Button>
                    )}
                  </div>
                  {cap.regression?.data !== undefined && decision && (
                    <Callout kind={cap.regression.done ? "success" : "warn"} title={cap.regression.done ? "Data-driven decision ✓" : "The data says otherwise"}>
                      Rule of thumb used here: ship only if model accuracy doesn&apos;t drop more than 1 point, regressions ≤ fixes, and cost, review rate and errors stay within targets. For this
                      candidate that means: <strong>{regDiff.shouldShip ? "ship" : "don't ship"}</strong>.
                    </Callout>
                  )}
                </>
              )}
            </div>
          )}
        </Card>
      )}

      {step === "final" && (
        <Card className="p-5">
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Design review" value={`${Math.round(designScore * 100)}%`} tone={designScore >= 0.7 ? "good" : "warn"} />
            <Stat label="Build" value={buildDone ? "passed" : "—"} tone={buildDone ? "good" : undefined} />
            <Stat label="System accuracy" value={evalData ? fmtPct(evalData.summary.systemAcc) : "—"} tone={cap.evaluate?.done ? "good" : undefined} />
            <Stat label="Steps complete" value={`${doneCount}/${CAPSTONE_STEPS.length}`} />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-sm font-semibold text-ink">What you did well</div>
              <ul className="list-disc pl-5 text-sm text-ink-2">
                {designScore >= 0.7 && <li>Sound architecture choices for routing, human review and evaluation.</li>}
                {buildDone && <li>Built a compliant pipeline: redaction first, confidence gate, persistence.</li>}
                {cap.evaluate?.done && <li>Met quality, cost and review-rate targets on held-out calls.</li>}
                {cap.analyze?.done && <li>Found the weakest slice through error analysis.</li>}
                {cap.regression?.done && <li>Made a release decision from per-example regression data.</li>}
                {doneCount <= 1 && <li>Started — complete the steps to get detailed feedback.</li>}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-sm font-semibold text-ink">What to improve next</div>
              <ul className="list-disc pl-5 text-sm text-ink-2">
                {(improvements.length ? improvements : ["Run the evaluation to get data-driven suggestions."]).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon={<Download className="h-4 w-4" />} onClick={report}>
              Download report (.md)
            </Button>
            <Button
              variant="primary"
              disabled={CAPSTONE_STEPS.filter((s) => s !== "final").some((s) => !isDone(s))}
              onClick={() => capstoneStep("final", { done: true, score: doneCount / CAPSTONE_STEPS.length })}
            >
              {isDone("final") ? "Capstone complete ✓" : "Complete capstone"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
