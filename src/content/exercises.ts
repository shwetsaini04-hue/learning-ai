"use client";

import { transcriptToText } from "@/lib/domain";
import type { RunTrace } from "@/lib/engine/types";
import { END } from "@/lib/engine/types";
import { invokeLLM } from "@/lib/ai/client";
import { MemoryCheckpointer } from "@/lib/engine/checkpointer";
import { findTranscript } from "@/lib/sim/transcripts";
import { compileWorkflow } from "@/lib/workflows/compile";
import { lintWorkflow } from "@/lib/workflows/lint";
import { runWorkflow } from "@/lib/workflows/run";
import type { LLMNodeConfig, RouterConfig, WorkflowSpec } from "@/lib/workflows/spec";

export type ExerciseKind = "playground" | "code" | "numeric" | "interactive";

export interface NumericField {
  label: string;
  answer: number;
  tolerance: number;
  unit?: string;
}

export interface ExerciseDef {
  id: string;
  title: string;
  kind: ExerciseKind;
  difficulty: 1 | 2 | 3;
  lesson: string;
  problem: string;
  input?: string;
  expected: string;
  hints: string[];
  solution: string;
  solutionLanguage?: string;
  explanation: string;
  starterTemplate?: string;
  starterCode?: string;
  codeCheck?: { required: { pattern: string; message: string }[]; forbidden?: { pattern: string; message: string }[] };
  numeric?: NumericField[];
}

export interface CheckItem {
  label: string;
  ok: boolean;
  detail?: string;
}
export interface CheckResult {
  passed: boolean;
  checks: CheckItem[];
}

