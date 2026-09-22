import { DEFAULT_SIM_MODEL } from "@/config/models";
import { TASKS } from "@/lib/ai/tasks";
import type { TaskId } from "@/lib/ai/types";
import { deepClone } from "@/lib/utils";
import type { FunctionId, LLMNodeConfig, RouterConfig, ToolId, WfEdge, WfNode, WorkflowSpec } from "./spec";

export function llmNode(id: string, label: string, task: TaskId, x: number, y: number, over: Partial<LLMNodeConfig> = {}): WfNode {
  const def = task === "custom" ? undefined : TASKS[task];
  return {
    id,
    kind: "llm",
    label,
    x,
    y,
    config: {
      task,
      promptVersion: def?.defaultVersion ?? "v1",
      model: DEFAULT_SIM_MODEL,
      temperature: 0,
      maxTokens: 1024,
      onParseError: "raise",
      retries: 1,
      ...over,
    },
  };
}
export function fnNode(id: string, label: string, fn: FunctionId, x: number, y: number, code?: string): WfNode {
  return { id, kind: "function", label, x, y, config: { fn, code } };
}
export function routerNode(id: string, label: string, cfg: RouterConfig, x: number, y: number): WfNode {
  return { id, kind: "router", label, x, y, config: cfg };
}
export function humanNode(id: string, label: string, x: number, y: number, fields = ["intent", "product"], question = "Please verify the model's prediction."): WfNode {
  return { id, kind: "human", label, x, y, config: { question, fields } };
}
export function toolNode(id: string, label: string, tool: ToolId, x: number, y: number): WfNode {
  return { id, kind: "tool", label, x, y, config: { tool } };
}
export const startNode = (x = 300, y = 0): WfNode => ({ id: "start", kind: "start", label: "START", x, y });
export const endNode = (x = 300, y = 500, id = "end"): WfNode => ({ id, kind: "end", label: "END", x, y });
export const edge = (source: string, target: string, branch?: string): WfEdge => ({
  id: `${source}->${target}${branch ? `:${branch}` : ""}`,
  source,
  target,
  branch,
});

const confidenceRouter = (threshold = 0.7, x = 300, y = 440) =>
  routerNode("confidence_gate", "Low confidence?", { mode: "threshold", field: "confidence", op: "<", value: threshold, branches: ["low", "high"] }, x, y);

