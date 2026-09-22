"use client";

import { useMemo, useState } from "react";
import { FlowDiagram } from "@/components/graph/FlowDiagram";
import { WorkflowRunner } from "@/components/graph/WorkflowRunner";
import { CodeBlock, LessonShell, QuickCheck, Steps, Term, TryIt, WhyCard } from "@/components/learn/Learn";
import { Badge, Callout, Card, Slider, Toggle } from "@/components/ui";
import type { WfEdge, WfNode, WorkflowSpec } from "@/lib/workflows/spec";
import { edge, endNode, fnNode, humanNode, llmNode, routerNode, startNode } from "@/lib/workflows/templates";

// ================================================================ A2.1
type Req = "retry" | "parallel" | "routing" | "review" | "audit" | "resume";
const REQS: { id: Req; label: string; lg: string }[] = [
  { id: "parallel", label: "Run intent, product & sentiment in parallel", lg: "Fan-out edges; the runtime runs them in one super-step" },
  { id: "retry", label: "Retry when the JSON is invalid (max 2)", lg: "A cycle + a router + an attempts counter with a reducer" },
  { id: "routing", label: "Low confidence → review queue", lg: "add_conditional_edges with a routing function" },
  { id: "review", label: "Pause for a human, resume hours later", lg: "interrupt() + Command(resume=...) + a checkpointer" },
  { id: "audit", label: "Audit trail of every step", lg: "Checkpoints per super-step + tracing (e.g. LangSmith)" },
  { id: "resume", label: "Resume after a crash mid-pipeline", lg: "Durable checkpointer (Postgres); re-invoke with the same thread_id" },
];

function plainCode(on: Set<Req>) {
  const L: string[] = ["def analyze(transcript_id, transcript):"];
  if (on.has("resume")) L.push("    state = db.load_progress(transcript_id) or {}          # resume support");
  if (on.has("parallel")) {
    L.push(
      "    with ThreadPoolExecutor() as pool:",
      "        futures = {k: pool.submit(call_llm, PROMPTS[k], transcript)",
      "                   for k in ('intent', 'product', 'sentiment')}",
      "        raw = {k: f.result() for k, f in futures.items()}",
    );
  } else L.push("    raw = {'intent': call_llm(PROMPTS['intent'], transcript)}");
  if (on.has("retry")) {
    L.push(
      "    for key, text in raw.items():",
      "        for attempt in range(3):",
      "            try:",
      "                raw[key] = validate(key, json.loads(text)); break",
      "            except (ValueError, ValidationError) as err:",
      "                if attempt == 2: raw[key] = None; break",
      "                text = call_llm(PROMPTS[key] + f'\\nFix: {err}', transcript)",
    );
  } else L.push("    raw = {k: json.loads(v) for k, v in raw.items()}");
  if (on.has("audit")) L.push("    log_step(transcript_id, 'analysis', inputs=transcript, outputs=raw)   # every step…");
  if (on.has("resume")) L.push("    state.update(raw); db.save_progress(transcript_id, state)");
  L.push("    confidence = min(v['confidence'] for v in raw.values() if v)");
  if (on.has("routing") || on.has("review")) {
    L.push("    if confidence < 0.7:");
    if (on.has("review")) {
      L.push(
        "        db.save_pending(transcript_id, transcript=transcript, raw=raw)   # save EVERYTHING",
        "        notify_reviewer(transcript_id, raw)",
        "        return {'status': 'waiting_for_review'}",
        "",
        "# …a separate endpoint, hours later, maybe on another server:",
        "def on_review_submitted(transcript_id, decision):",
        "    saved = db.load_pending(transcript_id)",
        "    raw = apply_decision(saved['raw'], decision)",
        "    return finish(transcript_id, raw)            # re-implement 'the rest' of the flow",
      );
    } else L.push("        queue_for_review(transcript_id, raw); return {'status': 'queued'}");
  }
  L.push("    return finish(transcript_id, raw)");
  if (on.has("audit")) L.push("", "# + log_step(...) calls sprinkled through finish(), on_review_submitted(), …");
  return L.join("\n");
}

