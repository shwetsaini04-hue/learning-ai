import type { TaskId } from "@/lib/ai/types";
import type { Reducer } from "@/lib/engine/types";

export type WfNodeKind = "start" | "end" | "llm" | "function" | "router" | "human" | "tool";

export interface LLMNodeConfig {
  task: TaskId;
  promptVersion: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** raise = node fails on bad output (LangGraph default); store = write `<node>_error` and continue */
  onParseError: "raise" | "store";
  /** RetryPolicy(max_attempts=N) */
  retries: number;
  customSystem?: string;
  customPrompt?: string;
  /** state key to read the transcript from (default: cleaned_transcript, else transcript) */
  inputKey?: string;
  /** output field -> state key overrides */
  outputs?: Record<string, string>;
}

export type FunctionId =
  | "clean_transcript"
  | "redact_pii"
  | "compute_confidence"
  | "validate_output"
  | "increment_attempts"
  | "finalize"
  | "custom";

export interface FunctionNodeConfig {
  fn: FunctionId;
  code?: string;
}

export interface RouterConfig {
  mode: "threshold" | "category" | "expression";
  field: string;
  op?: "<" | "<=" | ">" | ">=" | "==" | "!=";
  value?: number | string;
  /** threshold: [whenTrue, whenFalse]; category: the values; expression: possible return values */
  branches: string[];
  /** category mode: branch used when the value matches nothing */
  defaultBranch?: string;
  /** expression mode: JS expression using `state`, must evaluate to a branch name */
  expression?: string;
}

export interface HumanNodeConfig {
  question: string;
  fields: string[];
}

export type ToolId = "crm_lookup" | "rate_lookup" | "send_followup";

export interface ToolNodeConfig {
  tool: ToolId;
}

export type NodeConfig = LLMNodeConfig | FunctionNodeConfig | RouterConfig | HumanNodeConfig | ToolNodeConfig | Record<string, never>;

export interface WfNode {
  id: string;
  kind: WfNodeKind;
  label: string;
  x: number;
  y: number;
  config?: NodeConfig;
  /** LangGraph defer=True */
  defer?: boolean;
  note?: string;
}

export interface WfEdge {
  id: string;
  source: string;
  target: string;
  /** set when the source is a router: which branch this edge represents */
  branch?: string;
}

export interface WorkflowSpec {
  id: string;
  name: string;
  description?: string;
  nodes: WfNode[];
  edges: WfEdge[];
  reducers?: Record<string, Reducer>;
  checkpointer?: boolean;
  recursionLimit?: number;
}

export const FUNCTION_INFO: Record<FunctionId, { label: string; description: string; writes: string[]; reads: string[] }> = {
  clean_transcript: { label: "Clean transcript", description: "Normalize whitespace and remove filler words.", writes: ["cleaned_transcript"], reads: ["transcript"] },
  redact_pii: { label: "Redact PII", description: "Mask phone numbers, PAN, e-mails before any LLM sees the text.", writes: ["cleaned_transcript"], reads: ["transcript", "cleaned_transcript"] },
  compute_confidence: { label: "Confidence check", description: "Overall confidence = the lowest confidence among the model outputs.", writes: ["confidence"], reads: ["confidence", "product_confidence", "sentiment_confidence"] },
  validate_output: { label: "Validate output", description: "Checks that intent is a valid label and no LLM node stored a parse error.", writes: ["is_valid"], reads: ["intent"] },
  increment_attempts: { label: "Count attempt", description: "attempts += 1 (uses an `add` reducer).", writes: ["attempts"], reads: [] },
  finalize: { label: "Final output", description: "Assemble the structured final result.", writes: ["final_output", "status"], reads: [] },
  custom: { label: "Custom function", description: "Your own JavaScript: return a dict of state updates.", writes: [], reads: [] },
};

export const TOOL_INFO: Record<ToolId, { label: string; description: string; writes: string[]; latencyMs: number }> = {
  crm_lookup: { label: "CRM lookup", description: "Fetch the customer profile from the CRM.", writes: ["customer_profile"], latencyMs: 140 },
  rate_lookup: { label: "Rate lookup", description: "Look up current rates for the product.", writes: ["rate_info"], latencyMs: 90 },
  send_followup: { label: "Send follow-up", description: "Queue an email/WhatsApp with details (side effect!).", writes: ["actions"], latencyMs: 180 },
};

export const KIND_INFO: Record<WfNodeKind, { label: string; description: string }> = {
  start: { label: "START", description: "Entry point. The input dict becomes the initial state." },
  end: { label: "END", description: "Terminal node. When nothing else is scheduled, the run finishes." },
  llm: { label: "LLM node", description: "Builds a prompt from state, calls a model, parses structured output, returns updates." },
  function: { label: "Function node", description: "Plain deterministic Python/JS — no model call." },
  router: { label: "Router (conditional edge)", description: "Not a node in LangGraph: compiles to add_conditional_edges with a routing function." },
  human: { label: "Human review", description: "Calls interrupt(): the run pauses until a human resumes it with Command(resume=...)." },
  tool: { label: "Tool node", description: "Calls an external system (CRM, rates API, messaging)." },
};