export const TEMPLATES: Record<string, WorkflowSpec> = {
  blank: {
    id: "blank",
    name: "Blank graph",
    description: "START and END. Add nodes from the palette.",
    nodes: [startNode(300, 0), endNode(300, 300)],
    edges: [],
  },
  simple_chain: {
    id: "simple_chain",
    name: "1 · Simple chain",
    description: "One prompt, one model call. Prompt → LLM → structured output.",
    nodes: [startNode(), llmNode("classify_intent", "Classify intent", "classify_intent", 300, 120), endNode(300, 240)],
    edges: [edge("start", "classify_intent"), edge("classify_intent", "end")],
  },
  sequential: {
    id: "sequential",
    name: "2 · Sequential workflow",
    description: "Several steps in a fixed order. Each step adds to the state.",
    nodes: [
      startNode(),
      fnNode("clean", "Clean transcript", "clean_transcript", 300, 110),
      llmNode("classify_intent", "Classify intent", "classify_intent", 300, 220),
      llmNode("extract_product", "Extract product", "extract_product", 300, 330),
      fnNode("finalize", "Final output", "finalize", 300, 440),
      endNode(300, 550),
    ],
    edges: [edge("start", "clean"), edge("clean", "classify_intent"), edge("classify_intent", "extract_product"), edge("extract_product", "finalize"), edge("finalize", "end")],
  },
  parallel: {
    id: "parallel",
    name: "3 · Parallel workflow",
    description: "Independent analyses run in the same super-step, then fan in.",
    nodes: [
      startNode(),
      fnNode("clean", "Clean transcript", "clean_transcript", 300, 110),
      llmNode("classify_intent", "Classify intent", "classify_intent", 60, 230),
      llmNode("extract_product", "Extract product", "extract_product", 300, 230),
      llmNode("sentiment", "Sentiment", "sentiment", 540, 230),
      fnNode("confidence_check", "Confidence check", "compute_confidence", 300, 350),
      fnNode("finalize", "Final output", "finalize", 300, 460),
      endNode(300, 570),
    ],
    edges: [
      edge("start", "clean"),
      edge("clean", "classify_intent"),
      edge("clean", "extract_product"),
      edge("clean", "sentiment"),
      edge("classify_intent", "confidence_check"),
      edge("extract_product", "confidence_check"),
      edge("sentiment", "confidence_check"),
      edge("confidence_check", "finalize"),
      edge("finalize", "end"),
    ],
  },
  routing: {
    id: "routing",
    name: "4 · Conditional routing",
    description: "The model's output decides which path runs next.",
    nodes: [
      startNode(),
      llmNode("classify_intent", "Classify intent", "classify_intent", 300, 110),
      routerNode("route_intent", "Route by intent", { mode: "category", field: "intent", branches: ["interested", "not_interested", "unclear"] }, 300, 220),
      llmNode("extract_details", "Extract details", "extract_details", 60, 340),
      fnNode("finalize", "Final output", "finalize", 300, 460),
      endNode(300, 570),
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
  loop: {
    id: "loop",
    name: "5 · Loop (validate & retry)",
    description: "If the output is invalid, feed the error back and retry — with a limit.",
    nodes: [
      startNode(),
      llmNode("classify_intent", "Classify intent", "classify_intent", 300, 110, { promptVersion: "v1", onParseError: "store", model: "sim:pico-s" }),
      fnNode("validate", "Validate output", "validate_output", 300, 220),
      routerNode(
        "check_valid",
        "Valid?",
        { mode: "expression", field: "", expression: "state.is_valid ? 'valid' : (state.attempts >= 2 ? 'give_up' : 'retry')", branches: ["valid", "retry", "give_up"] },
        300,
        330,
      ),
      fnNode("count_attempt", "Count attempt", "increment_attempts", 600, 220),
      fnNode("finalize", "Final output", "finalize", 300, 460),
      endNode(300, 570),
    ],
    edges: [
      edge("start", "classify_intent"),
      edge("classify_intent", "validate"),
      edge("validate", "check_valid"),
      edge("check_valid", "finalize", "valid"),
      edge("check_valid", "count_attempt", "retry"),
      edge("check_valid", "finalize", "give_up"),
      edge("count_attempt", "classify_intent"),
      edge("finalize", "end"),
    ],
  },
  stateful: {
    id: "stateful",
    name: "6 · Stateful workflow",
    description: "State accumulates across steps (reducers) and is checkpointed after every step.",
    checkpointer: true,
    nodes: [
      startNode(),
      llmNode("full_analysis", "Analyze call", "full_analysis", 300, 110),
      toolNode("crm_lookup", "CRM lookup", "crm_lookup", 300, 220),
      toolNode("send_followup", "Send follow-up", "send_followup", 300, 330),
      fnNode("finalize", "Final output", "finalize", 300, 440),
      endNode(300, 550),
    ],
    edges: [edge("start", "full_analysis"), edge("full_analysis", "crm_lookup"), edge("crm_lookup", "send_followup"), edge("send_followup", "finalize"), edge("finalize", "end")],
  },
  hitl: {
    id: "hitl",
    name: "7 · Human-in-the-loop",
    description: "Low-confidence predictions pause for a human. Needs a checkpointer.",
    checkpointer: true,
    nodes: [
      startNode(),
      fnNode("redact", "Redact PII", "redact_pii", 300, 110),
      llmNode("classify_intent", "Classify intent", "classify_intent", 300, 220),
      confidenceRouter(0.7, 300, 330),
      humanNode("human_review", "Human review", 60, 440, ["intent"]),
      fnNode("finalize", "Final output", "finalize", 300, 550),
      endNode(300, 660),
    ],
    edges: [
      edge("start", "redact"),
      edge("redact", "classify_intent"),
      edge("classify_intent", "confidence_gate"),
      edge("confidence_gate", "human_review", "low"),
      edge("confidence_gate", "finalize", "high"),
      edge("human_review", "finalize"),
      edge("finalize", "end"),
    ],
  },
  agentic: {
    id: "agentic",
    name: "8 · Tool-using workflow",
    description: "The model's analysis decides which tools run. (A true agent lets the LLM pick tools in a loop.)",
    checkpointer: true,
    nodes: [
      startNode(),
      llmNode("full_analysis", "Analyze call", "full_analysis", 300, 110),
      routerNode("route_intent", "Route by intent", { mode: "category", field: "intent", branches: ["interested", "not_interested", "unclear"] }, 300, 220),
      toolNode("crm_lookup", "CRM lookup", "crm_lookup", 40, 330),
      toolNode("rate_lookup", "Rate lookup", "rate_lookup", 40, 440),
      toolNode("send_followup", "Send follow-up", "send_followup", 40, 550),
      humanNode("human_review", "Human review", 560, 380, ["intent", "product"]),
      fnNode("finalize", "Final output", "finalize", 300, 660),
      endNode(300, 770),
    ],
    edges: [
      edge("start", "full_analysis"),
      edge("full_analysis", "route_intent"),
      edge("route_intent", "crm_lookup", "interested"),
      edge("route_intent", "finalize", "not_interested"),
      edge("route_intent", "human_review", "unclear"),
      edge("crm_lookup", "rate_lookup"),
      edge("rate_lookup", "send_followup"),
      edge("send_followup", "finalize"),
      edge("human_review", "finalize"),
      edge("finalize", "end"),
    ],
  },
  transcript_pipeline: {
    id: "transcript_pipeline",
    name: "Transcript analysis pipeline",
    description: "Redact → clean → 4 parallel analyses → confidence gate → human review or final output.",
    checkpointer: true,
    nodes: [
      startNode(330, 0),
      fnNode("redact", "Redact PII", "redact_pii", 330, 100),
      fnNode("clean", "Clean transcript", "clean_transcript", 330, 200),
      llmNode("classify_intent", "Classify intent", "classify_intent", 0, 320),
      llmNode("extract_product", "Extract product", "extract_product", 220, 320),
      llmNode("sentiment", "Sentiment", "sentiment", 440, 320),
      llmNode("extract_details", "Extract details", "extract_details", 660, 320),
      fnNode("confidence_check", "Confidence check", "compute_confidence", 330, 440),
      confidenceRouter(0.7, 330, 550),
      humanNode("human_review", "Human review", 60, 660, ["intent", "product"]),
      fnNode("finalize", "Final output", "finalize", 330, 770),
      endNode(330, 880),
    ],
    edges: [
      edge("start", "redact"),
      edge("redact", "clean"),
      edge("clean", "classify_intent"),
      edge("clean", "extract_product"),
      edge("clean", "sentiment"),
      edge("clean", "extract_details"),
      edge("classify_intent", "confidence_check"),
      edge("extract_product", "confidence_check"),
      edge("sentiment", "confidence_check"),
      edge("extract_details", "confidence_check"),
      edge("confidence_check", "confidence_gate"),
      edge("confidence_gate", "human_review", "low"),
      edge("confidence_gate", "finalize", "high"),
      edge("human_review", "finalize"),
      edge("finalize", "end"),
    ],
  },
  ex_retry_start: {
    id: "ex_retry_start",
    name: "Exercise: retry loop (starter)",
    description: "A fragile classifier that often returns prose instead of JSON.",
    nodes: [
      startNode(),
      llmNode("classify_intent", "Classify intent", "classify_intent", 300, 120, { promptVersion: "v1", onParseError: "store", model: "sim:pico-s" }),
      fnNode("finalize", "Final output", "finalize", 300, 460),
      endNode(300, 570),
    ],
    edges: [edge("start", "classify_intent"), edge("classify_intent", "finalize"), edge("finalize", "end")],
  },
  single_call: {
    id: "single_call",
    name: "Single-call analysis",
    description: "One LLM call extracts everything; then the same confidence gate.",
    checkpointer: true,
    nodes: [
      startNode(),
      fnNode("redact", "Redact PII", "redact_pii", 300, 110),
      llmNode("full_analysis", "Analyze call (1 prompt)", "full_analysis", 300, 220),
      confidenceRouter(0.7, 300, 330),
      humanNode("human_review", "Human review", 60, 440, ["intent", "product"]),
      fnNode("finalize", "Final output", "finalize", 300, 550),
      endNode(300, 660),
    ],
    edges: [
      edge("start", "redact"),
      edge("redact", "full_analysis"),
      edge("full_analysis", "confidence_gate"),
      edge("confidence_gate", "human_review", "low"),
      edge("confidence_gate", "finalize", "high"),
      edge("human_review", "finalize"),
      edge("finalize", "end"),
    ],
  },
};

export function getTemplate(id: string): WorkflowSpec {
  return deepClone(TEMPLATES[id] ?? TEMPLATES.blank);
}

export const LADDER: { id: string; title: string; whatsNew: string; whenToUse: string; watch: string }[] = [
  { id: "simple_chain", title: "Simple chain", whatsNew: "Prompt → model → parsed output.", whenToUse: "One well-defined task. Most LLM features start (and many stay) here.", watch: "No validation, no fallback: one bad output = one bad result." },
  { id: "sequential", title: "Sequential workflow", whatsNew: "Several steps in a fixed order sharing state.", whenToUse: "Each step needs the previous step's output (clean → classify → extract).", watch: "Latency adds up: total ≈ sum of steps." },
  { id: "parallel", title: "Parallel workflow", whatsNew: "Independent steps run in the same super-step.", whenToUse: "Analyses don't depend on each other.", watch: "Two branches writing the same key need a reducer. Latency ≈ slowest branch." },
  { id: "routing", title: "Conditional routing", whatsNew: "State decides the next node (add_conditional_edges).", whenToUse: "Different inputs need different handling.", watch: "Every possible route value needs a destination." },
  { id: "loop", title: "Loops", whatsNew: "An edge goes back to an earlier node.", whenToUse: "Validate-and-retry, refine-until-good.", watch: "Always bound the loop (attempt counter + recursion_limit)." },
  { id: "stateful", title: "Stateful workflow", whatsNew: "Reducers accumulate; a checkpointer saves every step.", whenToUse: "Long-running or resumable work; audit trails.", watch: "Side effects (sending messages) must be idempotent — nodes can re-run." },
  { id: "hitl", title: "Human-in-the-loop", whatsNew: "interrupt() pauses; Command(resume=...) continues.", whenToUse: "Low confidence, high stakes, compliance review.", watch: "Code before interrupt() runs again on resume." },
  { id: "agentic", title: "Agentic workflow", whatsNew: "Model output selects tools and actions.", whenToUse: "The path can't be fully specified in advance.", watch: "Hardest to test and bound; prefer the simplest level that works." },
];
