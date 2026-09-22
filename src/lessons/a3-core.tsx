"use client";

import { useMemo, useState } from "react";
import { WorkflowRunner } from "@/components/graph/WorkflowRunner";
import { StateDiffView } from "@/components/learn/JsonView";
import { CodeBlock, Exercise, LessonShell, QuickCheck, Steps, Term, TryIt, WhyCard } from "@/components/learn/Learn";
import { Button, Callout, Card, Field, Segmented, Select, Slider, Stat, Toggle } from "@/components/ui";
import { SIMULATED_MODELS } from "@/config/models";
import { applyWrites, GraphRuntimeError } from "@/lib/engine/graph";
import type { GraphState, Reducer, StateSchema } from "@/lib/engine/types";
import { getBenchmark } from "@/lib/sim/transcripts";
import { fmtPct } from "@/lib/utils";
import { getTemplate } from "@/lib/workflows/templates";
import { simClassify } from "./widgets/simData";

// ================================================================ State & reducers
function ReducerSim() {
  const [notesR, setNotesR] = useState<Reducer>("overwrite");
  const [attemptsR, setAttemptsR] = useState<Reducer>("overwrite");
  const initial: GraphState = { transcript: "Agent: … Customer: …", intent: null, notes: [], attempts: 0 };
  const [state, setState] = useState<GraphState>(initial);
  const [before, setBefore] = useState<GraphState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState(0);
  const schema: StateSchema = {
    transcript: { reducer: "overwrite" },
    intent: { reducer: "overwrite" },
    notes: { reducer: notesR, default: [] },
    attempts: { reducer: attemptsR, default: 0 },
  };
  const writes = [
    { node: "classify_intent", update: { intent: "interested", notes: ["intent classified"], attempts: 1 } },
    { node: "flag_pii", update: { notes: ["no PII found"], attempts: 1 } },
  ];
  const run = () => {
    try {
      const r = applyWrites(schema, state, writes);
      setBefore(state);
      setState(r.state);
      setError(null);
      setSteps(steps + 1);
    } catch (e) {
      setError(e instanceof GraphRuntimeError ? `${e.info.type}: ${e.info.message}` : String(e));
    }
  };
  const reset = () => {
    setState(initial);
    setBefore(null);
    setError(null);
    setSteps(0);
  };
  return (
    <Card className="my-6 p-4">
      <div className="mb-3 text-sm text-ink-2">
        Two nodes run <strong className="text-ink">in the same super-step</strong>. Both return an update. The engine (the same one that runs every workflow in this lab) merges them
        through each key&apos;s reducer.
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs leading-6">
            <div className="text-ink-3"># node A: classify_intent returns</div>
            <div className="text-ink">{`{"intent": "interested", "notes": ["intent classified"], "attempts": 1}`}</div>
            <div className="mt-1 text-ink-3"># node B: flag_pii returns</div>
            <div className="text-ink">{`{"notes": ["no PII found"], "attempts": 1}`}</div>
          </div>
          <Field label="Reducer for notes">
            <Segmented value={notesR} onChange={(v) => { setNotesR(v); reset(); }} options={[{ id: "overwrite", label: "none (overwrite)" }, { id: "append", label: "operator.add (append)" }]} size="sm" />
          </Field>
          <Field label="Reducer for attempts">
            <Segmented value={attemptsR} onChange={(v) => { setAttemptsR(v); reset(); }} options={[{ id: "overwrite", label: "none (overwrite)" }, { id: "add", label: "operator.add (sum)" }]} size="sm" />
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" onClick={run}>
              Run super-step {steps + 1}
            </Button>
            <Button variant="ghost" onClick={reset}>
              Reset
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">State after {steps} step(s)</div>
          <StateDiffView state={state} before={before} />
          {error && (
            <Callout kind="danger" title="The step failed">
              <code className="font-mono text-xs">{error}</code>
            </Callout>
          )}
          {!error && steps > 0 && notesR === "append" && attemptsR === "add" && <Callout kind="success">Both notes kept; attempts counts every write. This is how parallel fan-in and counters work.</Callout>}
        </div>
      </div>
    </Card>
  );
}