export const EXERCISES: ExerciseDef[] = [
  {
    id: "ex-first-chain",
    title: "Build your first chain",
    kind: "playground",
    difficulty: 1,
    lesson: "a1-patterns",
    problem:
      "Build the simplest useful LLM workflow: START → an LLM node that classifies the customer's intent → END. Use a prompt version that asks for JSON so the output can be parsed. Run it on transcript t01 (\"Rate before commitment\").",
    input: "Transcript t01 — the customer asks about interest rates but says \"please send me the full rate details\".",
    expected: "The run succeeds and the final state contains intent = \"interested\" with a confidence.",
    hints: [
      "Start from the Blank template and add an LLM node from the palette.",
      "Set the node's task to “Classify intent” and pick prompt V2 or V3 (V1 answers in prose).",
      "Connect START → your node → END by dragging from the bottom handle to the top handle.",
    ],
    solution: `START → classify_intent (task: classify_intent, prompt: V3, model: Swift-M) → END

builder = StateGraph(State)
builder.add_node("classify_intent", classify_intent)
builder.add_edge(START, "classify_intent")
builder.add_edge("classify_intent", END)
graph = builder.compile()`,
    explanation:
      "A chain is a fixed sequence of steps. One node, one model call, one parsed output. Many production features are exactly this — only add graph machinery when you need routing, loops, state across steps or human review.",
    starterTemplate: "blank",
  },
  {
    id: "ex-code-state",
    title: "Design the State with reducers",
    kind: "code",
    difficulty: 2,
    lesson: "a3-state",
    problem:
      "Write the State for a transcript pipeline. It needs: the transcript (string), intent and confidence (optional), an `attempts` counter that ACCUMULATES (+1 each retry), and a `notes` list that several parallel nodes can append to in the same super-step without an InvalidUpdateError.",
    expected: "A TypedDict State where attempts and notes use reducers via Annotated[..., operator.add].",
    hints: [
      "Reducers are attached with typing.Annotated: Annotated[<type>, <reducer function>].",
      "operator.add on ints sums them; on lists it concatenates them.",
      "Keys without a reducer are overwritten — and two writes in one step raise InvalidUpdateError.",
    ],
    starterCode: `import operator
from typing import Optional
from typing_extensions import TypedDict, Annotated


class State(TypedDict):
    transcript: str
    # TODO: intent, confidence, attempts (accumulates), notes (appendable)
`,
    solution: `import operator
from typing import Optional
from typing_extensions import TypedDict, Annotated


class State(TypedDict):
    transcript: str
    intent: Optional[str]
    confidence: Optional[float]
    attempts: Annotated[int, operator.add]      # node returns {"attempts": 1} -> +1
    notes: Annotated[list[str], operator.add]   # parallel nodes can both append
`,
    solutionLanguage: "python",
    explanation:
      "State keys are 'channels'. Without a reducer the last write wins, and LangGraph refuses two writes to the same key in one super-step. A reducer defines how updates combine, which makes counters and parallel fan-in safe.",
    codeCheck: {
      required: [
        { pattern: "class\\s+State\\s*\\(\\s*TypedDict", message: "Define State as a TypedDict subclass" },
        { pattern: "transcript\\s*:\\s*str", message: "State needs `transcript: str`" },
        { pattern: "attempts\\s*:\\s*Annotated\\[\\s*int\\s*,\\s*(operator\\.)?add\\s*\\]", message: "`attempts` should be Annotated[int, operator.add]" },
        { pattern: "notes\\s*:\\s*Annotated\\[\\s*list(\\[\\w+\\])?\\s*,\\s*(operator\\.)?add\\s*\\]", message: "`notes` should be Annotated[list[str], operator.add]" },
        { pattern: "intent\\s*:", message: "Include an `intent` key" },
        { pattern: "confidence\\s*:", message: "Include a `confidence` key" },
      ],
      forbidden: [{ pattern: "from\\s+langgraph\\.graph\\s+import\\s+Graph\\b", message: "Use StateGraph, not the legacy Graph class" }],
    },
  },
  {
    id: "ex-parallel",
    title: "Run the analyses in parallel",
    kind: "playground",
    difficulty: 2,
    lesson: "a3-parallel",
    problem:
      "The starter is a sequential pipeline: clean → intent → product → final. Intent, product and sentiment don't depend on each other. Restructure the graph so Classify intent, Extract product and Sentiment run in the SAME super-step after cleaning, then a Confidence check runs after all three, then the final output.",
    expected: "The trace shows the three LLM nodes in one step; the confidence check runs once afterwards; the run succeeds.",
    hints: [
      "Fan-out = several edges leaving the same node (clean → A, clean → B, clean → C).",
      "Fan-in = several edges into the same node (A → check, B → check, C → check). Equal-length branches finish in the same step, so the check runs once.",
      "Add a Sentiment LLM node and a “Confidence check” function node from the palette.",
    ],
    solution: `clean ─┬─> classify_intent ──┐
       ├─> extract_product ──┼─> confidence_check ─> finalize ─> END
       └─> sentiment ────────┘

builder.add_edge("clean", "classify_intent")
builder.add_edge("clean", "extract_product")
builder.add_edge("clean", "sentiment")
builder.add_edge("classify_intent", "confidence_check")
builder.add_edge("extract_product", "confidence_check")
builder.add_edge("sentiment", "confidence_check")`,
    explanation:
      "Nodes triggered in the same super-step run concurrently, so latency ≈ the slowest branch instead of the sum. Each branch writes different keys (confidence, product_confidence, sentiment_confidence), so no reducer is needed.",
    starterTemplate: "sequential",
  },
  {
    id: "ex-retry-loop",
    title: "Add a bounded validate → retry loop",
    kind: "playground",
    difficulty: 3,
    lesson: "a3-loops",
    problem:
      "The starter classifier uses the naive V1 prompt on a small model and set to store parse errors instead of crashing. Its output is often not valid JSON. Add Validate output → a router → (retry → Count attempt → back to the classifier) with an exit after 2 attempts, so the run always terminates.",
    expected: "A cycle that contains a router; the run on t10 (noisy call) finishes without GraphRecursionError.",
    hints: [
      "Use a router in expression mode, e.g. state.is_valid ? 'valid' : (state.attempts >= 2 ? 'give_up' : 'retry').",
      "Count attempt uses an `add` reducer: each visit adds 1.",
      "Connect: valid → Final output, give_up → Final output (or Human review), retry → Count attempt → Classify intent.",
    ],
    solution: `classify_intent → validate → router
router: "valid"   → finalize
        "retry"   → count_attempt → classify_intent   (loop)
        "give_up" → finalize

def route_after_validate(state: State) -> str:
    if state["is_valid"]:
        return "finalize"
    return "finalize" if state["attempts"] >= 2 else "count_attempt"`,
    explanation:
      "Loops are what make LangGraph more than a DAG runner — and every loop needs an exit you can prove. Here the attempt counter bounds retries; recursion_limit is only the safety net. Feeding the parse error back into the retry prompt makes the retry much likelier to succeed than re-sending the same prompt.",
    starterTemplate: "ex_retry_start",
  },
  {
    id: "ex-sentiment-review",
    title: "Sentiment → intent → confidence → human review",
    kind: "playground",
    difficulty: 2,
    lesson: "a4-ladder",
    problem:
      "Build: Transcript → Sentiment → Intent classification → Confidence check → Human review if confidence < 0.7, otherwise the final output. Human review must pause the graph (interrupt), so persistence must be on.",
    input: "Any transcript. Try t20 (\"Too expensive… maybe\") and t25 (\"Pre-approved, accepts\").",
    expected: "Low confidence (< 0.7) routes to Human review; confidence ≥ 0.7 goes straight to the final output.",
    hints: [
      "Router mode: threshold on field `confidence`, operator `<`, value 0.7, branches [low, high].",
      "The confidence check (min of confidences) must run after both LLM nodes.",
      "Turn on the checkpointer (persistence) — interrupt() requires it.",
    ],
    solution: `START → sentiment → classify_intent → confidence_check → router(confidence < 0.7)
      low  → human_review → finalize → END
      high → finalize → END

graph = builder.compile(checkpointer=InMemorySaver())`,
    explanation:
      "Confidence-based routing is how you spend expensive human attention only where the model is unsure. The threshold is a business decision: lower it and fewer calls get reviewed (cheaper, riskier); raise it and more get reviewed.",
    starterTemplate: "blank",
  },
  {
    id: "ex-intent-routing",
    title: "Route leads by intent",
    kind: "playground",
    difficulty: 2,
    lesson: "a4-ladder",
    problem:
      "After classifying intent: interested → CRM lookup → Send follow-up → Final output; not_interested → Final output; unclear → Human review → Final output.",
    expected: "A category router on `intent` with three connected branches, verified for each value.",
    hints: [
      "Router mode: category, field `intent`, branches interested / not_interested / unclear.",
      "Human review needs the checkpointer on.",
      "Tool nodes are in the palette (CRM lookup, Send follow-up).",
    ],
    solution: `def route_by_intent(state: State) -> str:
    return {
        "interested": "crm_lookup",
        "not_interested": "finalize",
        "unclear": "human_review",
    }[state["intent"]]

builder.add_conditional_edges("classify_intent", route_by_intent,
                              ["crm_lookup", "finalize", "human_review"])`,
    explanation:
      "A router is just a function of state. Keep routing logic deterministic and testable (as the checker just did by calling it with each intent) and keep the LLM's job narrow: produce the label.",
    starterTemplate: "simple_chain",
  },
  {
    id: "ex-code-hitl",
    title: "Write a human-review node",
    kind: "code",
    difficulty: 3,
    lesson: "a3-hitl",
    problem:
      "Write a `human_review` node that pauses with interrupt(), showing the predicted intent and confidence, and then applies the reviewer's decision. Compile the graph with a checkpointer and show how to resume with Command(resume=...) on the same thread.",
    expected: "interrupt() inside the node, a checkpointer at compile time, a thread_id in config, and Command(resume=...) to continue.",
    hints: [
      "from langgraph.types import interrupt, Command",
      "interrupt(payload) returns the resume value when the graph is resumed.",
      "graph.invoke(Command(resume={...}), config) — same config/thread_id as the first call.",
    ],
    starterCode: `from langgraph.graph import StateGraph, START, END
# TODO: imports


def human_review(state: State) -> dict:
    # TODO: pause and ask a human
    ...


# TODO: compile with a checkpointer, run, then resume
`,
    solution: `from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import interrupt, Command


def human_review(state: State) -> dict:
    decision = interrupt({
        "question": "Is this intent correct?",
        "intent": state["intent"],
        "confidence": state["confidence"],
    })
    # NOTE: everything above interrupt() re-runs on resume — keep it side-effect free
    if decision["action"] == "correct":
        return {"intent": decision["intent"], "review_status": "corrected"}
    return {"review_status": "approved"}


graph = builder.compile(checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "call-042"}}

result = graph.invoke({"transcript": transcript}, config)
if "__interrupt__" in result:
    print(result["__interrupt__"][0].value)          # what the reviewer sees
    result = graph.invoke(Command(resume={"action": "approve"}), config)
`,
    solutionLanguage: "python",
    explanation:
      "interrupt() saves a checkpoint and stops the run. Resuming re-executes the interrupted node from its start, and this time interrupt() returns the resume value. That is why a checkpointer and a stable thread_id are mandatory, and why code before interrupt() must be idempotent.",
    codeCheck: {
      required: [
        { pattern: "from\\s+langgraph\\.types\\s+import[^\\n]*\\binterrupt\\b", message: "Import interrupt from langgraph.types" },
        { pattern: "\\binterrupt\\s*\\(", message: "Call interrupt(...) inside the node" },
        { pattern: "Command\\s*\\(\\s*resume\\s*=", message: "Resume with Command(resume=...)" },
        { pattern: "compile\\s*\\([^)]*checkpointer\\s*=", message: "Compile with a checkpointer" },
        { pattern: "thread_id", message: "Pass a thread_id in the config" },
      ],
      forbidden: [
        { pattern: "interrupt_before\\s*=", message: "Static interrupt_before is meant for debugging; use interrupt() for human-in-the-loop" },
        { pattern: "NodeInterrupt", message: "NodeInterrupt is the older pattern; use interrupt() from langgraph.types" },
      ],
    },
  },
  {
    id: "ex-annotate",
    title: "Label calls and measure agreement",
    kind: "interactive",
    difficulty: 1,
    lesson: "b1-ground-truth",
    problem: "Label 8 transcripts yourself, then compare with the reference labels and compute Cohen's kappa.",
    expected: "All 8 labeled; you see your agreement and which cases were ambiguous.",
    hints: ["Read the labeling guidelines first — especially rule 2 (final position wins).", "Callbacks and 'I'll think about it' are 'unclear' under these guidelines."],
    solution: "See the reference labels revealed after you submit.",
    explanation: "Ground truth is created by people following guidelines. Where two careful people disagree, your model's 'errors' may really be guideline ambiguity.",
  },
  {
    id: "ex-prf-by-hand",
    title: "Precision, recall and F1 by hand",
    kind: "numeric",
    difficulty: 1,
    lesson: "b2-classification-metrics",
    problem:
      "For the class \"interested\" on 100 calls, the model produced: TP = 42 (said interested, was interested), FP = 8 (said interested, wasn't), FN = 6 (missed an interested customer). Compute precision, recall and F1 (as decimals, 3 places).",
    expected: "precision = TP/(TP+FP), recall = TP/(TP+FN), F1 = 2PR/(P+R)",
    hints: ["Precision: of everything flagged interested, how much was right? 42/(42+8).", "Recall: of all truly interested customers, how many did we catch? 42/(42+6).", "F1 is the harmonic mean of the two."],
    solution: "precision = 42/50 = 0.840\nrecall = 42/48 = 0.875\nF1 = 2·0.84·0.875 / (0.84+0.875) = 0.857",
    solutionLanguage: "text",
    explanation: "If sales calls every 'interested' lead, low precision wastes agent time; low recall loses customers. F1 balances both, but the business decides which one matters more.",
    numeric: [
      { label: "Precision", answer: 0.84, tolerance: 0.006 },
      { label: "Recall", answer: 0.875, tolerance: 0.006 },
      { label: "F1", answer: 0.857, tolerance: 0.006 },
    ],
  },
  {
    id: "ex-judge-calibration",
    title: "Calibrate an LLM judge",
    kind: "interactive",
    difficulty: 2,
    lesson: "b3-llm-judge",
    problem: "Tune the rubric so the simulated judge agrees with human scores (Pearson r ≥ 0.75 on 8 graded answers).",
    expected: "Agreement ≥ 0.75.",
    hints: ["Several answers contain claims not in the transcript — humans punished those.", "Humans required the answer to state the label explicitly."],
    solution: "Enable 'penalize unsupported claims' and 'require the label', with moderate strictness (≈0.3–0.5).",
    explanation: "A judge is a model too. You validate it exactly like any classifier: against human labels.",
  },
  {
    id: "ex-regression",
    title: "Find the regressions",
    kind: "interactive",
    difficulty: 2,
    lesson: "b3-regression",
    problem: "Run prompt V3 (baseline) and V4 (cheaper) on the benchmark, then count examples that V4 got wrong but V3 got right.",
    expected: "The exact number of regressed examples.",
    hints: ["Aggregate accuracy hides flips in both directions — compare example by example.", "Use the diff view: 'regressed' = baseline correct, candidate wrong."],
    solution: "Shown by the diff after both runs.",
    explanation: "A prompt change can raise average accuracy while breaking a specific important slice. Regression testing compares per example against a fixed baseline.",
  },
  {
    id: "ex-cost-estimate",
    title: "Estimate a monthly LLM bill",
    kind: "numeric",
    difficulty: 1,
    lesson: "b4-cost",
    problem:
      "Your pipeline makes 20,000 calls per day. Each call: 1,200 input tokens and 150 output tokens. The model costs $0.40 per 1M input tokens and $1.60 per 1M output tokens. What is the cost for a 30-day month (USD)?",
    expected: "Monthly cost = days × calls × (in_tokens × in_price + out_tokens × out_price) / 1M",
    hints: ["30 × 20,000 = 600,000 calls per month.", "Input: 600,000 × 1,200 = 720M tokens → × $0.40/M.", "Output: 600,000 × 150 = 90M tokens → × $1.60/M."],
    solution: "Input: 720M × $0.40 = $288\nOutput: 90M × $1.60 = $144\nTotal ≈ $432 / month",
    solutionLanguage: "text",
    explanation: "Input tokens dominate here because transcripts are long and outputs short. That's why prompt length (few-shot examples!) and prompt caching matter so much for transcript workloads.",
    numeric: [{ label: "Monthly cost", answer: 432, tolerance: 5, unit: "USD" }],
  },
  {
    id: "ex-latency-sla",
    title: "Sequential vs parallel latency",
    kind: "numeric",
    difficulty: 1,
    lesson: "b4-latency",
    problem:
      "A pipeline runs: clean (5 ms) → intent (800 ms) → product (700 ms) → sentiment (650 ms) → details (900 ms), all sequential. The four LLM steps are independent. What is the end-to-end latency (ms) if they run in parallel after cleaning?",
    expected: "Parallel branches cost the slowest branch, not the sum.",
    hints: ["Sequential total = 5 + 800 + 700 + 650 + 900.", "Parallel: 5 + max(800, 700, 650, 900)."],
    solution: "Sequential: 3,055 ms\nParallel: 5 + 900 = 905 ms",
    solutionLanguage: "text",
    explanation: "Parallelism cuts latency but not cost — you still pay for all four calls. And the parallel P95 is the P95 of a max(), which is worse than any single branch's P95.",
    numeric: [{ label: "Parallel latency", answer: 905, tolerance: 10, unit: "ms" }],
  },
];

