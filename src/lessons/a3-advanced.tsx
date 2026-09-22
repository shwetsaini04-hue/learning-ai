"use client";

import { GitFork, History, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { FlowDiagram } from "@/components/graph/FlowDiagram";
import { TraceTable } from "@/components/graph/Inspectors";
import { useWorkflowRunner } from "@/components/graph/useWorkflowRunner";
import { TranscriptPicker, WorkflowRunner } from "@/components/graph/WorkflowRunner";
import { JsonBlock, StateDiffView } from "@/components/learn/JsonView";
import { CodeBlock, Exercise, LessonShell, QuickCheck, Steps, Term, TryIt, WhyCard } from "@/components/learn/Learn";
import { Badge, Button, Callout, Card, Field, Select, Slider, Stat, Toggle } from "@/components/ui";
import { INTENTS, transcriptToText } from "@/lib/domain";
import { runGraph, Send } from "@/lib/engine/graph";
import type { Checkpoint, GraphDefinition, NodeSpan, RunTrace } from "@/lib/engine/types";
import { END, START } from "@/lib/engine/types";
import { invokeLLM } from "@/lib/ai/client";
import { lognormal, rngFrom } from "@/lib/sim/rng";
import { findTranscript, TRANSCRIPTS } from "@/lib/sim/transcripts";
import { cn, fmtMs, fmtUsd } from "@/lib/utils";
import { getTemplate } from "@/lib/workflows/templates";

// ================================================================ Parallel + Send
const LONG_CALL = [TRANSCRIPTS[3], TRANSCRIPTS[18], TRANSCRIPTS[12], TRANSCRIPTS[28], TRANSCRIPTS[16]].flatMap((t) => t.turns);

function mapReduceGraph(): GraphDefinition {
  return {
    schema: {
      transcript: { reducer: "overwrite" },
      chunk_size: { reducer: "overwrite" },
      chunks: { reducer: "overwrite" },
      chunk_notes: { reducer: "append", default: [] },
      summary: { reducer: "overwrite" },
    },
    nodes: [
      {
        name: "split",
        label: "Split into chunks",
        kind: "function",
        fn: (s, ctx) => {
          const lines = String(s.transcript).split("\n");
          const size = Number(s.chunk_size);
          const chunks: string[] = [];
          for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size).join("\n"));
          ctx.addLatency(4);
          return { chunks };
        },
      },
      {
        name: "summarize_chunk",
        label: "Summarize chunk",
        kind: "llm",
        fn: (s, ctx) => {
          const chunk = String(s.chunk);
          const rng = rngFrom("chunk", chunk.length, s.index as number);
          const ms = Math.round(lognormal(rng, 650, 0.3));
          ctx.addLatency(ms);
          const customer = chunk
            .split("\n")
            .filter((l) => l.startsWith("Customer"))
            .map((l) => l.replace("Customer: ", ""))
            .slice(0, 1)
            .join(" ");
          return { chunk_notes: [`[chunk ${s.index}] ${customer.slice(0, 70)}…`] };
        },
      },
      {
        name: "combine",
        label: "Combine",
        kind: "function",
        fn: (s, ctx) => {
          ctx.addLatency(5);
          return { summary: `${(s.chunk_notes as string[]).length} chunk notes combined` };
        },
      },
    ],
    edges: [
      { source: START, target: "split" },
      { source: "summarize_chunk", target: "combine" },
      { source: "combine", target: END },
    ],
    conditionalEdges: [
      {
        source: "split",
        targets: ["summarize_chunk"],
        label: "fan out",
        route: (s) => (s.chunks as string[]).map((c, i) => Send("summarize_chunk", { chunk: c, index: i })) as unknown as string[],
        explain: (_s, r) => `Send × ${r.length}`,
      },
    ],
  };
}