export default function StateLesson() {
  return (
    <LessonShell id="a3-state">
      <Steps items={["State = information moving through the graph", "Partial updates", "Reducers", "Experiment"]} />
      <p>
        Every node receives the current <Term>State</Term> and returns only what it changed. The runtime merges that partial update into the state. Here is the transcript pipeline&apos;s
        state evolving:
      </p>
      <div className="my-4 grid gap-3 md:grid-cols-3">
        <div>
          <div className="mb-1 text-xs font-semibold text-ink-3">Input</div>
          <StateDiffView state={{ transcript: "…", intent: null, product: null, confidence: null }} />
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-ink-3">After “Classify intent”</div>
          <StateDiffView state={{ transcript: "…", intent: "interested", product: null, confidence: null }} before={{ transcript: "…", intent: null, product: null, confidence: null }} />
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-ink-3">After “Extract product”</div>
          <StateDiffView
            state={{ transcript: "…", intent: "interested", product: "personal_loan", confidence: 0.92 }}
            before={{ transcript: "…", intent: "interested", product: null, confidence: null }}
          />
        </div>
      </div>
      <WhyCard
        what={<>A typed dict (TypedDict, dataclass or Pydantic model) that is the single source of truth for a run. Each key is a “channel” with a reducer.</>}
        why={<>Nodes stay independent — they only agree on the state contract. The runtime can checkpoint, inspect, replay and merge parallel updates.</>}
        when={<>Always — designing the state is designing your workflow. Put in it everything a later step (or a debugger) needs.</>}
        whenNot={<>Don't stuff huge blobs (audio, full documents per step) or secrets into state: it's checkpointed and often traced. Store references instead.</>}
        how={<>Default reducer = overwrite. <code>Annotated[list, operator.add]</code> appends; <code>Annotated[int, operator.add]</code> sums; <code>add_messages</code> merges chat messages by id.</>}
        real={<>transcript, cleaned_transcript, intent, product, sentiment, confidence, review_status, attempts (sum), notes (append) — plus final_output.</>}
      />
      <h2>Reducers, hands-on</h2>
      <p>
        Run the super-step with both reducers set to <em>overwrite</em>. Then switch them. This is the most common LangGraph error beginners hit — <Term>InvalidUpdateError</Term> — and
        exactly why reducers exist.
      </p>
      <ReducerSim />
      <h2>In code</h2>
      <CodeBlock
        verified
        tabs={[
          {
            label: "TypedDict + reducers",
            code: `import operator
from typing import Optional
from typing_extensions import TypedDict, Annotated


class State(TypedDict):
    transcript: str
    intent: Optional[str]                          # overwrite (default)
    confidence: Optional[float]
    attempts: Annotated[int, operator.add]         # {"attempts": 1} adds 1
    notes: Annotated[list[str], operator.add]      # parallel nodes can append


def classify_intent(state: State) -> dict:
    # read what you need …
    text = state["transcript"]
    # … return ONLY what you changed (a partial update)
    return {"intent": "interested", "confidence": 0.91, "notes": ["classified"]}`,
          },
          {
            label: "input / output schemas",
            code: `from typing_extensions import TypedDict

class InputState(TypedDict):          # what callers must provide
    transcript: str

class OutputState(TypedDict):         # what callers get back
    final_output: dict

class State(InputState, OutputState):  # everything internal
    intent: str | None
    confidence: float | None

builder = StateGraph(State, input_schema=InputState, output_schema=OutputState)`,
          },
          {
            label: "messages (chat)",
            code: `from langgraph.graph import MessagesState

# For chat-style agents: a 'messages' key with the add_messages reducer built in
class AgentState(MessagesState):
    customer_id: str | None`,
          },
        ]}
      />
      <Exercise id="ex-code-state" />
    </LessonShell>
  );
}

