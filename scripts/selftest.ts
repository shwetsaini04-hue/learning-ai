/**
 * Self-test for the lab's teaching engine. Run: npm run selftest
 * Verifies that simulations behave as the lessons claim, every template runs,
 * every debug challenge is broken-then-fixable, and every exercise is solvable.
 */
import { SIMULATED_MODELS } from "../src/config/models";
import { DEBUG_CHALLENGES } from "../src/content/debugChallenges";
import { CHECKERS, EXERCISES } from "../src/content/exercises";
import type { LLMRequest } from "../src/lib/ai/types";
import { transcriptToText } from "../src/lib/domain";
import { MemoryCheckpointer } from "../src/lib/engine/checkpointer";
import { runGraph } from "../src/lib/engine/graph";
import { JUDGE_CASES, JUDGE_QUESTION, JUDGE_REFERENCE, DEFAULT_RUBRIC, runJudge } from "../src/lib/eval/judge";
import { pearson } from "../src/lib/eval/metrics";
import { simulateLLM } from "../src/lib/sim/mockLLM";
import { findTranscript, TRANSCRIPTS } from "../src/lib/sim/transcripts";
import { deepClone } from "../src/lib/utils";
import { generatePython } from "../src/lib/workflows/codegen";
import { compileWorkflow } from "../src/lib/workflows/compile";
import { lintWorkflow } from "../src/lib/workflows/lint";
import type { FunctionNodeConfig, LLMNodeConfig, RouterConfig, WorkflowSpec } from "../src/lib/workflows/spec";
import { edge, fnNode, getTemplate, humanNode, llmNode, routerNode, TEMPLATES, toolNode } from "../src/lib/workflows/templates";
import { simClassify } from "../src/lessons/widgets/simData";
import { getBenchmark } from "../src/lib/sim/transcripts";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}

const invoker = async (req: LLMRequest) => simulateLLM(req, SIMULATED_MODELS.find((m) => m.id === req.model)!);

const FIXES: Record<string, (s: WorkflowSpec) => WorkflowSpec> = {
  "dbg-prose": (s) => {
    (s.nodes[1].config as LLMNodeConfig).promptVersion = "v3";
    return s;
  },
  "dbg-reasoning-budget": (s) => {
    (s.nodes[1].config as LLMNodeConfig).maxTokens = 2048;
    return s;
  },
  "dbg-reducer": (s) => ({ ...s, reducers: { notes: "append" } }),
  "dbg-key": (s) => {
    (s.nodes.find((n) => n.kind === "router")!.config as RouterConfig).field = "intent";
    return s;
  },
  "dbg-loop": (s) => {
    const v = s.nodes.find((n) => n.id === "validate")!;
    v.config = { fn: "validate_output" } as FunctionNodeConfig;
    const r = s.nodes.find((n) => n.kind === "router")!.config as RouterConfig;
    r.expression = "state.is_valid ? 'valid' : (state.attempts >= 2 ? 'give_up' : 'retry')";
    r.branches = ["valid", "retry", "give_up"];
    s.edges.push(edge("check_valid", "finalize", "give_up"));
    return s;
  },
  "dbg-swapped": (s) => ({
    ...s,
    edges: [...s.edges.filter((e) => e.source !== "confidence_gate"), edge("confidence_gate", "human_review", "low"), edge("confidence_gate", "finalize", "high")],
  }),
  "dbg-checkpointer": (s) => ({ ...s, checkpointer: true }),
  "dbg-pii": (s) => ({ ...s, edges: [edge("start", "redact"), edge("redact", "classify_intent"), edge("classify_intent", "finalize"), edge("finalize", "end")] }),
};

const start = { id: "start", kind: "start" as const, label: "START", x: 0, y: 0 };
const end = { id: "end", kind: "end" as const, label: "END", x: 0, y: 0 };
const SOLUTIONS: Record<string, WorkflowSpec> = {
  "ex-first-chain": getTemplate("simple_chain"),
  "ex-parallel": getTemplate("parallel"),
  "ex-retry-loop": getTemplate("loop"),
  "ex-sentiment-review": {
    id: "sol-sr",
    name: "solution",
    checkpointer: true,
    nodes: [
      start,
      llmNode("sentiment", "Sentiment", "sentiment", 0, 0),
      llmNode("classify_intent", "Intent", "classify_intent", 0, 0),
      fnNode("cc", "Confidence", "compute_confidence", 0, 0),
      routerNode("gate", "Low?", { mode: "threshold", field: "confidence", op: "<", value: 0.7, branches: ["low", "high"] }, 0, 0),
      humanNode("hr", "Human", 0, 0),
      fnNode("fin", "Final", "finalize", 0, 0),
      end,
    ],
    edges: [edge("start", "sentiment"), edge("sentiment", "classify_intent"), edge("classify_intent", "cc"), edge("cc", "gate"), edge("gate", "hr", "low"), edge("gate", "fin", "high"), edge("hr", "fin"), edge("fin", "end")],
  },
  "ex-intent-routing": {
    id: "sol-ir",
    name: "solution",
    checkpointer: true,
    nodes: [
      start,
      llmNode("classify_intent", "Intent", "classify_intent", 0, 0),
      routerNode("r", "By intent", { mode: "category", field: "intent", branches: ["interested", "not_interested", "unclear"] }, 0, 0),
      toolNode("crm", "CRM", "crm_lookup", 0, 0),
      toolNode("fu", "Follow", "send_followup", 0, 0),
      humanNode("hr", "Human", 0, 0),
      fnNode("fin", "Final", "finalize", 0, 0),
      end,
    ],
    edges: [edge("start", "classify_intent"), edge("classify_intent", "r"), edge("r", "crm", "interested"), edge("r", "fin", "not_interested"), edge("r", "hr", "unclear"), edge("crm", "fu"), edge("fu", "fin"), edge("hr", "fin"), edge("fin", "end")],
  },
  "ex-capstone-build": getTemplate("transcript_pipeline"),
};

