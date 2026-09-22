"use client";

import { ArrowRight, Wrench } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { WorkflowRunner } from "@/components/graph/WorkflowRunner";
import { CodeBlock, Exercise, LessonShell, QuickCheck, Steps, Term, TryIt, WhyCard } from "@/components/learn/Learn";
import { Badge, Button, Callout, Card } from "@/components/ui";
import { DEBUG_CHALLENGES } from "@/content/debugChallenges";
import { cn } from "@/lib/utils";
import { getTemplate, LADDER } from "@/lib/workflows/templates";

const DEFAULT_INPUT: Record<string, string> = {
  simple_chain: "t01",
  sequential: "t06",
  parallel: "t17",
  routing: "t13",
  loop: "t10",
  stateful: "t04",
  hitl: "t03",
  agentic: "t29",
};

export default function Ladder() {
  const [idx, setIdx] = useState(0);
  const stage = LADDER[idx];
  const spec = useMemo(() => getTemplate(stage.id), [stage.id]);
  return (
    <LessonShell id="a4-ladder">
      <p>
        Every rung below adds exactly one capability — and one new way to fail. The engineering skill is choosing the <strong>lowest rung that meets the requirements</strong>. Click through
        the ladder, run each workflow, and read the “watch out” note.
      </p>
      <div className="my-5 flex flex-wrap items-center gap-1.5">
        {LADDER.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <button
              onClick={() => setIdx(i)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                i === idx ? "border-accent bg-accent text-white" : i < idx ? "border-accent/40 bg-accent-soft text-ink" : "border-line bg-surface text-ink-2 hover:border-line-strong",
              )}
            >
              {i + 1}. {s.title}
            </button>
            {i < LADDER.length - 1 && <ArrowRight className="h-3 w-3 text-ink-3" />}
          </span>
        ))}
      </div>
      <Card className="mb-4 grid gap-3 p-4 md:grid-cols-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-accent">What&apos;s new</div>
          <div className="mt-0.5 text-sm text-ink">{stage.whatsNew}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-good-ink">Use it when</div>
          <div className="mt-0.5 text-sm text-ink-2">{stage.whenToUse}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bad-ink">Watch out</div>
          <div className="mt-0.5 text-sm text-ink-2">{stage.watch}</div>
        </div>
      </Card>
      <WorkflowRunner
        key={stage.id}
        spec={spec}
        defaultTranscript={DEFAULT_INPUT[stage.id] ?? "t01"}
        panels={["state", "inspect", "trace", "python"]}
        header={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-ink">
              {idx + 1}. {spec.name.replace(/^\d+ · /, "")} <span className="font-normal text-ink-3">— {spec.description}</span>
            </div>
            <Link href={`/lab/playground?template=${stage.id}`}>
              <Button size="sm" variant="outline" icon={<Wrench className="h-3.5 w-3.5" />}>
                Edit in Playground
              </Button>
            </Link>
          </div>
        }
      />
      <h2>Choosing a rung: a decision guide</h2>
      <div className="my-4 overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-3 py-2">If you need…</th>
              <th className="px-3 py-2">Minimum rung</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-surface text-ink-2">
            {[
              ["One label from one prompt", "Simple chain (a plain function is fine)"],
              ["Several dependent steps", "Sequential"],
              ["Lower latency for independent analyses", "Parallel"],
              ["Different handling per label/confidence", "Conditional routing"],
              ["Recovery from invalid outputs", "Loop (bounded)"],
              ["Resume, audit, replay", "Stateful (checkpointer)"],
              ["A person must approve/correct", "Human-in-the-loop"],
              ["Steps that can't be known in advance", "Agentic (bounded, with approvals)"],
            ].map(([a, b]) => (
              <tr key={a}>
                <td className="px-3 py-2">{a}</td>
                <td className="px-3 py-2 font-medium text-ink">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Exercise id="ex-sentiment-review" />
      <Exercise id="ex-intent-routing" />
    </LessonShell>
  );
}

// ================================================================ Debugging
export function Debugging() {
  const broken = useMemo(() => DEBUG_CHALLENGES[0].spec, []);
  return (
    <LessonShell id="a4-debugging">
      <Steps items={["Reproduce", "Locate (trace)", "Inspect (prompt → raw → parsed → state)", "Hypothesize", "Fix", "Verify (regression)"]} />
      <p>
        LLM workflows fail in two ways: <strong>loudly</strong> (an exception in a node) and <strong>silently</strong> (a wrong route, an invented fact, a PII leak — no error anywhere).
        Loud failures you debug with a <Term>Trace</Term>. Silent ones you only find with evaluation and monitoring. This lesson is about building the habit of reading the whole chain of
        custody for one run.
      </p>
      <h2>A failing run</h2>
      <p>Run it. The error box shows Expected vs Received. Then open Classify intent in the inspector and walk the chain: Prompt → LLM output → Parsed. Where does it break?</p>
      <WorkflowRunner spec={broken} defaultTranscript="t01" panels={["inspect", "trace", "state"]} allowCustom={false} />
      <h2>Failure taxonomy</h2>
      <div className="my-4 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-3 py-2">Symptom</th>
              <th className="px-3 py-2">Where to look</th>
              <th className="px-3 py-2">Typical cause</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-surface text-ink-2">
            {[
              ["OutputParserException", "Raw output vs expected schema", "Prompt doesn't specify format; wrong casing/keys; truncation"],
              ["Empty / cut-off output", "stop_reason, output + reasoning tokens", "max_tokens too low (reasoning models!)"],
              ["KeyError / TypeError in router", "State after the previous node", "Producer/consumer key mismatch; None not handled"],
              ["InvalidUpdateError", "The parallel step's updates", "Two branches write a key without a reducer"],
              ["GraphRecursionError", "Repeated spans in the trace", "Loop exit unreachable; no attempt counter"],
              ["Wrong route, no error", "Route decisions + router unit tests", "Swapped branches, inverted comparison, uncalibrated confidence"],
              ["Duplicate side effects", "Spans before/after interrupts & retries", "Non-idempotent code before interrupt(); retries"],
              ["Plausible but wrong answers", "Evaluation set + error analysis by slice", "Ambiguous guidelines, hard cases, weak prompt/model"],
            ].map((r) => (
              <tr key={r[0]}>
                <td className="px-3 py-2 font-mono text-xs text-ink">{r[0]}</td>
                <td className="px-3 py-2">{r[1]}</td>
                <td className="px-3 py-2">{r[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <WhyCard
        what={<>A systematic way to go from symptom to root cause using traces: per-node input, prompt, raw output, parsed output, state diff, timing, tokens.</>}
        why={<>LLM bugs are rarely in one line of code. They live between components: a prompt and a parser, a node and a router, a model and a token budget.</>}
        when={<>Every failed run in development, and every misrouted / complained-about case from production.</>}
        whenNot={<>Don't debug aggregate metrics one example at a time forever — once you've found a pattern, write an eval slice for it and fix at scale.</>}
        how={<>Reproduce with the same input (and temperature 0), read the trace, form ONE hypothesis, change ONE thing, re-run the failing case AND your regression set.</>}
        real={<>A misrouted lead → trace shows confidence 0.91 on a sarcastic call → prompt lacked the sarcasm guideline → V3 prompt → re-run the 'sarcasm' slice: 3/4 fixed, no regressions.</>}
      />
      <h2>Tracing in production</h2>
      <CodeBlock
        verified
        tabs={[
          {
            label: "LangSmith tracing",
            code: `# .env (server side only)
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...            # never commit
LANGSMITH_PROJECT=transcript-analysis

# LangChain / LangGraph runs are then traced automatically:
graph.invoke({"transcript": t}, {"configurable": {"thread_id": call_id},
                                  "tags": ["prompt:v3"], "metadata": {"call_id": call_id}})`,
          },
          {
            label: "debug stream",
            code: `# Everything the runtime knows, step by step (checkpoints + task starts/results/errors)
for event in graph.stream({"transcript": t}, config, stream_mode="debug"):
    print(event)`,
          },
        ]}
      />
      <h2>Practice on eight broken workflows</h2>
      <div className="my-4 grid gap-2 sm:grid-cols-2">
        {DEBUG_CHALLENGES.map((c) => (
          <Link key={c.id} href={`/lab/playground?challenge=${c.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-line-strong">
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink">{c.title}</span>
              <span className="text-xs text-ink-3">{c.category}</span>
            </span>
            <Badge>{"●".repeat(c.difficulty)}</Badge>
          </Link>
        ))}
      </div>
      <Callout kind="tip">The Debugging Lab tracks which challenges you&apos;ve diagnosed and fixed — they count toward your dashboard.</Callout>
      <QuickCheck
        q={{
          id: "a4dbg",
          scenario: "A call was routed to 'auto-approve' but it's clearly a complaint. There's no error in the logs.",
          question: "What's your first debugging step?",
          options: [
            { text: "Rewrite the prompt", why: "You don't know yet which step is wrong." },
            { text: "Open the trace for that call: check the classifier's raw/parsed output, the confidence, and the route decision", correct: true, why: "Locate before you fix. It could be the model, the router logic or the threshold." },
            { text: "Switch to a bigger model", why: "Expensive guess." },
            { text: "Add a retry", why: "Nothing failed; retrying won't change a wrong-but-valid answer at temperature 0." },
          ],
          takeaway: "Locate → inspect → hypothesize → fix → verify.",
        }}
      />
      <TryIt title="Debugging Lab" href="/lab/debug" cta="Open">
        Diagnose from traces, fix in the builder, and verify automatically.
      </TryIt>
    </LessonShell>
  );
}