function SendDemo() {
  const [size, setSize] = useState(6);
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const run = async () => {
    const t = await runGraph(mapReduceGraph(), { transcript: LONG_CALL.map((x) => `${x.speaker}: ${x.text}`).join("\n"), chunk_size: size }, { llm: invokeLLM });
    setTrace(t);
  };
  const chunkSpans = trace?.spans.filter((s) => s.node.startsWith("summarize_chunk")) ?? [];
  const seqTotal = chunkSpans.reduce((a, s) => a + s.simDurationMs, 0);
  return (
    <Card className="my-6 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Slider className="flex-1" label={`Chunk size (turns) — the call has ${LONG_CALL.length} turns`} value={size} onChange={(v) => { setSize(v); setTrace(null); }} min={2} max={20} step={1} format={(v) => `${v} → ${Math.ceil(LONG_CALL.length / v)} chunks`} />
        <Button variant="primary" onClick={run} icon={<Play className="h-4 w-4" />}>
          Run map-reduce
        </Button>
      </div>
      {trace && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Chunks (Send tasks)" value={chunkSpans.length} />
            <Stat label="Wall time (parallel)" value={fmtMs(trace.totals.simLatencyMs)} tone="good" />
            <Stat label="If run sequentially" value={fmtMs(seqTotal + 10)} />
          </div>
          <TraceTable spans={trace.spans} routes={trace.routes} />
          <JsonBlock value={{ chunk_notes: trace.finalState.chunk_notes, summary: trace.finalState.summary }} maxHeight={180} />
        </div>
      )}
    </Card>
  );
}

export default function Parallel() {
  const spec = useMemo(() => getTemplate("parallel"), []);
  return (
    <LessonShell id="a3-parallel">
      <Steps items={["Fan-out", "Super-steps", "Fan-in + reducers", "Map-reduce with Send"]} />
      <p>
        When a node has several outgoing edges, all targets run in the <strong>same</strong> <Term>Super-step</Term> — concurrently. When they finish, their updates are merged together
        (through reducers) and the next step begins. Latency becomes “the slowest branch” instead of “the sum of all branches”.
      </p>
      <WorkflowRunner spec={spec} defaultTranscript="t17" panels={["trace", "state", "inspect", "python"]} defaultPanel="trace" />
      <Callout kind="tip" title="Read the Trace tab">
        The three LLM nodes share step 2 and their timeline bars overlap. The Confidence check waits for the whole step, then runs once. Cost is unchanged — you still pay for three calls.
      </Callout>
      <WhyCard
        what={<>Fan-out = multiple edges from one node; fan-in = multiple edges into one node. Parallel nodes run in one super-step.</>}
        why={<>Independent analyses shouldn't wait for each other. It's the cheapest latency win in LLM pipelines.</>}
        when={<>Intent / product / sentiment / details are independent; chunks of a long transcript can be processed independently.</>}
        whenNot={<>When a step needs another step's output, or when you're rate-limited (parallelism multiplies requests per second).</>}
        how={<>Parallel writes to the same key need a reducer. Branches of different lengths? Mark the join node <code>defer=True</code> (or use <code>add_edge([&quot;a&quot;,&quot;b&quot;], &quot;join&quot;)</code>) so it waits for all.</>}
        real={<>Four analyses run concurrently after cleaning; the gate waits for all, then computes min(confidence).</>}
      />
      <h2>Map-reduce over a long call with <code>Send</code></h2>
      <p>
        Sometimes you don&apos;t know how many parallel tasks you need until runtime — e.g. a 45-minute call split into chunks. A routing function can return a list of <Term>Send</Term>{" "}
        objects: each launches the same node with its own input. Their results are combined with an append reducer.
      </p>
      <SendDemo />
      <CodeBlock
        verified
        tabs={[
          {
            label: "fan-out / fan-in",
            code: `builder.add_edge("clean", "classify_intent")
builder.add_edge("clean", "extract_product")
builder.add_edge("clean", "sentiment")
# join: runs once after all three (same super-step)
builder.add_edge("classify_intent", "confidence_check")
builder.add_edge("extract_product", "confidence_check")
builder.add_edge("sentiment", "confidence_check")

# uneven branches? make the join wait for everything pending:
builder.add_node("confidence_check", confidence_check, defer=True)
# …or wait for specific sources explicitly:
builder.add_edge(["classify_intent", "extract_product", "sentiment"], "confidence_check")`,
          },
          {
            label: "Send (map-reduce)",
            code: `import operator
from typing_extensions import TypedDict, Annotated
from langgraph.types import Send


class State(TypedDict):
    transcript: str
    chunks: list[str]
    chunk_notes: Annotated[list[str], operator.add]   # results from all Send tasks
    summary: str


def fan_out(state: State):
    return [Send("summarize_chunk", {"chunk": c, "index": i})
            for i, c in enumerate(state["chunks"])]

builder.add_conditional_edges("split", fan_out, ["summarize_chunk"])
builder.add_edge("summarize_chunk", "combine")`,
          },
        ]}
      />
      <Exercise id="ex-parallel" />
    </LessonShell>
  );
}

