"use client";

import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Sparkline } from "@/components/charts/Charts";
import { NodeInspector, TraceTable } from "@/components/graph/Inspectors";
import { TranscriptPicker } from "@/components/graph/WorkflowRunner";
import { CostCalculator } from "@/components/labs/CostCalculator";
import { LatencySim } from "@/components/labs/LatencySim";
import { CodeBlock, Exercise, LessonShell, QuickCheck, Steps, Term, TryIt, WhyCard } from "@/components/learn/Learn";
import { Badge, Button, Callout, Card } from "@/components/ui";
import { transcriptToText } from "@/lib/domain";
import { MemoryCheckpointer } from "@/lib/engine/checkpointer";
import type { NodeSpan, RunTrace } from "@/lib/engine/types";
import { mulberry32 } from "@/lib/sim/rng";
import { findTranscript } from "@/lib/sim/transcripts";
import { cn, fmtMs, fmtUsd } from "@/lib/utils";
import { runWorkflow } from "@/lib/workflows/run";
import { getTemplate } from "@/lib/workflows/templates";

// ================================================================ B4.1 Cost
export default function Cost() {
  return (
    <LessonShell id="b4-cost">
      <Steps items={["Tokens", "Prices", "Your workload", "Levers"]} />
      <p>
        LLM cost is simple arithmetic that surprises everyone at scale: <strong>(input tokens × input price + output tokens × output price) × calls</strong>. For transcript analysis the
        input side usually dominates — long transcripts, long instructions, few-shot examples — and it&apos;s paid on <em>every</em> call, by <em>every</em> node.
      </p>
      <CostCalculator compact />
      <div className="my-4 grid gap-2 sm:grid-cols-2">
        {[
          ["Shorter prompts", "Remove unused instructions; move examples out if a regression test says they're not needed."],
          ["Fewer calls per transcript", "One structured call vs four separate nodes: 4× fewer transcript tokens sent."],
          ["Prompt caching", "A stable prefix (instructions, examples) at a fraction of the input price."],
          ["Batch processing", "Overnight analytics at ~50% off, if you don't need results in seconds."],
          ["Smaller models", "Often good enough for easy calls — route only hard ones to a big model."],
          ["Reasoning budget", "Reasoning tokens are billed as output; don't pay for thinking on trivial classification."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="text-sm font-semibold text-ink">{t}</div>
            <div className="text-xs text-ink-2">{d}</div>
          </div>
        ))}
      </div>
      <WhyCard
        what={<><Term>Token</Term> counts × per-token <Term t="Cost per 1K calls">prices</Term>, summed over every LLM call in the workflow, including retries and judges.</>}
        why={<>A design that costs $0.002 per call looks free in a demo and becomes a five-figure monthly line item at 20,000 calls/day.</>}
        when={<>Estimate before building, measure in every experiment (cost per 1K calls), and monitor in production.</>}
        whenNot={<>Don't optimize cost before quality is acceptable — a cheap wrong answer is expensive downstream.</>}
        how={<>Read <code>usage</code> from every response (input/output/reasoning/cached tokens), multiply by a versioned price table, aggregate per node, per prompt version, per day.</>}
        real={<>Moving the 900-token guideline block into a cached prefix cut input cost by ~70% with zero quality change (verified by the regression suite).</>}
      />
      <CodeBlock
        verified
        tabs={[
          {
            label: "track usage per call",
            code: `PRICES = load_price_table("prices-2026-09.yaml")   # configuration, not code

response = model.invoke(messages)
usage = response.usage_metadata            # {'input_tokens', 'output_tokens', 'total_tokens', ...}
cost = (usage["input_tokens"] * PRICES[model_name]["input_per_1m"]
        + usage["output_tokens"] * PRICES[model_name]["output_per_1m"]) / 1_000_000
log_metric("llm_cost_usd", cost, tags={"node": "classify_intent", "prompt": "v3"})`,
          },
        ]}
      />
      <Exercise id="ex-cost-estimate" />
      <TryIt title="Full Cost Lab" href="/lab/cost" cta="Open Cost Lab">
        Compare all models on your workload, see how prompt and output length scale the bill, and edit the price table.
      </TryIt>
    </LessonShell>
  );
}

// ================================================================ B4.2 Latency
export function Latency() {
  return (
    <LessonShell id="b4-latency">
      <p>
        <Term>Latency</Term> has parts: network, queueing, <Term>TTFT</Term> (the model reading your prompt and starting to answer), and generation time (proportional to output tokens). In
        a workflow, latencies of sequential steps <strong>add up</strong>; parallel steps cost only the slowest. And because latency has a long tail, the number users feel is the{" "}
        <Term>P95 latency</Term>, not the average.
      </p>
      <LatencySim compact />
      <Callout kind="tip" title="Notice the tail">
        In parallel mode, P95 is noticeably worse than any single branch&apos;s P95 — the step waits for the slowest of four random draws. Parallelism shortens the median a lot and the tail
        a little.
      </Callout>
      <WhyCard
        what={<>Time from request to response: TTFT + generation (+ network, queueing, tools). Reported as percentiles: P50, P95, P99.</>}
        why={<>An agent-assist screen that takes 4 s on 1 call in 20 feels broken, whatever the average says.</>}
        when={<>Real-time uses (live agent assist, chat) need tight P95 budgets; overnight batch analytics barely care.</>}
        whenNot={<>Don't optimize latency for batch jobs at the expense of cost or quality.</>}
        how={<>Parallelize independent steps, shorten outputs (generation dominates long answers), stream to cut perceived latency, avoid reasoning models for trivial steps, set timeouts.</>}
        real={<>Sequential 4-node pipeline P95 3.4 s → parallel 1.4 s → single structured call 1.1 s (but that one prompt is harder to evaluate per field).</>}
      />
      <Exercise id="ex-latency-sla" />
      <TryIt title="Full Latency Lab" href="/lab/latency" cta="Open Latency Lab">
        Tune per-step latencies, generation speed, network overhead and tail heaviness; compare architectures by P50/P95/P99.
      </TryIt>
    </LessonShell>
  );
}

// ================================================================ B4.3 Observability
function TraceDemo() {
  const spec = useMemo(() => getTemplate("transcript_pipeline"), []);
  const [tid, setTid] = useState("t17");
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [sel, setSel] = useState<NodeSpan | null>(null);
  const run = async () => {
    const t = findTranscript(tid)!;
    const cpr = new MemoryCheckpointer();
    const tr = await runWorkflow(spec, { transcript: transcriptToText(t), transcript_id: t.id }, { checkpointer: cpr, threadId: `call-${t.id}` });
    setTrace(tr);
    setSel(tr.spans.find((s) => s.kind === "llm") ?? null);
  };
  const node = sel ? spec.nodes.find((n) => n.id === sel.node.replace(/\[\d+\]$/, "")) : undefined;
  return (
    <Card className="my-6 p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <TranscriptPicker value={tid} onChange={setTid} allowCustom={false} />
        </div>
        <Button variant="primary" onClick={run} icon={<Play className="h-4 w-4" />}>
          Run & trace the full pipeline
        </Button>
      </div>
      {trace && (
        <div className="fade-in flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Badge>trace {trace.runId.slice(-8)}</Badge>
            <Badge>thread {trace.threadId}</Badge>
            <Badge tone={trace.status === "success" ? "good" : "warn"}>{trace.status}</Badge>
            <Badge>{fmtMs(trace.totals.simLatencyMs)}</Badge>
            <Badge>{trace.totals.llmCalls} LLM calls</Badge>
            <Badge>{trace.totals.inputTokens + trace.totals.outputTokens} tokens</Badge>
            <Badge>{fmtUsd(trace.totals.costUsd, { precise: true })}</Badge>
          </div>
          <TraceTable spans={trace.spans} routes={trace.routes} onSelect={setSel} selectedId={sel?.id} />
          {node && sel && (
            <div className="rounded-lg border border-line p-3">
              <NodeInspector key={sel.id} node={node} spans={[sel]} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function days(n: number) {
  return Array.from({ length: n }, (_, i) => i + 1);
}

function MonitoringDashboard() {
  const [drift, setDrift] = useState(true);
  const rng = mulberry32(7);
  const d = days(21);
  const noise = (base: number, amp: number) => d.map(() => base + (rng() - 0.5) * amp);
  const invalid = noise(0.004, 0.003).map((v, i) => (drift && i >= 14 ? v + 0.028 : v));
  const review = noise(0.11, 0.02).map((v, i) => (drift && i >= 14 ? v + 0.07 : v));
  const p95 = noise(1450, 180).map((v, i) => (drift && i >= 14 ? v + 380 : v));
  const cost = noise(96, 8);
  const feedback = noise(0.93, 0.03).map((v, i) => (drift && i >= 15 ? v - 0.08 : v));
  const tiles: { label: string; values: number[]; fmt: (v: number) => string; bad?: boolean }[] = [
    { label: "Invalid-output rate", values: invalid, fmt: (v) => `${(v * 100).toFixed(1)}%`, bad: drift },
    { label: "Human review rate", values: review, fmt: (v) => `${(v * 100).toFixed(0)}%`, bad: drift },
    { label: "P95 latency", values: p95, fmt: (v) => fmtMs(v), bad: drift },
    { label: "Cost / day", values: cost, fmt: (v) => `$${v.toFixed(0)}` },
    { label: "Reviewer agreement with model", values: feedback, fmt: (v) => `${(v * 100).toFixed(0)}%`, bad: drift },
  ];
  return (
    <Card className="my-6 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-ink">Production monitor · last 21 days</div>
        <Button size="sm" variant="ghost" onClick={() => setDrift(!drift)}>
          {drift ? "Hide incident" : "Show incident"}
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className={cn("rounded-lg border px-3 py-2", t.bad ? "border-bad/40" : "border-line")}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{t.label}</div>
            <div className="num mt-0.5 text-lg font-semibold text-ink">{t.fmt(t.values[t.values.length - 1])}</div>
            <Sparkline values={t.values} color={t.bad ? "var(--s8)" : "var(--s1)"} />
          </div>
        ))}
      </div>
      {drift && (
        <Callout kind="danger" className="mt-3" title="Day 15: provider updated the model behind the alias">
          Invalid outputs jumped (the new version wraps JSON in prose more often), more calls fell below the confidence threshold, reviewers started disagreeing with the model. Nothing
          crashed. Only monitoring noticed. Fix: pin the model version, add the new failure examples to the dataset, re-run the regression suite before upgrading.
        </Callout>
      )}
    </Card>
  );
}

export function Observability() {
  return (
    <LessonShell id="b4-observability">
      <p>
        <Term>Observability</Term> means you can answer “what happened, and why?” for any run — and notice when behaviour changes. For LLM systems the core unit is the <Term>Trace</Term>: a
        tree of <Term>Span</Term>s, one per node, LLM call or tool call, each with inputs, outputs, prompt version, tokens, latency and errors.
      </p>
      <h2>One request, fully traced</h2>
      <TraceDemo />
      <h2>What to record for every LLM call</h2>
      <div className="my-4 grid gap-2 sm:grid-cols-2">
        {[
          ["Identity", "trace id, thread id (call id), node, prompt version, model + version"],
          ["Inputs", "rendered prompt (PII-redacted!), parameters (temperature, max_tokens)"],
          ["Outputs", "raw output, parsed output, validation result, stop reason"],
          ["Cost & speed", "input/output/reasoning/cached tokens, TTFT, total latency, cost"],
          ["Decisions", "route taken and why, retries, interrupts and human decisions"],
          ["Feedback", "reviewer corrections, user thumbs, downstream outcomes (did the lead convert?)"],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="text-sm font-semibold text-ink">{t}</div>
            <div className="text-xs text-ink-2">{d}</div>
          </div>
        ))}
      </div>
      <h2>From traces to monitoring</h2>
      <p>Aggregate traces into a few model-facing metrics and alert on change. This dashboard shows a very typical silent incident:</p>
      <MonitoringDashboard />
      <WhyCard
        what={<>Traces (per-run detail), metrics (aggregates over time), logs (events) and feedback (human signals), connected by ids.</>}
        why={<>LLM systems degrade silently: provider updates, new call patterns, prompt edits. Without telemetry you learn about it from angry users.</>}
        when={<>From the first prototype (tracing is the best debugger) through production (monitoring and alerting).</>}
        whenNot={<>Don't log raw PII or secrets into third-party tracing tools; redact first, sample if volume is huge.</>}
        how={<>Use a tracing tool (e.g. LangSmith, or OpenTelemetry-based platforms), tag runs with prompt/model versions, build dashboards for invalid rate, review rate, P95, cost, feedback agreement.</>}
        real={<>An alert on “invalid-output rate &gt; 1% for 1 hour” caught a provider model change within an hour instead of a week.</>}
      />
      <CodeBlock
        verified
        tabs={[
          {
            label: "LangSmith",
            code: `# environment (server side)
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=transcript-analysis-prod

# tag runs so you can slice metrics by version later
graph.invoke(inputs, {
    "configurable": {"thread_id": call_id},
    "tags": ["intent-prompt:v3", "model:gpt-5.4-mini"],
    "metadata": {"call_id": call_id, "campaign": "home-loans-q3"},
})`,
          },
          {
            label: "custom spans (any stack)",
            code: `from langsmith import traceable

@traceable(name="redact_pii", run_type="tool")
def redact_pii(text: str) -> str:
    ...

@traceable(name="post_to_crm", run_type="tool")
def post_to_crm(result: dict) -> None:
    ...`,
          },
        ]}
      />
    </LessonShell>
  );
}

// ================================================================ B4.4 Production loop
const LOOP = [
  { id: "build", label: "Build", sub: "prompt + workflow (versioned)" },
  { id: "evaluate", label: "Evaluate", sub: "dataset + metrics + regression" },
  { id: "deploy", label: "Deploy", sub: "pinned model, flags, budgets" },
  { id: "trace", label: "Trace & monitor", sub: "quality, cost, latency, drift" },
  { id: "feedback", label: "Collect feedback", sub: "reviews, corrections, outcomes" },
  { id: "analyze", label: "Error analysis", sub: "slices, confusion, root causes" },
  { id: "curate", label: "Curate dataset", sub: "add hard cases & failures" },
];

function LoopDiagram() {
  const [sel, setSel] = useState<string | null>("analyze");
  const R = 150;
  const cx = 320;
  const cy = 190;
  return (
    <Card className="my-6 p-4">
      <svg viewBox="0 0 640 380" className="h-auto w-full" role="img" aria-label="production improvement loop">
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--grid)" strokeWidth={2} strokeDasharray="4 6" />
        {LOOP.map((s, i) => {
          const a = (i / LOOP.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + R * Math.cos(a);
          const y = cy + R * Math.sin(a);
          const active = sel === s.id;
          return (
            <g key={s.id} onClick={() => setSel(s.id)} style={{ cursor: "pointer" }}>
              <rect x={x - 70} y={y - 22} width={140} height={44} rx={10} fill={active ? "var(--accent)" : "var(--surface)"} stroke={active ? "var(--accent)" : "var(--border-strong)"} />
              <text x={x} y={y - 3} textAnchor="middle" fontSize="12" fontWeight={600} fill={active ? "#fff" : "var(--ink)"}>
                {s.label}
              </text>
              <text x={x} y={y + 12} textAnchor="middle" fontSize="9.5" fill={active ? "rgba(255,255,255,.85)" : "var(--ink-3)"}>
                {s.sub}
              </text>
            </g>
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="13" fontWeight={600} fill="var(--ink)">
          The LLMOps loop
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">
          every turn makes the dataset harder
        </text>
      </svg>
      {sel && (
        <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
          {
            {
              build: "Change one thing at a time: a prompt version, a model, a routing rule. Everything versioned, so every result is attributable.",
              evaluate: "Run the frozen dataset: quality per slice, invalid rate, cost per 1K, P95. Compare per example against the baseline. Block regressions.",
              deploy: "Pin model versions, roll out gradually (shadow / canary), set budgets and rate limits, keep a rollback path.",
              trace: "Every run traced; dashboards and alerts on model-facing metrics (invalid rate, review rate, P95, cost, reviewer agreement).",
              feedback: "Human review corrections, agent thumbs-down, and business outcomes (did the lead convert?) — tied to trace ids.",
              analyze: "Group failures: confusion matrix, slices (sarcasm, callbacks, Hinglish), trace inspection. Find the few causes behind most errors.",
              curate: "Add the new failure cases to the evaluation dataset with tags. Your test set now covers what actually breaks in production.",
            }[sel]
          }
        </div>
      )}
    </Card>
  );
}

export function ProductionLoop() {
  return (
    <LessonShell id="b4-production-loop">
      <p>
        Everything in this lab connects into one loop. Datasets feed evaluation; evaluation gates deployment; tracing and feedback find new failures; error analysis turns them into dataset
        examples; the next change is tested against them. Teams that run this loop improve steadily. Teams that don&apos;t, re-discover the same bugs.
      </p>
      <LoopDiagram />
      <h2>Production-readiness checklist</h2>
      <div className="my-4 grid gap-2 sm:grid-cols-2">
        {[
          "Structured outputs with schema validation on every LLM call",
          "Prompts and models versioned; model versions pinned",
          "A labeled dataset with hard-case slices, frozen per version",
          "Regression run on every change, per-example diff reviewed",
          "Confidence/validity-based routing to human review, with measured review rate",
          "PII redaction before any model call; no secrets in state or traces",
          "Tracing with prompt/model tags; dashboards for invalid rate, review rate, P95, cost",
          "Budgets, rate limits, timeouts, retries with bounds",
          "Idempotent side effects (safe under retries/resume)",
          "Human feedback flows back into the dataset",
        ].map((c) => (
          <label key={c} className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-2">
            <input type="checkbox" className="mt-1 accent-[var(--accent)]" />
            {c}
          </label>
        ))}
      </div>
      <QuickCheck
        q={{
          id: "b4pl",
          scenario: "Reviewers corrected 180 predictions last month. Most corrections are on calls where the customer asked for a callback.",
          question: "What's the highest-leverage next step?",
          options: [
            { text: "Switch to the most expensive model", why: "Maybe, but you haven't identified the cause." },
            { text: "Add these corrections (tagged 'callback') to the dataset, check the guideline for callbacks, change the prompt, and run the regression suite", correct: true, why: "That's the loop: feedback → dataset → targeted fix → verified improvement." },
            { text: "Lower the review threshold so reviewers see fewer calls", why: "Hides the problem instead of fixing it." },
          ],
          takeaway: "Production failures are your best test cases.",
        }}
      />
      <TryIt title="Put it all together" href="/capstone" cta="Start the capstone">
        Design, build, evaluate and defend a complete transcript-analysis system.
      </TryIt>
    </LessonShell>
  );
}