// ================================================================ Nodes & edges
export function NodesEdges() {
  const spec = useMemo(() => getTemplate("sequential"), []);
  return (
    <LessonShell id="a3-nodes-edges">
      <p>
        A <Term>Node</Term> is a Python function: <code>state → partial update</code>. An <Term>Edge</Term> says what runs next. <Term t="START / END">START and END</Term> mark
        where a run enters and leaves. You assemble them on a <Term>StateGraph</Term>, <code>compile()</code> it (which validates the structure), and <code>invoke()</code> it.
      </p>
      <WhyCard
        what={<>Nodes do work; edges define order. Several edges out of one node = parallel branches.</>}
        why={<>Small single-purpose nodes can be tested, traced, retried and swapped independently (e.g. a new prompt version for one node).</>}
        when={<>Any step with a clear input and output: redact, classify, extract, call a tool, format the result.</>}
        whenNot={<>Don't split a single LLM call into many nodes just for tidiness — every node boundary is a checkpoint and a trace span. Group trivially-coupled code.</>}
        how={<>Nodes return dicts; the runtime merges them into state. Edges fire after the source node completes (at the next super-step).</>}
        real={<>clean → classify_intent → extract_product → finalize, each a node with its own prompt version and metrics.</>}
      />
      <h2>Inspect every node</h2>
      <p>Run it and click each node. The inspector shows the chain of custody for every step: input state → prompt → raw model output → parsed output → update → new state.</p>
      <WorkflowRunner spec={spec} defaultTranscript="t06" panels={["inspect", "state", "python", "trace"]} />
      <h2>The code</h2>
      <CodeBlock
        verified
        tabs={[
          {
            label: "build & run",
            code: `from langgraph.graph import StateGraph, START, END

builder = StateGraph(State)
builder.add_node("clean", clean_transcript)
builder.add_node("classify_intent", classify_intent)
builder.add_node("extract_product", extract_product)
builder.add_node("finalize", finalize)

builder.add_edge(START, "clean")
builder.add_edge("clean", "classify_intent")
builder.add_edge("classify_intent", "extract_product")
builder.add_edge("extract_product", "finalize")
builder.add_edge("finalize", END)

graph = builder.compile()        # validates: entrypoint exists, edges point to real nodes

result = graph.invoke({"transcript": transcript})
print(result["final_output"])`,
          },
          {
            label: "stream progress",
            code: `# See each node's update as it happens (great for UIs and debugging)
for chunk in graph.stream({"transcript": transcript}, stream_mode="updates"):
    print(chunk)          # {"classify_intent": {"intent": "interested", "confidence": 0.9}}

# stream_mode="values" yields the full state after each step instead`,
          },
          {
            label: "runtime context",
            code: `from dataclasses import dataclass
from langgraph.runtime import Runtime

@dataclass
class Context:                     # per-run config that is NOT state (not checkpointed)
    model_name: str = "openai:gpt-5.4-mini"
    review_threshold: float = 0.7

def classify_intent(state: State, runtime: Runtime[Context]) -> dict:
    model = init_chat_model(runtime.context.model_name)
    ...

builder = StateGraph(State, context_schema=Context)
graph = builder.compile()
graph.invoke({"transcript": transcript}, context={"review_threshold": 0.8})`,
          },
          {
            label: "visualize",
            code: `print(graph.get_graph().draw_mermaid())          # Mermaid text
# graph.get_graph().draw_mermaid_png()            # PNG (in notebooks)`,
          },
        ]}
      />
      <QuickCheck
        q={{
          id: "a3ne",
          scenario: "A node returns {'intent': 'interested'} while the state also holds transcript, product and confidence.",
          question: "What happens to product and confidence?",
          options: [
            { text: "They are deleted", why: "Nodes return partial updates; untouched keys remain." },
            { text: "They stay as they were", correct: true, why: "Only keys present in the update are merged (through their reducers)." },
            { text: "They are reset to None", why: "Nothing resets unreturned keys." },
          ],
          takeaway: "Nodes return deltas, not the whole state.",
        }}
      />
    </LessonShell>
  );
}

// ================================================================ Routing
function ThresholdExplorer() {
  const [model, setModel] = useState("sim:swift-m");
  const [threshold, setThreshold] = useState(0.7);
  const [reviewCost, setReviewCost] = useState(0.8);
  const data = useMemo(() => simClassify(model, "v2", getBenchmark()), [model]);
  const valid = data.filter((d) => d.confidence !== null);
  const reviewed = valid.filter((d) => (d.confidence as number) < threshold);
  const auto = valid.filter((d) => (d.confidence as number) >= threshold);
  const errors = valid.filter((d) => !d.correct);
  const caught = reviewed.filter((d) => !d.correct).length;
  const slipped = auto.filter((d) => !d.correct).length;
  const W = 640;
  const H = 120;
  const x = (c: number) => 20 + ((c - 0.3) / 0.7) * (W - 40);
  return (
    <Card className="my-6 p-4">
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Field label="Model (simulated, prompt V2)">
          <Select value={model} onChange={setModel} options={SIMULATED_MODELS.map((m) => ({ value: m.id, label: m.label }))} />
        </Field>
        <Slider label="Review if confidence <" value={threshold} onChange={setThreshold} min={0.3} max={1} step={0.01} format={(v) => v.toFixed(2)} />
        <Slider label="Cost of one human review ($)" value={reviewCost} onChange={setReviewCost} min={0.1} max={3} step={0.1} format={(v) => `$${v.toFixed(2)}`} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="predictions by confidence">
        <rect x={20} y={10} width={Math.max(0, x(threshold) - 20)} height={H - 38} fill="var(--warn-soft)" />
        <text x={24} y={24} fontSize="10.5" fill="var(--warn-ink)">
          → human review
        </text>
        <text x={W - 24} y={24} fontSize="10.5" textAnchor="end" fill="var(--ink-3)">
          auto-approved →
        </text>
        {valid.map((d, i) => {
          const c = d.confidence as number;
          const row = (i * 7) % 6;
          return <circle key={d.id} cx={x(c) + ((i % 3) - 1) * 1.5} cy={34 + row * 11} r={4} fill={d.correct ? "var(--s1)" : "var(--s8)"} stroke="var(--surface)" strokeWidth={1.5} />;
        })}
        <line x1={x(threshold)} x2={x(threshold)} y1={6} y2={H - 26} stroke="var(--ink)" strokeWidth={1.5} />
        {[0.3, 0.5, 0.7, 0.9, 1].map((v) => (
          <text key={v} x={x(v)} y={H - 10} fontSize="10" textAnchor="middle" fill="var(--ink-3)">
            {v.toFixed(1)}
          </text>
        ))}
      </svg>
      <div className="mb-3 flex gap-3 text-[11px] text-ink-3">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--s1)" }} /> correct prediction
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--s8)" }} /> wrong prediction
        </span>
        <span>x = model confidence · 120 benchmark calls</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Review rate" value={fmtPct(reviewed.length / valid.length, 0)} sub={`${reviewed.length} of ${valid.length} calls`} />
        <Stat label="Errors caught" value={`${caught} / ${errors.length}`} sub="wrong & sent to review" tone="good" />
        <Stat label="Errors slipping through" value={slipped} sub="wrong & auto-approved" tone={slipped ? "bad" : "good"} />
        <Stat label="Review cost / 1K calls" value={`$${((reviewed.length / valid.length) * 1000 * reviewCost).toFixed(0)}`} />
      </div>
      <div className="mt-3 text-xs text-ink-3">
        Try Pico-S: it&apos;s over-confident, so wrong answers sit at high confidence and slip past any sensible threshold. Routing on confidence only works when confidence is{" "}
        <Term t="Calibration">calibrated</Term>.
      </div>
    </Card>
  );
}