function graphSpec(on: Set<Req>): WorkflowSpec {
  const nodes: WfNode[] = [startNode(300, 0)];
  const edges: WfEdge[] = [];
  let y = 110;
  let lastIds: string[] = ["start"];
  const link = (to: string) => {
    lastIds.forEach((s) => edges.push(edge(s, to)));
    lastIds = [to];
  };
  if (on.has("parallel")) {
    nodes.push(llmNode("intent", "Classify intent", "classify_intent", 40, y, { onParseError: on.has("retry") ? "store" : "raise" }), llmNode("product", "Extract product", "extract_product", 300, y), llmNode("sentiment", "Sentiment", "sentiment", 560, y));
    lastIds.forEach((s) => ["intent", "product", "sentiment"].forEach((t) => edges.push(edge(s, t))));
    lastIds = ["intent", "product", "sentiment"];
  } else {
    nodes.push(llmNode("intent", "Classify intent", "classify_intent", 300, y, { onParseError: on.has("retry") ? "store" : "raise" }));
    link("intent");
  }
  y += 115;
  if (on.has("retry")) {
    nodes.push(fnNode("validate", "Validate", "validate_output", 300, y));
    link("validate");
    y += 110;
    nodes.push(routerNode("valid", "Valid?", { mode: "expression", field: "", expression: "state.is_valid ? 'ok' : (state.attempts >= 2 ? 'give_up' : 'retry')", branches: ["ok", "retry", "give_up"] }, 300, y));
    nodes.push(fnNode("count", "Count attempt", "increment_attempts", 600, y - 110));
    edges.push(edge("validate", "valid"), edge("valid", "count", "retry"), edge("count", "intent"));
    lastIds = [];
    y += 110;
  }
  nodes.push(fnNode("confidence", "Confidence", "compute_confidence", 300, y));
  if (on.has("retry")) edges.push(edge("valid", "confidence", "ok"), edge("valid", "confidence", "give_up"));
  else link("confidence");
  lastIds = ["confidence"];
  y += 110;
  if (on.has("routing") || on.has("review")) {
    nodes.push(routerNode("gate", "Low confidence?", { mode: "threshold", field: "confidence", op: "<", value: 0.7, branches: ["low", "high"] }, 300, y));
    edges.push(edge("confidence", "gate"));
    y += 110;
    if (on.has("review")) nodes.push(humanNode("review", "Human review", 40, y, ["intent"]));
    else nodes.push(fnNode("queue", "Queue for review", "custom", 40, y, "return { status: 'queued_for_review' };"));
    nodes.push(fnNode("finish", "Final output", "finalize", 300, y + 110));
    edges.push(edge("gate", on.has("review") ? "review" : "queue", "low"), edge("gate", "finish", "high"), edge(on.has("review") ? "review" : "queue", "finish"));
    lastIds = ["finish"];
    y += 220;
  } else {
    nodes.push(fnNode("finish", "Final output", "finalize", 300, y));
    link("finish");
    y += 110;
  }
  nodes.push(endNode(300, y));
  link("end");
  return { id: "growth", name: "Graph version", nodes, edges, checkpointer: on.has("review") || on.has("resume") || on.has("audit") };
}

