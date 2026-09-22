"use client";

import { transcriptToText } from "@/lib/domain";
import { invokeLLM } from "@/lib/ai/client";
import { MemoryCheckpointer } from "@/lib/engine/checkpointer";
import type { RunTrace } from "@/lib/engine/types";
import { findTranscript } from "@/lib/sim/transcripts";
import { compileWorkflow } from "@/lib/workflows/compile";
import { runWorkflow } from "@/lib/workflows/run";
import type { WorkflowSpec } from "@/lib/workflows/spec";
import { edge, endNode, fnNode, humanNode, llmNode, routerNode, startNode } from "@/lib/workflows/templates";
import type { CheckItem, CheckResult } from "./exercises";

export interface DebugChallenge {
  id: string;
  title: string;
  difficulty: 1 | 2 | 3;
  category: string;
  symptom: string;
  testTranscript: string;
  spec: WorkflowSpec;
  diagnosis: { question: string; options: { text: string; correct?: boolean; why: string }[] };
  fixHint: string;
  lesson: string;
  verify: (spec: WorkflowSpec) => Promise<CheckResult>;
}

async function run(spec: WorkflowSpec, id: string): Promise<RunTrace> {
  const t = findTranscript(id)!;
  return runWorkflow(spec, { transcript: transcriptToText(t), transcript_id: t.id }, { checkpointer: spec.checkpointer ? new MemoryCheckpointer() : null, threadId: "verify", recursionLimit: 25 });
}