// ================================================================ Persistence
function CheckpointExplorer() {
  const spec = useMemo(() => ({ ...getTemplate("sequential"), id: "ckpt-demo", checkpointer: true }), []);
  const r = useWorkflowRunner(spec, { animate: false });
  const [tid, setTid] = useState("t14");
  const [history, setHistory] = useState<Checkpoint[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [forkIntent, setForkIntent] = useState("interested");
  const refresh = () => setHistory(r.getCheckpointer().history(r.getThreadId()));
  const run = async () => {
    const t = findTranscript(tid)!;
    await r.run({ transcript: transcriptToText(t), transcript_id: t.id });
    setSel(null);
    refresh();
  };
  const selected = history.find((c) => c.id === sel);
  const fork = async () => {
    if (!selected) return;
    await r.replayFrom(selected.id, { intent: forkIntent });
    refresh();
  };
  return (
    <Card className="my-6 p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Transcript" className="flex-1">
          <TranscriptPicker value={tid} onChange={setTid} allowCustom={false} />
        </Field>
        <Button variant="primary" onClick={run} icon={<Play className="h-4 w-4" />}>
          Run with checkpointer
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <FlowDiagram spec={spec} status={r.status} visitedEdges={r.visitedEdges} maxHeight={420} compact />
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
              <History className="h-3.5 w-3.5" /> get_state_history(config) — newest first
            </div>
            <Badge>thread {r.getThreadId().slice(-6)}</Badge>
          </div>
          {!history.length && <div className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-3">Run the graph to create checkpoints.</div>}
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {history.map((c) => (
              <button
                key={c.id}
                onClick={() => setSel(c.id)}
                className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs", sel === c.id ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}
              >
                <span className="w-14 shrink-0 font-mono text-ink-3">step {c.step}</span>
                <Badge tone={c.source === "update" ? "warn" : c.source === "input" ? "neutral" : "accent"}>{c.source}</Badge>
                <span className="min-w-0 flex-1 truncate text-ink-2">
                  wrote: {c.writers?.join(", ") || "—"} · next: <span className="font-mono">{c.next.join(", ") || "END"}</span>
                </span>
                {c.parentId && history.find((h) => h.id === c.parentId)?.source === "update" ? <GitFork className="h-3 w-3 text-warn-ink" /> : null}
              </button>
            ))}
          </div>
          {selected && (
            <div className="fade-in flex flex-col gap-2 rounded-lg border border-line p-3">
              <div className="text-xs text-ink-3">
                StateSnapshot.values at step {selected.step} · next = <span className="font-mono text-ink-2">{selected.next.join(", ") || "()"}</span>
              </div>
              <StateDiffView state={selected.values} hideKeys={["transcript", "cleaned_transcript"]} />
              {selected.next.length > 0 && (
                <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
                  <Field label="Fork: set intent to" className="w-44">
                    <Select value={forkIntent} onChange={setForkIntent} options={INTENTS.map((i) => ({ value: i, label: i }))} />
                  </Field>
                  <Button onClick={fork} icon={<GitFork className="h-4 w-4" />}>
                    update_state + resume from here
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {r.trace && r.trace.finalState.final_output ? (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-ink-3">Latest final_output on this thread</div>
          <JsonBlock value={r.trace.finalState.final_output} />
        </div>
      ) : null}
    </Card>
  );
}

export function Persistence() {
  return (
    <LessonShell id="a3-persistence">
      <p>
        Compile a graph with a <Term>Checkpointer</Term> and the runtime saves a <Term>Checkpoint</Term> after every super-step, grouped by a <Term>Thread</Term> id. That one feature
        powers pausing for humans, resuming after crashes, multi-turn memory, auditing and <Term>Time travel</Term>.
      </p>
      <h2>Explore a thread&apos;s history</h2>
      <p>
        Run <strong>t14</strong> (the agent pitched a personal loan, the customer wants a home loan). Select the checkpoint where <code>next = extract_product</code>, change the intent,
        and fork. The graph continues from that save point — the classifier is <em>not</em> called again.
      </p>
      <CheckpointExplorer />
      <WhyCard
        what={<>A persistence backend storing state snapshots per super-step, per thread (InMemorySaver, SqliteSaver, PostgresSaver…).</>}
        why={<>LLM workflows are long, expensive and sometimes need people. You must be able to stop, inspect, fix and continue — without re-running (and re-paying for) earlier steps.</>}
        when={<>Human-in-the-loop, conversation memory, long batch jobs, debugging with replay, audit trails.</>}
        whenNot={<>Stateless one-shot classification behind an API where nothing ever pauses — extra writes add latency and storage. (In-memory savers are for demos only.)</>}
        how={<>Pass <code>{`{"configurable": {"thread_id": ...}}`}</code> on every call. Read with <code>get_state</code> / <code>get_state_history</code>; edit with <code>update_state</code>; continue with <code>invoke(None, config)</code>.</>}
        real={<>Each call transcript gets its own thread id (e.g. the call id). A reviewer's correction 3 hours later resumes exactly that thread.</>}
      />
      <CodeBlock
        verified
        tabs={[
          {
            label: "checkpointer + thread",
            code: `from langgraph.checkpoint.memory import InMemorySaver
# production: PostgresSaver / AsyncPostgresSaver (langgraph-checkpoint-postgres), SqliteSaver

graph = builder.compile(checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "call-2931"}}

graph.invoke({"transcript": transcript}, config)

snapshot = graph.get_state(config)
snapshot.values      # the current state
snapshot.next        # nodes that would run next (empty tuple = finished)`,
          },
          {
            label: "history & time travel",
            code: `history = list(graph.get_state_history(config))    # newest first
target = next(s for s in history if s.next == ("extract_product",))

# fork: write a correction at that checkpoint, then continue from it
fork_config = graph.update_state(target.config, {"intent": "interested"})
result = graph.invoke(None, fork_config)             # earlier steps are NOT re-run`,
          },
        ]}
      />
      <Callout kind="warn" title="Persistence ≠ memory of everything">
        Checkpoints store <strong>state</strong> — so whatever you put in state is persisted (and may be retained). Keep PII out, or redact it before it enters state. For memory that spans
        threads (e.g. what a customer said last month), LangGraph has a separate long-term <code>Store</code>.
      </Callout>
    </LessonShell>
  );
}

// ================================================================ Human-in-the-loop
export function HumanInTheLoop() {
  const spec = useMemo(() => getTemplate("hitl"), []);
  return (
    <LessonShell id="a3-hitl">
      <p>
        <Term>Human-in-the-loop</Term> means a person reviews, approves or corrects a decision <em>inside</em> the workflow. In LangGraph, a node calls <Term>Interrupt</Term>: the run saves a
        checkpoint and stops, returning the question to your application. Later — seconds or days — you call the graph again with <code>Command(resume=answer)</code> on the same thread.
      </p>
      <h2>Be the reviewer</h2>
      <p>
        Run <strong>t03</strong> (a callback request — the model gets it wrong with low confidence). The graph pauses at Human review. Correct the intent and resume. Then check the State
        tab: <code>review_status</code> and the corrected <code>intent</code> are part of the final output.
      </p>
      <WorkflowRunner spec={spec} defaultTranscript="t03" panels={["state", "inspect", "trace", "python"]} counter="hitl_runs" />
      <WhyCard
        what={<>A pause point implemented with <code>interrupt(payload)</code>; resumed with <code>Command(resume=value)</code>, where value becomes interrupt()&apos;s return value.</>}
        why={<>Some decisions are too risky or too uncertain for a model alone — and human corrections are the best training/evaluation data you'll ever get.</>}
        when={<>Low confidence, high-value leads, compliance-sensitive actions (sending messages, changing records), approving tool calls.</>}
        whenNot={<>As a band-aid for a bad model on every call — humans are slow and expensive. Measure the review rate; aim to shrink it.</>}
        how={<>Requires a checkpointer + thread_id. On resume the interrupted node <strong>re-runs from its first line</strong>, so code before interrupt() must be idempotent.</>}
        real={<>Calls with confidence &lt; 0.7 go to a review queue UI. Corrections resume the graph and are saved to the “Human feedback” dataset for regression tests.</>}
      />
      <CodeBlock
        verified
        tabs={[
          {
            label: "interrupt + resume",
            code: `from langgraph.types import interrupt, Command
from langgraph.checkpoint.memory import InMemorySaver


def human_review(state: State) -> dict:
    decision = interrupt({                      # pauses here; payload goes to your UI
        "question": "Is this intent correct?",
        "intent": state["intent"],
        "confidence": state["confidence"],
    })
    if decision["action"] == "correct":
        return {"intent": decision["intent"], "review_status": "corrected"}
    return {"review_status": "approved"}


graph = builder.compile(checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "call-042"}}

result = graph.invoke({"transcript": transcript}, config)
if "__interrupt__" in result:
    payload = result["__interrupt__"][0].value     # show this to the reviewer
    # … later, maybe in another process, SAME thread_id:
    result = graph.invoke(Command(resume={"action": "correct", "intent": "unclear"}), config)`,
          },
          {
            label: "agents: approve tool calls",
            code: `from langchain.agents import create_agent
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

agent = create_agent(
    model="openai:gpt-5.4-mini",
    tools=[send_followup_message, update_crm],
    middleware=[HumanInTheLoopMiddleware(
        interrupt_on={"send_followup_message": True,              # approve / edit / reject
                      "update_crm": {"allowed_decisions": ["approve", "reject"]}},
    )],
    checkpointer=InMemorySaver(),
)
# resume with one decision per paused tool call:
agent.invoke(Command(resume={"decisions": [{"type": "approve"}]}), config=config)`,
          },
        ]}
      />
      <Callout kind="danger" title="The #1 interrupt bug">
        Anything before <code>interrupt()</code> runs again on resume. If you send a Slack notification and then interrupt, the reviewer gets it twice. Put side effects after the
        interrupt, in a separate node, or make them idempotent. <em>Static</em> breakpoints (<code>interrupt_before=[…]</code>) exist too, but the docs recommend them for debugging, not
        for human-in-the-loop.
      </Callout>
      <Exercise id="ex-code-hitl" />
    </LessonShell>
  );
}

// ================================================================ Agents
interface AgentStep {
  kind: "think" | "tool" | "observe" | "final" | "error";
  text: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

function simulateAgent(maxIter: number, rateFails: boolean): { steps: AgentStep[]; completed: boolean } {
  const steps: AgentStep[] = [];
  let context = 620; // system + tools + transcript
  const plan: { tool: string; args: string; result: string; fail?: boolean }[] = [
    { tool: "crm_lookup", args: '{"customer_phone": "[PHONE]"}', result: '{"segment": "salaried", "existing_products": ["savings_account"], "income": "12 LPA"}' },
    { tool: "rate_lookup", args: '{"product": "home_loan"}', result: rateFails ? "ERROR 503: rates service unavailable" : '{"rate": "8.4% – 9.6%", "processing_fee": "0.5%"}', fail: rateFails },
    ...(rateFails ? [{ tool: "rate_lookup", args: '{"product": "home_loan"}', result: '{"rate": "8.4% – 9.6%", "processing_fee": "0.5%"}' }] : []),
    { tool: "check_eligibility", args: '{"income_lpa": 12, "loan_amount_lakh": 60}', result: '{"eligible": true, "max_amount_lakh": 72}' },
  ];
  let iter = 0;
  for (const p of plan) {
    if (iter >= maxIter) return { steps, completed: false };
    iter++;
    steps.push({ kind: "think", text: `LLM decides to call ${p.tool}`, inputTokens: context, outputTokens: 45, ms: 700 + context * 0.2 });
    steps.push({ kind: "tool", text: `${p.tool}(${p.args})`, inputTokens: 0, outputTokens: 0, ms: 150 });
    steps.push({ kind: p.fail ? "error" : "observe", text: p.result, inputTokens: 0, outputTokens: 0, ms: 0 });
    context += 45 + Math.ceil(p.result.length / 4) + 20;
  }
  if (iter >= maxIter) return { steps, completed: false };
  steps.push({
    kind: "final",
    text: "Draft: “Hi Rohan, thanks for your interest in a home loan for your Pune flat. You're pre-eligible for up to ₹72 lakh at 8.4–9.6%. I've emailed the document checklist…”",
    inputTokens: context,
    outputTokens: 140,
    ms: 700 + context * 0.2 + 140 * 12,
  });
  return { steps, completed: true };
}

function AgentLoop() {
  const [maxIter, setMaxIter] = useState(6);
  const [fail, setFail] = useState(false);
  const { steps, completed } = useMemo(() => simulateAgent(maxIter, fail), [maxIter, fail]);
  const inTok = steps.reduce((a, s) => a + s.inputTokens, 0);
  const outTok = steps.reduce((a, s) => a + s.outputTokens, 0);
  const ms = steps.reduce((a, s) => a + s.ms, 0);
  const llmCalls = steps.filter((s) => s.kind === "think" || s.kind === "final").length;
  const price = (inTok * 0.4 + outTok * 1.6) / 1e6;
  const wfIn = 620 * 1 + 380;
  const wfPrice = (wfIn * 0.4 + 185 * 1.6) / 1e6;
  return (
    <Card className="my-6 p-4">
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <Slider label="Max iterations (tool calls allowed)" value={maxIter} onChange={setMaxIter} min={1} max={8} step={1} format={(v) => String(v)} />
        <Toggle checked={fail} onChange={setFail} label={<span className="text-sm">Rates service fails once (503)</span>} />
      </div>
      <div className="text-xs text-ink-3">Task: “Prepare a follow-up for this caller” (t04, keen home buyer). Tools: crm_lookup, rate_lookup, check_eligibility.</div>
      <ol className="mt-3 flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <li
            key={i}
            className={cn(
              "fade-in flex gap-2 rounded-lg border px-3 py-1.5 text-xs",
              s.kind === "think" && "border-line bg-surface",
              s.kind === "tool" && "border-line bg-surface-2 font-mono",
              s.kind === "observe" && "border-line bg-surface-2 font-mono text-ink-2",
              s.kind === "error" && "border-bad/40 bg-bad-soft font-mono",
              s.kind === "final" && "border-good/40 bg-good-soft",
            )}
          >
            <Badge tone={s.kind === "think" || s.kind === "final" ? "llm" : s.kind === "error" ? "bad" : "tool"}>{s.kind === "think" ? "LLM" : s.kind === "final" ? "LLM → answer" : s.kind === "tool" ? "tool call" : s.kind === "error" ? "tool error" : "result"}</Badge>
            <span className="min-w-0 flex-1 break-words">{s.text}</span>
            {s.inputTokens > 0 && <span className="shrink-0 text-ink-3">{s.inputTokens} in-tok</span>}
          </li>
        ))}
      </ol>
      {!completed && <Callout kind="warn" className="mt-3" title="Iteration limit reached">The agent stopped before answering. Bounding agents is essential — but it means some tasks end incomplete.</Callout>}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="LLM calls" value={llmCalls} />
        <Stat label="Input tokens" value={inTok.toLocaleString()} sub="context grows each turn" />
        <Stat label="Latency" value={fmtMs(ms)} />
        <Stat label="Cost (mid model)" value={fmtUsd(price, { precise: true })} sub={`fixed workflow ≈ ${fmtUsd(wfPrice, { precise: true })}`} />
      </div>
      <p className="mt-2 text-xs text-ink-3">
        A fixed workflow (lookup → rates → eligibility → one drafting call) does the same job with one LLM call — because here, the steps were predictable. Agents earn their cost when
        they aren&apos;t.
      </p>
    </Card>
  );
}

export function Agents() {
  return (
    <LessonShell id="a3-agents">
      <p>
        With <Term>Tool calling</Term>, the model can ask your code to run a function and read the result. Put that in a loop — “call the model; if it requested a tool, run it and call the
        model again; stop when it answers” — and you have an <Term>Agent</Term>. It&apos;s the most flexible pattern, and the hardest to test, bound and budget.
      </p>
      <AgentLoop />
      <WhyCard
        what={<>A loop where the model chooses the next action (tool + arguments) until it decides it's done. In LangChain 1.x: <code>create_agent(model, tools, …)</code>, built on LangGraph.</>}
        why={<>Some tasks can't be flowcharted ahead of time: which lookups are needed depends on what the customer said and what the tools return.</>}
        when={<>Open-ended assistance (agent-assist copilots, research, multi-system troubleshooting) where value justifies extra cost and variability.</>}
        whenNot={<>Classification and extraction with known steps — i.e. most of transcript analysis. Use a workflow; maybe give ONE node a small agent for a genuinely open sub-task.</>}
        how={<>Each iteration re-sends the growing message history (tokens ↑), so bound iterations, validate tool arguments, make tools idempotent, and require approval for side effects.</>}
        real={<>An agent-assist panel that, during a live call, decides whether to fetch CRM history, current rates or eligibility — and drafts the agent's next sentence.</>}
      />
      <CodeBlock
        verified
        tabs={[
          {
            label: "create_agent",
            code: `from langchain.agents import create_agent
from langchain.tools import tool


@tool
def rate_lookup(product: str) -> str:
    """Return current interest-rate range and fees for a bank product."""
    return rates_api.get(product)          # your real system


@tool
def crm_lookup(customer_id: str) -> str:
    """Return the customer's segment, income band and existing products."""
    return crm.get_profile(customer_id)


agent = create_agent(
    model="openai:gpt-5.4-mini",           # or "anthropic:claude-sonnet-5"
    tools=[rate_lookup, crm_lookup],
    system_prompt="You help bank agents prepare follow-ups. Use tools; never invent rates.",
)
result = agent.invoke({"messages": [{"role": "user", "content": f"Prepare a follow-up:\\n{transcript}"}]})
print(result["messages"][-1].content)`,
          },
          {
            label: "structured final answer",
            code: `from pydantic import BaseModel

class FollowUp(BaseModel):
    channel: str
    message: str
    facts_used: list[str]      # makes groundedness checks possible

agent = create_agent(model="openai:gpt-5.4-mini", tools=[rate_lookup, crm_lookup],
                     response_format=FollowUp)
out = agent.invoke({"messages": [...]})
out["structured_response"]     # a validated FollowUp`,
          },
        ]}
      />
      <Callout kind="info" title="Version note">
        In LangChain 1.x, <code>langchain.agents.create_agent</code> is the standard agent constructor (it supersedes <code>langgraph.prebuilt.create_react_agent</code> for new code). It
        runs on the LangGraph runtime, so checkpointers, streaming and interrupts work the same way.
      </Callout>
      <QuickCheck
        q={{
          id: "a3ag",
          scenario: "You need intent, product and next_action for 20,000 calls a day, with the same fields every time.",
          question: "Agent or workflow?",
          options: [
            { text: "Agent — it can adapt to each call", why: "The steps don't change per call; adaptivity buys nothing but cost and variance." },
            { text: "Workflow — the steps are known; use structured outputs and routing", correct: true, why: "Predictable, cheaper, easier to evaluate and monitor." },
            { text: "Both — run the agent and the workflow and pick the better", why: "Doubles cost without a principled way to choose." },
          ],
          takeaway: "Default to workflows; use agents where the path is genuinely unknown.",
        }}
      />
      <TryIt title="See a tool-using workflow" href="/lab/playground?template=agentic" cta="Open in Playground">
        The analysis decides which tools run (CRM → rates → follow-up) — the predictable cousin of an agent.
      </TryIt>
    </LessonShell>
  );
}

export type { NodeSpan };