function ComplexityGrowth() {
  const [on, setOn] = useState<Set<Req>>(new Set());
  const code = plainCode(on);
  const spec = graphSpec(on);
  const toggle = (r: Req) => {
    const n = new Set(on);
    if (n.has(r)) n.delete(r);
    else n.add(r);
    setOn(n);
  };
  return (
    <Card className="my-6 p-4">
      <div className="mb-3 text-sm font-semibold text-ink">Add production requirements one at a time:</div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        {REQS.map((r) => (
          <Toggle key={r.id} checked={on.has(r.id)} onChange={() => toggle(r.id)} label={<span className="text-sm">{r.label}</span>} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wide text-ink-3">Plain Python orchestration</span>
            <Badge tone={code.split("\n").length > 25 ? "bad" : "neutral"}>{code.split("\n").length} lines of control flow</Badge>
          </div>
          <CodeBlock tabs={[{ label: "pipeline.py", code }]} maxHeight={520} />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wide text-ink-3">Same logic as a graph</span>
            {spec.checkpointer && <Badge tone="accent">checkpointer</Badge>}
          </div>
          <FlowDiagram spec={spec} maxHeight={520} compact />
        </div>
      </div>
      {on.size > 0 && (
        <div className="mt-4 rounded-lg bg-surface-2 p-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">What LangGraph gives you for each requirement</div>
          <ul className="flex flex-col gap-1 text-sm">
            {REQS.filter((r) => on.has(r.id)).map((r) => (
              <li key={r.id} className="text-ink-2">
                <strong className="text-ink">{r.label}:</strong> {r.lg}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export default function WhyLangGraph() {
  return (
    <LessonShell id="a2-why-langgraph">
      <Steps items={["The problem", "Watch it grow", "What a graph gives you", "When not to use it"]} />
      <p>
        Classifying one transcript is a function call. The trouble starts with the requirements that <em>always</em> arrive afterwards: retries, parallel analyses, routing, a human
        reviewer who answers two hours later, an audit trail, surviving a crash. Each is easy alone. Together, in plain code, they turn into hand-written orchestration: saving
        progress, re-implementing “the rest of the flow” in a second endpoint, logging everywhere.
      </p>
      <ComplexityGrowth />
      <p>
        Notice what happens with <strong>“Pause for a human”</strong>: plain code has to split into two programs and manually save everything in between. That is exactly the problem{" "}
        <Term>LangGraph</Term> was built for: the workflow is a graph over shared <Term>State</Term>, the runtime saves a <Term>Checkpoint</Term> after every step, and{" "}
        <Term>Interrupt</Term> pauses and resumes the <em>same</em> run.
      </p>
      <WhyCard
        what={<>A low-level orchestration framework: you define state, nodes and edges; its runtime executes them with persistence, interrupts, streaming and retries built in.</>}
        why={<>Multi-step LLM systems need control flow (branches, loops), durable state, and human pauses. Writing that yourself is error-prone and invisible to tracing.</>}
        when={<>Branching or cyclic flows, long-running or resumable runs, human-in-the-loop, many steps whose intermediate state you must inspect.</>}
        whenNot={<>A single prompt or a fixed 2–3 step chain with no pauses. A plain function is simpler, faster to write, and easier for your team to read.</>}
        how={<>Build a <code>StateGraph(State)</code>, <code>add_node</code>, <code>add_edge</code> / <code>add_conditional_edges</code>, then <code>compile(checkpointer=...)</code> and <code>invoke</code>.</>}
        real={<>The Transcript Lab pipeline: redact → clean → 4 parallel analyses → confidence gate → human review (paused, resumable) → final JSON, with a checkpoint after each step.</>}
      />
      <h2>The same pipeline in LangGraph</h2>
      <CodeBlock
        verified
        tabs={[
          {
            label: "graph.py",
            code: `from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import InMemorySaver

builder = StateGraph(State)                      # State = what flows through the graph
builder.add_node("classify_intent", classify_intent)
builder.add_node("human_review", human_review)   # calls interrupt() inside
builder.add_node("finalize", finalize)

builder.add_edge(START, "classify_intent")
builder.add_conditional_edges("classify_intent", route_by_confidence,
                              ["human_review", "finalize"])
builder.add_edge("human_review", "finalize")
builder.add_edge("finalize", END)

graph = builder.compile(checkpointer=InMemorySaver())   # Postgres/SQLite in production
config = {"configurable": {"thread_id": "call-2931"}}
result = graph.invoke({"transcript": transcript}, config)`,
          },
        ]}
      />
      <Callout kind="info" title="Version note">
        This lab targets LangGraph 1.x (latest verified: 1.2.x). Since 1.0.6 the default <code>recursion_limit</code> is 1000 super-steps. Agent helpers moved to LangChain&apos;s{" "}
        <code>create_agent</code> — covered in the Tools &amp; agents lesson.
      </Callout>
      <QuickCheck
        q={{
          id: "a2l1",
          scenario: "Your team's classifier is one prompt + one parse, called from an API. There are no pauses, loops or branches.",
          question: "Someone proposes rewriting it in LangGraph “to be future-proof”. Your view?",
          options: [
            { text: "Yes — graphs are always better", why: "Abstractions cost reading time and debugging effort; add them when they solve a real problem." },
            { text: "Not yet — keep the function; migrate when routing, retries, persistence or human review appear", correct: true, why: "Choose the lowest-complexity tool that meets today's requirements; the migration is small when it's needed." },
            { text: "No — LangGraph can't handle single calls", why: "It can; it just isn't needed." },
          ],
          takeaway: "Framework adoption is an engineering trade-off, not a default.",
        }}
      />
    </LessonShell>
  );
}

// ================================================================ A2.2
function mentalModelSpec(threshold: number, review: boolean): WorkflowSpec {
  const nodes: WfNode[] = [
    startNode(300, 0),
    fnNode("analyze", "Analyze transcript", "clean_transcript", 300, 100),
    llmNode("classify_intent", "Classify intent", "classify_intent", 300, 200),
    routerNode("check_confidence", "Check confidence", { mode: "threshold", field: "confidence", op: "<", value: threshold, branches: ["low", "high"] }, 300, 310),
    fnNode("finalize", "Final output", "finalize", 480, 430),
    endNode(480, 540),
  ];
  const edges: WfEdge[] = [edge("start", "analyze"), edge("analyze", "classify_intent"), edge("classify_intent", "check_confidence"), edge("check_confidence", "finalize", "high"), edge("finalize", "end")];
  if (review) {
    nodes.push(humanNode("human_review", "Human review", 100, 430, ["intent"]));
    edges.push(edge("check_confidence", "human_review", "low"), edge("human_review", "finalize"));
  } else {
    edges.push(edge("check_confidence", "finalize", "low"));
  }
  return { id: `mm-${threshold}-${review}`, name: "Mental model", nodes, edges, checkpointer: true };
}

const CONCEPTS: [string, string, string][] = [
  ["State", "The shared dict every node reads and updates.", "{transcript, cleaned_transcript, intent, confidence, …}"],
  ["Node", "A function: state in → partial update out.", "Classify intent returns {intent, confidence}"],
  ["Edge", "“After A, run B.” Always fires.", "Analyze transcript → Classify intent"],
  ["Conditional edge", "A routing function picks the next node from the state.", "confidence < 0.7 ? Human review : Final output"],
  ["Super-step", "One tick: all triggered nodes run, then their updates are applied together.", "Step 0 runs Analyze; step 1 runs Classify…"],
  ["Checkpoint", "State saved after every super-step, per thread.", "Lets the graph pause at Human review and resume later"],
  ["Interrupt", "A node pauses the run and hands a question to a human.", "Human review → you approve or correct → resume"],
];

export function MentalModel() {
  const [threshold, setThreshold] = useState(0.8);
  const [review, setReview] = useState(true);
  const spec = useMemo(() => mentalModelSpec(threshold, review), [threshold, review]);
  return (
    <LessonShell id="a2-mental-model">
      <p>
        Forget code for a minute. A LangGraph workflow is a flowchart with a <strong>notebook</strong> travelling through it. The flowchart is the graph (nodes and edges). The notebook is
        the <Term>State</Term>: each box reads it, writes a few lines, and passes it on.
      </p>
      <div className="my-5 overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-3 py-2">Concept</th>
              <th className="px-3 py-2">Plain English</th>
              <th className="hidden px-3 py-2 md:table-cell">In our transcript graph</th>
            </tr>
          </thead>
          <tbody>
            {CONCEPTS.map(([c, d, e]) => (
              <tr key={c} className="border-t border-line bg-surface">
                <td className="px-3 py-2 font-semibold text-ink">
                  <Term t={c}>{c}</Term>
                </td>
                <td className="px-3 py-2 text-ink-2">{d}</td>
                <td className="hidden px-3 py-2 font-mono text-xs text-ink-2 md:table-cell">{e}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Run it, one super-step at a time</h2>
      <p>
        Turn on <strong>Step-by-step</strong>, press <strong>Run</strong>, then <strong>Next step</strong>. Watch three things: which node lights up, which edge is taken, and which
        state keys get <span className="text-good-ink">updated</span> (State tab). Then change the graph with the controls below and run again.
      </p>
      <Card className="my-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <Slider className="flex-1" label="Review threshold (route to human if confidence < …)" value={threshold} onChange={setThreshold} min={0.5} max={0.99} step={0.01} format={(v) => v.toFixed(2)} />
        <Toggle checked={review} onChange={setReview} label="Include human review node" />
      </Card>
      <WorkflowRunner spec={spec} defaultTranscript="t03" panels={["state", "inspect", "trace", "python"]} diagramHeight={600} counter="playground_runs" />
      <Callout kind="tip" title="Things to try">
        Run <strong>t03</strong> (a vague “call me later” — the model is unsure and gets it wrong) and <strong>t25</strong> (clear yes). Lower the threshold to 0.5: fewer calls reach review. Remove the human
        node: low-confidence calls now flow straight to the final output — cheaper, riskier. That trade-off is the heart of the routing lesson.
      </Callout>
      <TryIt title="Build it yourself" href="/lab/playground?template=hitl" cta="Open in Playground">
        The same graph, fully editable: add nodes, rewire edges, change prompts and export Python.
      </TryIt>
    </LessonShell>
  );
}