function routeFromPred(spec: WorkflowSpec, routerId: string, state: Record<string, unknown>) {
  const pred = spec.edges.find((e) => e.target === routerId)?.source;
  if (!pred) return "no predecessor";
  const def = compileWorkflow(spec, { llm: invokeLLM });
  const ce = def.conditionalEdges.find((c) => c.source === pred);
  if (!ce) return "no conditional edge";
  try {
    const r = ce.route(state);
    return Array.isArray(r) ? r.join(",") : String(r);
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}

const ok = (checks: CheckItem[]): CheckResult => ({ passed: checks.every((c) => c.ok), checks });

export const DEBUG_CHALLENGES: DebugChallenge[] = [
  {
    id: "dbg-prose",
    title: "“Invalid structured output”",
    difficulty: 1,
    category: "Output format",
    symptom: "The pipeline crashes on almost every call with OutputParserException. It worked in the notebook demo — where someone just eyeballed the text.",
    testTranscript: "t01",
    spec: {
      id: "dbg-prose",
      name: "Broken: prose output",
      nodes: [startNode(), llmNode("classify_intent", "Classify intent", "classify_intent", 300, 120, { promptVersion: "v1" }), fnNode("finalize", "Final output", "finalize", 300, 240), endNode(300, 360)],
      edges: [edge("start", "classify_intent"), edge("classify_intent", "finalize"), edge("finalize", "end")],
    },
    diagnosis: {
      question: "Open the failing node's Raw output and Parse steps. What is the root cause?",
      options: [
        { text: "The model is too small to classify intent", why: "The model's answer is even correct — it's just not in a format code can parse." },
        { text: "The prompt never asks for JSON or defines the labels, so the model answers in prose", correct: true, why: "Right. V1 asks an open question. Structured output starts with the prompt (and ideally provider-enforced schemas)." },
        { text: "The JSON parser is broken", why: "The parser correctly refuses prose. Loosening it would just hide the problem." },
        { text: "Temperature is too high", why: "Temperature is 0 here; the output is deterministic — deterministically prose." },
      ],
    },
    fixHint: "Select the node and switch the prompt version to V2 or V3.",
    lesson: "Don't parse free text. Define the schema in the prompt (or use provider structured outputs / with_structured_output) and validate every response.",
    verify: async (spec) => {
      const checks: CheckItem[] = [];
      for (const id of ["t01", "t04", "t13"]) {
        const tr = await run(spec, id);
        checks.push({ label: `Run on ${id} succeeds`, ok: tr.status === "success", detail: tr.error ? `${tr.error.type}: ${tr.error.message.slice(0, 90)}` : `intent = ${tr.finalState.intent}` });
      }
      return ok(checks);
    },
  },
  {
    id: "dbg-reasoning-budget",
    title: "The empty response",
    difficulty: 2,
    category: "Token budget",
    symptom: "After switching to a 'smarter' reasoning model, many calls fail with an empty response. Nobody changed the prompt.",
    testTranscript: "t20",
    spec: {
      id: "dbg-reasoning-budget",
      name: "Broken: reasoning budget",
      nodes: [startNode(), llmNode("classify_intent", "Classify intent", "classify_intent", 300, 120, { model: "sim:sage-r", maxTokens: 256 }), fnNode("finalize", "Final output", "finalize", 300, 240), endNode(300, 360)],
      edges: [edge("start", "classify_intent"), edge("classify_intent", "finalize"), edge("finalize", "end")],
    },
    diagnosis: {
      question: "Look at the node metrics: output tokens, reasoning tokens, stop reason. What happened?",
      options: [
        { text: "The reasoning model refused to answer", why: "There's no refusal — stop reason is max_tokens." },
        { text: "Hidden reasoning tokens used up max_tokens before any visible JSON was produced", correct: true, why: "Yes. Reasoning/thinking tokens count against the output budget (and are billed as output)." },
        { text: "The transcript is too long for the context window", why: "Input is tiny compared to the context window." },
        { text: "The API key ran out of credits", why: "That would be a provider error, not an empty completion with stop reason max_tokens." },
      ],
    },
    fixHint: "Raise Max tokens to ~2048 so reasoning + answer fit (or use a non-reasoning model — does a 3-way classification need one?).",
    lesson: "Reasoning models spend hidden tokens before answering. Budget max_tokens for reasoning + answer, and ask whether a simple classification needs a reasoning model at all (latency and cost!).",
    verify: async (spec) => {
      const checks: CheckItem[] = [];
      for (const id of ["t20", "t05", "t27"]) {
        const tr = await run(spec, id);
        const trunc = tr.spans.some((s) => s.llmCalls.some((c) => c.stopReason === "max_tokens"));
        checks.push({ label: `Run on ${id} succeeds without truncation`, ok: tr.status === "success" && !trunc, detail: tr.error ? tr.error.message.slice(0, 90) : trunc ? "hit max_tokens" : "ok" });
      }
      return ok(checks);
    },
  },
  {
    id: "dbg-reducer",
    title: "InvalidUpdateError in the parallel step",
    difficulty: 2,
    category: "State & reducers",
    symptom: "Two quality flags were added as parallel nodes. Now every run fails in the same super-step with InvalidUpdateError.",
    testTranscript: "t28",
    spec: {
      id: "dbg-reducer",
      name: "Broken: parallel writes",
      nodes: [
        startNode(),
        fnNode("clean", "Clean transcript", "clean_transcript", 300, 110),
        llmNode("classify_intent", "Classify intent", "classify_intent", 60, 230),
        fnNode("flag_pii", "Flag PII", "custom", 300, 230, `const hasPii = /\\d{5}\\s?\\d{5}|[A-Z]{5}\\d{4}[A-Z]/.test(state.transcript);\nreturn { notes: hasPii ? "contains PII" : "no PII" };`),
        fnNode("flag_length", "Flag long call", "custom", 540, 230, `const turns = state.transcript.split("\\n").length;\nreturn { notes: "turns=" + turns };`),
        fnNode("finalize", "Final output", "finalize", 300, 360),
        endNode(300, 470),
      ],
      edges: [
        edge("start", "clean"),
        edge("clean", "classify_intent"),
        edge("clean", "flag_pii"),
        edge("clean", "flag_length"),
        edge("classify_intent", "finalize"),
        edge("flag_pii", "finalize"),
        edge("flag_length", "finalize"),
        edge("finalize", "end"),
      ],
    },
    diagnosis: {
      question: "The error says: At key 'notes': Can receive only one value per step. Why?",
      options: [
        { text: "Custom function nodes can't run in parallel", why: "Any nodes can run in parallel." },
        { text: "Two nodes in the same super-step wrote `notes`, and `notes` has no reducer (overwrite)", correct: true, why: "Exactly. With overwrite semantics, LangGraph can't know which write should win, so it refuses." },
        { text: "`notes` isn't declared in the State", why: "It is declared (derived from the nodes). The problem is how concurrent writes combine." },
        { text: "The finalize node runs twice", why: "It runs once — both branches finish in the same step." },
      ],
    },
    fixHint: "Open the State panel and set the reducer for `notes` to append (Annotated[list, operator.add]).",
    lesson: "Parallel branches that write the same key need a reducer. Choosing the reducer is a design decision: append for logs/notes, add for counters, a custom merge for dicts.",
    verify: async (spec) => {
      const tr = await run(spec, "t28");
      const notes = tr.finalState.notes;
      return ok([
        { label: "Run succeeds", ok: tr.status === "success", detail: tr.error ? tr.error.message.slice(0, 100) : undefined },
        { label: "Both notes are kept (a list with 2 items)", ok: Array.isArray(notes) && notes.length === 2, detail: JSON.stringify(notes) },
      ]);
    },
  },
  {
    id: "dbg-key",
    title: "The router can't find its key",
    difficulty: 1,
    category: "State keys",
    symptom: "Right after classification, every run dies in the routing step with a KeyError.",
    testTranscript: "t02",
    spec: {
      id: "dbg-key",
      name: "Broken: router key",
      nodes: [
        startNode(),
        llmNode("classify_intent", "Classify intent", "classify_intent", 300, 110),
        routerNode("route_intent", "Route by intent", { mode: "category", field: "intent_label", branches: ["interested", "not_interested", "unclear"] }, 300, 220),
        llmNode("extract_details", "Extract details", "extract_details", 60, 330),
        fnNode("finalize", "Final output", "finalize", 300, 440),
        endNode(300, 550),
      ],
      edges: [
        edge("start", "classify_intent"),
        edge("classify_intent", "route_intent"),
        edge("route_intent", "extract_details", "interested"),
        edge("route_intent", "finalize", "not_interested"),
        edge("route_intent", "finalize", "unclear"),
        edge("extract_details", "finalize"),
        edge("finalize", "end"),
      ],
    },
    diagnosis: {
      question: "Compare the state after Classify intent with what the router reads. What's wrong?",
      options: [
        { text: "The classifier returned an invalid label", why: "The label is valid; the state shows it under `intent`." },
        { text: "The router reads `intent_label`, but the node writes `intent`", correct: true, why: "Yes — a contract mismatch between producer and consumer of state." },
        { text: "Routers must be placed before LLM nodes", why: "Routers route after nodes; the placement is fine." },
        { text: "The category router needs a default branch", why: "A default helps with unexpected values, but the key itself is missing." },
      ],
    },
    fixHint: "Select the router and change its field to `intent`.",
    lesson: "State keys are a contract between nodes. Typed state (TypedDict/Pydantic) plus a linter or tests on routing functions catch this before production.",
    verify: async (spec) => {
      const r = spec.nodes.find((n) => n.kind === "router");
      const checks: CheckItem[] = [];
      for (const [intent, want] of [["interested", "extract_details"], ["not_interested", "finalize"], ["unclear", "finalize"]] as const) {
        const got = r ? routeFromPred(spec, r.id, { intent }) : "no router";
        checks.push({ label: `intent=${intent} → ${want}`, ok: got === want, detail: got });
      }
      const tr = await run(spec, "t02");
      checks.push({ label: "Run on t02 succeeds", ok: tr.status === "success", detail: tr.error?.message.slice(0, 90) });
      return ok(checks);
    },
  },
  {
    id: "dbg-loop",
    title: "GraphRecursionError",
    difficulty: 3,
    category: "Loops",
    symptom: "A validate-and-retry loop was added to improve reliability. Now runs never finish and die with GraphRecursionError after 25 steps — even on easy calls.",
    testTranscript: "t01",
    spec: {
      id: "dbg-loop",
      name: "Broken: unbounded loop",
      nodes: [
        startNode(),
        llmNode("classify_intent", "Classify intent", "classify_intent", 300, 110, { onParseError: "store" }),
        fnNode("validate", "Validate output", "custom", 300, 220, `// intent must be one of our labels\nreturn { is_valid: state.intent === "Interested" || state.intent === "Not Interested" || state.intent === "Unclear" };`),
        routerNode("check_valid", "Valid?", { mode: "expression", field: "", expression: "state.is_valid ? 'valid' : 'retry'", branches: ["valid", "retry"] }, 300, 330),
        fnNode("count_attempt", "Count attempt", "increment_attempts", 600, 220),
        fnNode("finalize", "Final output", "finalize", 300, 440),
        endNode(300, 550),
      ],
      edges: [
        edge("start", "classify_intent"),
        edge("classify_intent", "validate"),
        edge("validate", "check_valid"),
        edge("check_valid", "finalize", "valid"),
        edge("check_valid", "count_attempt", "retry"),
        edge("count_attempt", "classify_intent"),
        edge("finalize", "end"),
      ],
    },
    diagnosis: {
      question: "Inspect the Validate node's input and output across iterations. What are the TWO defects?",
      options: [
        { text: "The model keeps returning invalid JSON", why: "The parsed output is valid JSON with a valid label every time." },
        { text: "The validator compares against 'Interested' (wrong casing) so it's never valid — and the loop has no attempt limit", correct: true, why: "Both. A bug that makes the exit condition unreachable, plus no bound to stop the damage." },
        { text: "recursion_limit is too low", why: "Raising it only burns more calls before failing the same way." },
        { text: "Count attempt should run before the classifier", why: "Order isn't the problem; nothing reads `attempts` to stop." },
      ],
    },
    fixHint: "Fix the validator to use the real labels (interested/not_interested/unclear) — or swap it for the built-in Validate output — AND bound the loop: state.is_valid ? 'valid' : (state.attempts >= 2 ? 'give_up' : 'retry').",
    lesson: "Every cycle needs an exit you can prove, independent of the model behaving. recursion_limit is a safety net, not a design.",
    verify: async (spec) => {
      const checks: CheckItem[] = [];
      const tr = await run(spec, "t01");
      checks.push({ label: "Run on t01 terminates", ok: tr.status === "success", detail: tr.error ? tr.error.type : `${tr.totals.steps} steps, ${tr.totals.llmCalls} LLM calls` });
      checks.push({ label: "No wasted retries on an easy call (≤ 1 LLM call)", ok: tr.totals.llmCalls <= 1, detail: `${tr.totals.llmCalls} calls` });
      const router = spec.nodes.find((n) => n.kind === "router");
      const expr = router && "expression" in (router.config ?? {}) ? String((router.config as { expression?: string }).expression ?? "") : "";
      checks.push({ label: "Loop is bounded by an attempt counter", ok: /attempts/.test(expr), detail: expr || "no expression" });
      return ok(checks);
    },
  },
  {
    id: "dbg-swapped",
    title: "Reviewers are reviewing the wrong calls",
    difficulty: 2,
    category: "Routing logic (silent)",
    symptom: "No errors anywhere. But the QA team says human reviewers mostly see calls the model was already sure about, while shaky predictions go straight to the CRM.",
    testTranscript: "t25",
    spec: {
      id: "dbg-swapped",
      name: "Broken: silent routing bug",
      checkpointer: true,
      nodes: [
        startNode(),
        llmNode("classify_intent", "Classify intent", "classify_intent", 300, 110),
        routerNode("confidence_gate", "Low confidence?", { mode: "threshold", field: "confidence", op: "<", value: 0.7, branches: ["low", "high"] }, 300, 220),
        humanNode("human_review", "Human review", 60, 330, ["intent"]),
        fnNode("finalize", "Final output", "finalize", 300, 440),
        endNode(300, 550),
      ],
      edges: [
        edge("start", "classify_intent"),
        edge("classify_intent", "confidence_gate"),
        edge("confidence_gate", "finalize", "low"),
        edge("confidence_gate", "human_review", "high"),
        edge("human_review", "finalize"),
        edge("finalize", "end"),
      ],
    },
    diagnosis: {
      question: "Run t25 (a confident, easy call) and follow the route decision. What's wrong?",
      options: [
        { text: "The threshold 0.7 is too low", why: "The threshold is reasonable; the wiring is backwards." },
        { text: "The 'low' and 'high' branches are connected to the wrong nodes", correct: true, why: "Yes: low → finalize and high → human_review. No exception, just wrong behaviour — the most dangerous kind of bug." },
        { text: "The model's confidence is miscalibrated", why: "Calibration matters, but here even perfect confidences would be routed wrongly." },
        { text: "Human review needs a checkpointer", why: "It has one." },
      ],
    },
    fixHint: "Reconnect: low → Human review, high → Final output (delete the two router edges and redraw them from the right handles).",
    lesson: "Silent bugs don't raise. Test routing functions with unit tests (confidence 0.5 → review, 0.9 → auto) and monitor the review rate in production.",
    verify: async (spec) => {
      const r = spec.nodes.find((n) => n.kind === "router");
      const low = r ? routeFromPred(spec, r.id, { confidence: 0.5 }) : "";
      const high = r ? routeFromPred(spec, r.id, { confidence: 0.92 }) : "";
      return ok([
        { label: "confidence 0.50 → human_review", ok: low === "human_review", detail: low },
        { label: "confidence 0.92 → finalize", ok: high === "finalize", detail: high },
      ]);
    },
  },
  {
    id: "dbg-checkpointer",
    title: "interrupt() blows up",
    difficulty: 1,
    category: "Persistence",
    symptom: "A strict review policy was added (review anything below 0.95 confidence). Now the run crashes as soon as it reaches Human review.",
    testTranscript: "t20",
    spec: {
      id: "dbg-checkpointer",
      name: "Broken: no checkpointer",
      checkpointer: false,
      nodes: [
        startNode(),
        llmNode("classify_intent", "Classify intent", "classify_intent", 300, 110),
        routerNode("confidence_gate", "Low confidence?", { mode: "threshold", field: "confidence", op: "<", value: 0.95, branches: ["low", "high"] }, 300, 220),
        humanNode("human_review", "Human review", 60, 330, ["intent"]),
        fnNode("finalize", "Final output", "finalize", 300, 440),
        endNode(300, 550),
      ],
      edges: [
        edge("start", "classify_intent"),
        edge("classify_intent", "confidence_gate"),
        edge("confidence_gate", "human_review", "low"),
        edge("confidence_gate", "finalize", "high"),
        edge("human_review", "finalize"),
        edge("finalize", "end"),
      ],
    },
    diagnosis: {
      question: "Why does interrupt() fail here?",
      options: [
        { text: "Human review nodes must be the last node", why: "They can be anywhere." },
        { text: "The graph has no checkpointer, so there's nowhere to save the paused state", correct: true, why: "Right. Pausing means persisting state so a later call (Command(resume=...)) can continue the same thread." },
        { text: "The threshold is too high", why: "A high threshold means more reviews, not crashes." },
        { text: "interrupt() only works with async graphs", why: "It works with sync and async graphs." },
      ],
    },
    fixHint: "Turn on Persistence (checkpointer) in the run panel.",
    lesson: "Human-in-the-loop is built on persistence: compile(checkpointer=...) + a thread_id. In production use a durable checkpointer (Postgres/SQLite), not in-memory.",
    verify: async (spec) => {
      const tr = await run(spec, "t20");
      return ok([
        { label: "Checkpointer enabled", ok: !!spec.checkpointer },
        { label: "Run pauses for review instead of crashing", ok: tr.status === "interrupted" || tr.status === "success", detail: tr.status + (tr.error ? `: ${tr.error.message.slice(0, 80)}` : "") },
      ]);
    },
  },
  {
    id: "dbg-pii",
    title: "PII in the model logs",
    difficulty: 2,
    category: "Data flow (silent)",
    symptom: "A security review found customers' phone numbers and PAN numbers inside LLM request logs, even though the pipeline has a 'Redact PII' step.",
    testTranscript: "t28",
    spec: {
      id: "dbg-pii",
      name: "Broken: redaction order",
      nodes: [
        startNode(),
        llmNode("classify_intent", "Classify intent", "classify_intent", 300, 110),
        fnNode("redact", "Redact PII", "redact_pii", 300, 220),
        fnNode("finalize", "Final output", "finalize", 300, 330),
        endNode(300, 440),
      ],
      edges: [edge("start", "classify_intent"), edge("classify_intent", "redact"), edge("redact", "finalize"), edge("finalize", "end")],
    },
    diagnosis: {
      question: "Run t28, open Classify intent → Prompt. What's the root cause?",
      options: [
        { text: "The redaction regex misses Indian phone formats", why: "It masks them fine — it just runs too late." },
        { text: "Redaction runs AFTER the model call, so the raw transcript is sent to the LLM", correct: true, why: "Yes. The order of nodes is a data-governance decision, not just a performance one." },
        { text: "The LLM provider logs requests", why: "Providers may log; that's exactly why PII must not reach them." },
        { text: "The final output includes the transcript", why: "It doesn't — but the prompt does." },
      ],
    },
    fixHint: "Rewire: START → Redact PII → Classify intent → Final output.",
    lesson: "Guardrails belong before the model. Verify with tests on the actual prompt that's sent (traces make this possible).",
    verify: async (spec) => {
      const tr = await run(spec, "t28");
      const prompts = tr.spans.flatMap((s) => s.llmCalls.map((c) => c.prompt)).join("\n");
      const leaked = /ABCDE1234F|98765 43210|ravi\.k@example\.com/.test(prompts);
      return ok([
        { label: "Run succeeds", ok: tr.status === "success", detail: tr.error?.message },
        { label: "An LLM call was made", ok: prompts.length > 0 },
        { label: "No phone / PAN / e-mail in any prompt sent to the model", ok: prompts.length > 0 && !leaked, detail: leaked ? "PII found in prompt" : "clean" },
      ]);
    },
  },
];

export function getChallenge(id: string) {
  return DEBUG_CHALLENGES.find((c) => c.id === id);
}