export function Routing() {
  const spec = useMemo(() => getTemplate("routing"), []);
  return (
    <LessonShell id="a3-routing">
      <p>
        A <Term>Conditional edge</Term> is a function of the state that returns the name of the next node. That&apos;s all a “router” is. It lets you spend expensive steps —
        a bigger model, a tool call, a human — only where they&apos;re needed.
      </p>
      <WhyCard
        what={<>add_conditional_edges(source, routing_fn, [possible destinations]). The function reads state and returns a node name (or END).</>}
        why={<>Different inputs need different handling; routing keeps each path simple instead of one giant prompt that does everything.</>}
        when={<>Branch on the model's label (interested → extract details), on confidence (low → review), on validity (invalid → retry), on business rules (VIP → priority).</>}
        whenNot={<>Don't route on unreliable signals without validating them (e.g. an uncalibrated confidence), and don't let an LLM freely pick among 20 destinations when a rule would do.</>}
        how={<>Routing happens between super-steps. Keep routing functions pure and deterministic so you can unit-test them with fake states.</>}
        real={<>“confidence &lt; 0.7 → human review, else auto-approve” and “intent == interested → CRM lookup → follow-up”.</>}
      />
      <h2>The confidence-threshold trade-off</h2>
      <p>Before touching code, feel the decision a router encodes. Move the threshold and watch what you catch, what slips through, and what it costs in human time.</p>
      <ThresholdExplorer />
      <h2>Route by intent</h2>
      <WorkflowRunner spec={spec} defaultTranscript="t13" panels={["state", "trace", "inspect", "python"]} />
      <h2>Two ways to express routing</h2>
      <CodeBlock
        verified
        tabs={[
          {
            label: "add_conditional_edges",
            code: `from langgraph.graph import END

def route_by_confidence(state: State) -> str:
    # handle every case explicitly — including a failed parse
    if state.get("confidence") is None:
        return "human_review"
    return "human_review" if state["confidence"] < 0.7 else "finalize"

builder.add_conditional_edges(
    "classify_intent",               # source node
    route_by_confidence,             # routing function
    ["human_review", "finalize"],    # possible destinations (helps validation & drawing)
)`,
          },
          {
            label: "Command(goto=...)",
            code: `from typing import Literal
from langgraph.types import Command

# When a node's update and the routing decision are one and the same:
def classify_intent(state: State) -> Command[Literal["human_review", "finalize"]]:
    result = classifier.invoke(prompt_for(state["transcript"]))
    return Command(
        update={"intent": result.intent, "confidence": result.confidence},
        goto="human_review" if result.confidence < 0.7 else "finalize",
    )`,
          },
          {
            label: "unit-test the router",
            code: `def test_route_by_confidence():
    assert route_by_confidence({"confidence": 0.55}) == "human_review"
    assert route_by_confidence({"confidence": 0.90}) == "finalize"
    assert route_by_confidence({"confidence": 0.70}) == "finalize"      # boundary!
    assert route_by_confidence({"confidence": None}) == "human_review"  # failed parse`,
          },
        ]}
      />
      <QuickCheck
        q={{
          id: "a3rt",
          scenario: "Your router returns 'escalate' for complaints, but you forgot to add an 'escalate' node.",
          question: "When will you find out?",
          options: [
            { text: "At compile time, if you listed the possible destinations", correct: true, why: "Declaring destinations lets the graph validate them; otherwise you'll find out at runtime when a complaint arrives." },
            { text: "Never — the call is silently dropped", why: "Routing to an unknown node raises an error." },
            { text: "Only in production traffic, no matter what", why: "Declaring destinations and unit-testing routers catches it earlier." },
          ],
          takeaway: "Declare destinations and test routers with synthetic states.",
        }}
      />
      <TryIt title="Build a confidence gate" href="/lab/playground?exercise=ex-sentiment-review" cta="Start exercise">
        Sentiment → intent → confidence check → human review if &lt; 0.7. The playground checks your router with test states.
      </TryIt>
    </LessonShell>
  );
}

// ================================================================ Loops
function LoopMath() {
  const [pFail, setPFail] = useState(0.2);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [repair, setRepair] = useState(true);
  const [deterministic, setDeterministic] = useState(false);
  const pRetry = deterministic && !repair ? 1 : repair ? Math.min(pFail, 0.08) : pFail;
  let pAllFail = pFail;
  let expected = 1;
  let reach = pFail;
  for (let k = 1; k < maxAttempts; k++) {
    expected += reach;
    reach *= pRetry;
  }
  pAllFail = reach;
  return (
    <Card className="my-6 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="P(first attempt invalid)" value={pFail} onChange={setPFail} min={0.01} max={0.6} step={0.01} format={(v) => fmtPct(v, 0)} />
        <Slider label="Max attempts" value={maxAttempts} onChange={setMaxAttempts} min={1} max={6} step={1} format={(v) => String(v)} />
        <Toggle checked={repair} onChange={setRepair} label={<span className="text-sm">Retry prompt includes the parse error (“repair prompt”)</span>} />
        <Toggle checked={deterministic} onChange={setDeterministic} label={<span className="text-sm">Temperature 0 + identical retry input</span>} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Success rate" value={fmtPct(1 - pAllFail, 2)} tone={1 - pAllFail > 0.99 ? "good" : "warn"} />
        <Stat label="Expected LLM calls" value={expected.toFixed(2)} sub="per transcript" />
        <Stat label="Cost multiplier" value={`×${expected.toFixed(2)}`} />
      </div>
      <p className="mt-3 text-xs text-ink-3">
        {deterministic && !repair
          ? "Same input at temperature 0 → same bad output. Retrying changes nothing: success stays at the first-attempt rate while cost goes up."
          : "Each retry only pays off if the retry is likely to succeed. Feeding the error back usually makes it much likelier."}
      </p>
    </Card>
  );
}

export function Loops() {
  const spec = useMemo(() => getTemplate("loop"), []);
  return (
    <LessonShell id="a3-loops">
      <p>
        Unlike a pipeline, a graph can have <strong>cycles</strong>: an edge back to an earlier node. That&apos;s how you implement “validate, and if invalid, try again”. It&apos;s
        also how you build infinite loops — so every loop needs an exit you can prove.
      </p>
      <WhyCard
        what={<>An edge from a later node back to an earlier one, with a router deciding when to exit.</>}
        why={<>LLM output is probabilistic. Validate-and-retry and refine-until-good are the most practical reliability tools you have.</>}
        when={<>Invalid structured output, failed validation rules (e.g. product must be mentioned in transcript), evaluator-optimizer refinement.</>}
        whenNot={<>Transient API errors (use a node <code>retry_policy</code> instead) or deterministic failures (retrying the same input at temperature 0 won't change the answer).</>}
        how={<>Keep an <code>attempts</code> counter with an add reducer; route <code>valid → continue</code>, <code>attempts ≥ N → give up</code>, else <code>retry</code>. <Term>Recursion limit</Term> is the safety net.</>}
        real={<>Small model returns prose instead of JSON → the retry prompt includes the parse error → second attempt succeeds; after 2 failures the call goes to human review.</>}
      />
      <h2>Watch a retry happen</h2>
      <p>
        This loop uses the naive V1 prompt on the small model, so the first answer is usually prose. Run <strong>t10</strong> and open the State tab: you&apos;ll see{" "}
        <code>classify_intent_error</code> set, <code>attempts</code> increment, and the second attempt succeed because the retry prompt contains the error.
      </p>
      <WorkflowRunner spec={spec} defaultTranscript="t10" panels={["state", "inspect", "trace", "python"]} />
      <h2>Is retrying worth it?</h2>
      <LoopMath />
      <h2>In code</h2>
      <CodeBlock
        verified
        tabs={[
          {
            label: "validate → retry loop",
            code: `def route_after_validate(state: State) -> str:
    if state["is_valid"]:
        return "finalize"
    if state["attempts"] >= 2:
        return "human_review"         # bounded: give up gracefully
    return "count_attempt"           # loops back to classify_intent

builder.add_edge("classify_intent", "validate")
builder.add_conditional_edges("validate", route_after_validate,
                              ["finalize", "human_review", "count_attempt"])
builder.add_edge("count_attempt", "classify_intent")`,
          },
          {
            label: "RetryPolicy (transient errors)",
            code: `from langgraph.types import RetryPolicy

# Retries the NODE when it raises — for flaky APIs / rate limits.
builder.add_node(
    "classify_intent",
    classify_intent,
    retry_policy=RetryPolicy(max_attempts=3),
)
# Note: by default some exception types (e.g. ValueError) are NOT retried.
# Parse errors are often ValueError subclasses — pass retry_on=... if you want them retried.`,
          },
          {
            label: "recursion_limit",
            code: `from langgraph.errors import GraphRecursionError

try:
    graph.invoke({"transcript": t}, {"recursion_limit": 25})   # counted in super-steps
except GraphRecursionError:
    # default limit is 1000 since langgraph 1.0.6 — set a tighter one per workflow
    alert("workflow looped without converging")`,
          },
        ]}
      />
      <Callout kind="warn" title="Loops multiply cost">
        Every iteration is another LLM call (and more tokens if you append history). Track average LLM calls per transcript in your evaluations — the Debugging Lab has a loop that burns
        25 steps on an easy call.
      </Callout>
      <Exercise id="ex-retry-loop" />
    </LessonShell>
  );
}