EXERCISES.push({
  id: "ex-capstone-build",
  title: "Capstone: build the transcript analysis system",
  kind: "playground",
  difficulty: 3,
  lesson: "b4-production-loop",
  problem:
    "Build a production-style pipeline: PII redaction BEFORE any model call → intent classification and product extraction (separate nodes or one structured call) → a confidence check → human review below your threshold → a structured final output → END. Persistence must be on.",
  expected: "All requirement checks pass and the graph runs (or pauses for review) on three test calls.",
  hints: [
    "Start from the Blank template or load “Transcript analysis pipeline” and adapt it — but make sure you understand every node.",
    "Redaction must come before every LLM node: START → Redact PII → …",
    "Use a threshold router on `confidence` with branches low/high; low → Human review → Final output.",
  ],
  solution: `START → redact_pii → clean → [classify_intent ‖ extract_product ‖ sentiment] → confidence_check
      → router(confidence < 0.75): low → human_review → finalize → END
                                   high → finalize → END
compile(checkpointer=InMemorySaver())   # Postgres in production`,
  explanation:
    "Redaction first is a governance requirement; parallel analyses keep latency down; the confidence gate spends human attention where the model is unsure; persistence makes review resumable.",
  starterTemplate: "blank",
});

export function getExercise(id: string) {
  return EXERCISES.find((e) => e.id === id);
}