(async () => {
  console.log("\n# Simulator behaves as taught");
  const bench = getBenchmark();
  const acc = (m: string, v: string) => simClassify(m, v, bench).filter((p) => p.correct).length / bench.length;
  const valid = (m: string, v: string) => simClassify(m, v, bench).filter((p) => p.valid).length / bench.length;
  check("V3 beats V2 on Swift-M", acc("sim:swift-m", "v3") > acc("sim:swift-m", "v2"), `${acc("sim:swift-m", "v2").toFixed(2)} → ${acc("sim:swift-m", "v3").toFixed(2)}`);
  check("V4 (cost-cut) regresses vs V3", acc("sim:swift-m", "v4") < acc("sim:swift-m", "v3"));
  check("V1 mostly invalid (prose)", valid("sim:swift-m", "v1") < 0.4, valid("sim:swift-m", "v1").toFixed(2));
  check("Atlas-L beats Pico-S", acc("sim:atlas-l", "v3") > acc("sim:pico-s", "v3"));
  const a = simClassify("sim:swift-m", "v3", TRANSCRIPTS.slice(0, 5), 0, 1).map((p) => p.pred).join();
  const b = simClassify("sim:swift-m", "v3", TRANSCRIPTS.slice(0, 5), 0, 2).map((p) => p.pred).join();
  check("Temperature 0 is deterministic", a === b);

  console.log("\n# Templates run and lint clean");
  for (const id of Object.keys(TEMPLATES).filter((t) => t !== "blank" && !t.startsWith("ex_"))) {
    const spec = getTemplate(id);
    const errors = lintWorkflow(spec).filter((i) => i.level === "error");
    const t = findTranscript("t05")!;
    const tr = await runGraph(compileWorkflow(spec, { llm: invoker }), { transcript: transcriptToText(t), transcript_id: t.id }, {
      llm: invoker,
      checkpointer: spec.checkpointer ? new MemoryCheckpointer() : null,
      threadId: "x",
    });
    check(`template ${id}`, errors.length === 0 && (tr.status === "success" || tr.status === "interrupted"), errors[0]?.message ?? tr.error?.message ?? tr.status);
    const py = generatePython(spec);
    if (!py.includes("StateGraph(State)") || !py.includes("builder.compile(")) check(`codegen ${id}`, false);
  }

  console.log("\n# Debug challenges: broken fails, fix passes");
  for (const c of DEBUG_CHALLENGES) {
    const broken = await c.verify(deepClone(c.spec));
    const fixed = await c.verify(FIXES[c.id](deepClone(c.spec)));
    check(c.id, !broken.passed && fixed.passed, fixed.passed ? "" : JSON.stringify(fixed.checks.filter((x) => !x.ok)));
  }

  console.log("\n# Exercises: solution passes, starter fails");
  for (const [id, spec] of Object.entries(SOLUTIONS)) {
    const sol = await CHECKERS[id](spec);
    const starter = await CHECKERS[id](getTemplate(EXERCISES.find((e) => e.id === id)!.starterTemplate ?? "blank"));
    check(id, sol.passed && !starter.passed, sol.passed ? "" : JSON.stringify(sol.checks.filter((x) => !x.ok)));
  }

  console.log("\n# Judge calibration exercise is solvable");
  const ctx = transcriptToText(findTranscript("t01")!);
  const r = async (rub: typeof DEFAULT_RUBRIC) => {
    const s: number[] = [];
    for (const jc of JUDGE_CASES) s.push((await runJudge("sim:swift-m", { question: JUDGE_QUESTION, reference: JUDGE_REFERENCE, answer: jc.answer, context: ctx }, rub)).score ?? 3);
    return pearson(s, JUDGE_CASES.map((x) => x.human));
  };
  const before = await r(DEFAULT_RUBRIC);
  const after = await r({ ...DEFAULT_RUBRIC, penalizeUnsupported: true, requireLabelMatch: true, strictness: 0.4 });
  check("default rubric below target", before < 0.75, before.toFixed(2));
  check("improved rubric reaches target", after >= 0.75, after.toFixed(2));

  console.log(`\n${failures ? `✗ ${failures} check(s) failed` : "✓ all checks passed"}`);
  process.exit(failures ? 1 : 0);
})();