// ------------------------------------------------------------------ playground checkers

async function runOn(spec: WorkflowSpec, transcriptId: string): Promise<RunTrace> {
  const t = findTranscript(transcriptId)!;
  const cpr = new MemoryCheckpointer();
  return runWorkflow(spec, { transcript: transcriptToText(t), transcript_id: t.id }, { checkpointer: spec.checkpointer ? cpr : null, threadId: "check", recursionLimit: 25 });
}

/** Runs on the first transcript whose run isn't derailed by a (realistic) model format flake. */
async function runStable(spec: WorkflowSpec, ids: string[]): Promise<RunTrace> {
  let last: RunTrace | null = null;
  for (const id of ids) {
    last = await runOn(spec, id);
    if (last.error?.type !== "OutputParserException") return last;
  }
  return last!;
}

/** Evaluate the routing that leaves `nodeId` for a synthetic state (tests the router in isolation). */
function routeFrom(spec: WorkflowSpec, nodeId: string, state: Record<string, unknown>): string[] | string {
  const def = compileWorkflow(spec, { llm: invokeLLM });
  const ces = def.conditionalEdges.filter((c) => c.source === nodeId);
  if (!ces.length) return "no conditional edge";
  try {
    return ces.map((c) => {
      const r = c.route(state);
      return Array.isArray(r) ? r.join(",") : String(r);
    });
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}

function llmNodes(spec: WorkflowSpec, task?: string) {
  return spec.nodes.filter((n) => n.kind === "llm" && (!task || (n.config as LLMNodeConfig).task === task));
}

function predecessorsOf(spec: WorkflowSpec, id: string) {
  return spec.edges.filter((e) => e.target === id).map((e) => e.source);
}

export const CHECKERS: Record<string, (spec: WorkflowSpec) => Promise<CheckResult>> = {
  "ex-first-chain": async (spec) => {
    const checks: CheckItem[] = [];
    const cls = llmNodes(spec, "classify_intent");
    checks.push({ label: "Has an LLM node with task “Classify intent”", ok: cls.length > 0 });
    const pv = cls[0] ? (cls[0].config as LLMNodeConfig).promptVersion : "";
    checks.push({ label: "Prompt asks for JSON (V2/V3/V4)", ok: ["v2", "v3", "v4"].includes(pv), detail: pv ? `using ${pv.toUpperCase()}` : undefined });
    const trace = await runStable(spec, ["t01"]);
    checks.push({ label: "Run on t01 succeeds", ok: trace.status === "success", detail: trace.error ? `${trace.error.type}: ${trace.error.message}` : undefined });
    checks.push({ label: "Final state has intent = \"interested\"", ok: trace.finalState.intent === "interested", detail: `intent = ${JSON.stringify(trace.finalState.intent)}` });
    return { passed: checks.every((c) => c.ok), checks };
  },
  "ex-parallel": async (spec) => {
    const checks: CheckItem[] = [];
    const tasks = ["classify_intent", "extract_product", "sentiment"];
    const ids = tasks.map((t) => llmNodes(spec, t)[0]?.id);
    checks.push({ label: "Has intent, product and sentiment LLM nodes", ok: ids.every(Boolean) });
    const conf = spec.nodes.find((n) => n.kind === "function" && (n.config as { fn: string }).fn === "compute_confidence");
    checks.push({ label: "Has a Confidence check node", ok: !!conf });
    const trace = await runStable(spec, ["t04", "t13", "t01", "t19"]);
    checks.push({ label: "Run succeeds", ok: trace.status === "success", detail: trace.error ? `${trace.error.type}: ${trace.error.message}` : undefined });
    const steps = ids.map((id) => trace.spans.find((s) => s.node === id)?.step);
    const same = steps.every((s) => s !== undefined && s === steps[0]);
    checks.push({ label: "The three LLM nodes ran in the same super-step", ok: same, detail: `steps: ${steps.map((s) => (s === undefined ? "–" : s)).join(", ")}` });
    const confSpans = conf ? trace.spans.filter((s) => s.node === conf.id) : [];
    checks.push({
      label: "Confidence check ran once, after all three",
      ok: confSpans.length === 1 && steps.every((s) => s !== undefined && s < confSpans[0].step),
      detail: `ran ${confSpans.length}×`,
    });
    return { passed: checks.every((c) => c.ok), checks };
  },
  "ex-retry-loop": async (spec) => {
    const checks: CheckItem[] = [];
    const cls = llmNodes(spec, "classify_intent")[0];
    checks.push({ label: "Classifier stores parse errors (on_parse_error = store)", ok: !!cls && (cls.config as LLMNodeConfig).onParseError === "store" });
    const routers = spec.nodes.filter((n) => n.kind === "router");
    const loopRouter = routers.find((r) => {
      const cfg = r.config as RouterConfig;
      return cfg.mode === "expression" ? /attempts/.test(cfg.expression ?? "") : cfg.field === "attempts";
    });
    checks.push({ label: "A router checks the attempt counter (bounded loop)", ok: !!loopRouter });
    const hasCycleBack = !!cls && spec.edges.some((e) => e.target === cls.id && e.source !== "start");
    checks.push({ label: "An edge loops back to the classifier", ok: hasCycleBack });
    const trace = await runOn(spec, "t10");
    checks.push({ label: "Run on t10 terminates without GraphRecursionError", ok: trace.status === "success", detail: trace.error ? `${trace.error.type}` : `${trace.totals.steps} steps` });
    return { passed: checks.every((c) => c.ok), checks };
  },
  "ex-sentiment-review": async (spec) => {
    const checks: CheckItem[] = [];
    const sent = llmNodes(spec, "sentiment")[0];
    const cls = llmNodes(spec, "classify_intent")[0];
    checks.push({ label: "Has Sentiment and Classify intent nodes", ok: !!sent && !!cls });
    const human = spec.nodes.find((n) => n.kind === "human");
    checks.push({ label: "Has a Human review node", ok: !!human });
    checks.push({ label: "Persistence (checkpointer) is on", ok: !!spec.checkpointer });
    const router = spec.nodes.find((n) => n.kind === "router" && (n.config as RouterConfig).field === "confidence");
    checks.push({ label: "A router reads `confidence`", ok: !!router });
    if (router && human) {
      const preds = predecessorsOf(spec, router.id);
      const low = preds.length ? routeFrom(spec, preds[0], { confidence: 0.55, intent: "interested" }) : "no predecessor";
      const high = preds.length ? routeFrom(spec, preds[0], { confidence: 0.9, intent: "interested" }) : "no predecessor";
      const lowOk = Array.isArray(low) && low.includes(human.id);
      const highOk = Array.isArray(high) && !high.includes(human.id) && !high.some((x) => x.startsWith("error"));
      checks.push({ label: "confidence 0.55 → Human review", ok: lowOk, detail: `routes to ${JSON.stringify(low)}` });
      checks.push({ label: "confidence 0.90 → skips review", ok: highOk, detail: `routes to ${JSON.stringify(high)}` });
      const edge = routeFrom(spec, preds[0] ?? "", { confidence: 0.7, intent: "interested" });
      checks.push({ label: "Exactly 0.7 is NOT reviewed (threshold is < 0.7)", ok: Array.isArray(edge) && !edge.includes(human.id), detail: `routes to ${JSON.stringify(edge)}` });
    }
    if (sent && cls) {
      const trace = await runOn(spec, "t25");
      const sStep = trace.spans.find((s) => s.node === sent.id)?.step ?? -1;
      const cStep = trace.spans.find((s) => s.node === cls.id)?.step ?? -1;
      checks.push({
        label: "Sentiment and intent both run (sequentially or in parallel)",
        ok: sStep >= 0 && cStep >= sStep,
        detail: `sentiment step ${sStep}, intent step ${cStep}${cStep === sStep ? " (parallel — even better)" : ""}`,
      });
      checks.push({ label: "End-to-end run on t25 succeeds", ok: trace.status === "success" || trace.status === "interrupted", detail: trace.error ? trace.error.message : trace.status });
    }
    return { passed: checks.every((c) => c.ok), checks };
  },
  "ex-intent-routing": async (spec) => {
    const checks: CheckItem[] = [];
    const cls = llmNodes(spec).find((n) => ["classify_intent", "full_analysis"].includes((n.config as LLMNodeConfig).task));
    const router = spec.nodes.find((n) => n.kind === "router" && (n.config as RouterConfig).field === "intent");
    checks.push({ label: "A router reads `intent`", ok: !!router });
    const crm = spec.nodes.find((n) => n.kind === "tool" && (n.config as { tool: string }).tool === "crm_lookup");
    const follow = spec.nodes.find((n) => n.kind === "tool" && (n.config as { tool: string }).tool === "send_followup");
    const human = spec.nodes.find((n) => n.kind === "human");
    const fin = spec.nodes.find((n) => n.kind === "function" && (n.config as { fn: string }).fn === "finalize");
    checks.push({ label: "Has CRM lookup, Send follow-up, Human review and Final output nodes", ok: !!crm && !!follow && !!human && !!fin });
    if (router && cls) {
      const preds = predecessorsOf(spec, router.id);
      const src = preds[0] ?? cls.id;
      const r = (intent: string) => routeFrom(spec, src, { intent, confidence: 0.9 });
      const a = r("interested");
      const b = r("not_interested");
      const c = r("unclear");
      checks.push({ label: "interested → CRM lookup", ok: Array.isArray(a) && !!crm && a.includes(crm.id), detail: JSON.stringify(a) });
      checks.push({ label: "not_interested → Final output", ok: Array.isArray(b) && !!fin && b.includes(fin.id), detail: JSON.stringify(b) });
      checks.push({ label: "unclear → Human review", ok: Array.isArray(c) && !!human && c.includes(human.id), detail: JSON.stringify(c) });
    }
    if (crm && follow) {
      const path = spec.edges.some((e) => e.source === crm.id && e.target === follow.id);
      checks.push({ label: "CRM lookup → Send follow-up", ok: path });
    }
    checks.push({ label: "Persistence on (Human review needs it)", ok: !!spec.checkpointer });
    const trace = await runStable(spec, ["t13", "t04", "t25"]);
    checks.push({ label: "Run on a keen-customer call succeeds", ok: trace.status === "success", detail: trace.error ? trace.error.message : undefined });
    return { passed: checks.every((x) => x.ok), checks };
  },
};

export function staticCodeCheck(code: string, ex: ExerciseDef) {
  const results: CheckItem[] = [];
  for (const r of ex.codeCheck?.required ?? []) results.push({ label: r.message, ok: new RegExp(r.pattern, "m").test(code) });
  for (const f of ex.codeCheck?.forbidden ?? []) {
    const hit = new RegExp(f.pattern, "m").test(code);
    if (hit) results.push({ label: f.message, ok: false });
  }
  const deprecated: [RegExp, string][] = [
    [/from\s+langgraph\.prebuilt\s+import\s+create_react_agent/, "create_react_agent (langgraph.prebuilt) is superseded by langchain.agents.create_agent in LangChain 1.x"],
    [/LLMChain|\.run\(/, "LLMChain / .run() are legacy LangChain APIs — use runnables (.invoke) or LangGraph"],
    [/set_entry_point\s*\(/, "set_entry_point still works but add_edge(START, ...) is the current idiom"],
  ];
  for (const [re, msg] of deprecated) if (re.test(code)) results.push({ label: `Legacy API: ${msg}`, ok: false });
  return { passed: results.every((r) => r.ok), checks: results };
}

export { END };

/** Every LLM node must be reachable only through the redaction node. */
function redactionBeforeLLM(spec: WorkflowSpec) {
  const redact = spec.nodes.find((n) => n.kind === "function" && (n.config as { fn: string }).fn === "redact_pii");
  if (!redact) return { ok: false, detail: "no Redact PII node" };
  // BFS from START without passing through the redaction node: no LLM node may be reachable
  const start = spec.nodes.find((n) => n.kind === "start");
  const seen = new Set<string>();
  const stack = start ? [start.id] : [];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || id === redact.id) continue;
    seen.add(id);
    spec.edges.filter((e) => e.source === id).forEach((e) => stack.push(e.target));
  }
  const leaked = spec.nodes.filter((n) => n.kind === "llm" && seen.has(n.id));
  return leaked.length ? { ok: false, detail: `reachable without redaction: ${leaked.map((l) => l.label).join(", ")}` } : { ok: true, detail: "all LLM nodes are downstream of redaction" };
}

CHECKERS["ex-capstone-build"] = async (spec) => {
  const checks: CheckItem[] = [];
  const r = redactionBeforeLLM(spec);
  checks.push({ label: "PII is redacted before any LLM call", ok: r.ok, detail: r.detail });
  const tasks = llmNodes(spec).map((n) => (n.config as LLMNodeConfig).task);
  checks.push({ label: "Classifies intent", ok: tasks.includes("classify_intent") || tasks.includes("full_analysis") });
  checks.push({ label: "Extracts product", ok: tasks.includes("extract_product") || tasks.includes("full_analysis") });
  const router = spec.nodes.find((n) => n.kind === "router" && (n.config as RouterConfig).field === "confidence");
  const human = spec.nodes.find((n) => n.kind === "human");
  checks.push({ label: "Confidence gate (router on `confidence`)", ok: !!router });
  checks.push({ label: "Human review node", ok: !!human });
  if (router && human) {
    const pred = predecessorsOf(spec, router.id)[0];
    const low = pred ? routeFrom(spec, pred, { confidence: 0.4, intent: "unclear" }) : "none";
    checks.push({ label: "Low confidence (0.4) routes to Human review", ok: Array.isArray(low) && low.includes(human.id), detail: JSON.stringify(low) });
  }
  const fin = spec.nodes.find((n) => n.kind === "function" && (n.config as { fn: string }).fn === "finalize");
  checks.push({ label: "Structured final output node", ok: !!fin });
  checks.push({ label: "Persistence (checkpointer) on", ok: !!spec.checkpointer });
  const errs = lintWorkflow(spec).filter((i) => i.level === "error");
  checks.push({ label: "No graph errors (linter)", ok: errs.length === 0, detail: errs[0]?.message });
  for (const id of ["t01", "t20", "t28"]) {
    const tr = await runOn(spec, id);
    checks.push({ label: `Runs on ${id}`, ok: tr.status === "success" || tr.status === "interrupted", detail: tr.error ? `${tr.error.type}: ${tr.error.message.slice(0, 80)}` : tr.status });
  }
  return { passed: checks.every((c) => c.ok), checks };
};
