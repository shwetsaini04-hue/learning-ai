import type { LLMInvoker, LLMRequest, LLMResponse } from "@/lib/ai/types";

export const START = "__start__";
export const END = "__end__";

/**
 * How a state key combines updates (LangGraph "reducers"):
 * - overwrite: last write wins; TWO writes in the same super-step is an error (InvalidUpdateError)
 * - append:    list concatenation  (Annotated[list, operator.add])
 * - add:       numeric addition     (Annotated[int, operator.add])
 * - merge:     shallow dict merge
 */
export type Reducer = "overwrite" | "append" | "add" | "merge";

export interface ChannelDef {
  reducer: Reducer;
  default?: unknown;
  description?: string;
}

export type StateSchema = Record<string, ChannelDef>;
export type GraphState = Record<string, unknown>;

export type NodeKind = "llm" | "function" | "router" | "human" | "tool" | "start" | "end";

export interface LLMCallRecord {
  id: string;
  model: string;
  provider: string;
  simulated: boolean;
  task?: string;
  promptVersion?: string;
  system: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  rawOutput: string;
  parsed?: Record<string, unknown> | null;
  parseSteps?: string[];
  parseError?: { message: string; expected?: string; received?: string } | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  latencyMs: number;
  ttftMs: number;
  stopReason?: string;
}

export interface NodeErrorInfo {
  type: string;
  message: string;
  node?: string;
  expected?: string;
  received?: string;
  hint?: string;
}

export interface NodeSpan {
  id: string;
  node: string;
  kind: NodeKind;
  label: string;
  step: number;
  attempt: number;
  status: "success" | "error" | "interrupted";
  stateBefore: GraphState;
  update: Partial<GraphState> | null;
  stateAfter: GraphState | null;
  llmCalls: LLMCallRecord[];
  logs: string[];
  error?: NodeErrorInfo;
  simStartMs: number;
  simDurationMs: number;
  goto?: string[];
}

export interface RouteDecision {
  step: number;
  source: string;
  routerId?: string;
  label?: string;
  result: string[];
  explanation: string;
}

export interface InterruptInfo {
  id: string;
  node: string;
  payload: unknown;
}

export interface PendingWrite {
  node: string;
  update: Partial<GraphState> | null;
  goto?: string[];
}

export interface Checkpoint {
  id: string;
  threadId: string;
  step: number;
  values: GraphState;
  next: string[];
  createdAt: number;
  parentId?: string;
  source: "input" | "loop" | "update" | "interrupt";
  interrupt?: InterruptInfo;
  pendingWrites?: PendingWrite[];
  /** which nodes wrote in the step that produced this checkpoint */
  writers?: string[];
}

export interface StepInfo {
  step: number;
  nodes: string[];
  simStartMs: number;
  simEndMs: number;
}

export type RunStatus = "running" | "success" | "error" | "interrupted";

export interface RunTrace {
  runId: string;
  threadId?: string;
  status: RunStatus;
  input: unknown;
  spans: NodeSpan[];
  routes: RouteDecision[];
  steps: StepInfo[];
  finalState: GraphState;
  error?: NodeErrorInfo & { step?: number };
  interrupt?: InterruptInfo;
  checkpoints: Checkpoint[];
  totals: {
    simLatencyMs: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    costUsd: number;
    llmCalls: number;
    steps: number;
  };
}

export type EngineEvent =
  | { type: "run_start"; runId: string }
  | { type: "step_start"; step: number; nodes: string[]; state: GraphState }
  | { type: "node_start"; step: number; node: string }
  | { type: "node_end"; step: number; node: string; span: NodeSpan }
  | { type: "route"; decision: RouteDecision }
  | { type: "step_end"; step: number; state: GraphState; next: string[]; changedKeys: string[] }
  | { type: "interrupt"; info: InterruptInfo }
  | { type: "run_end"; trace: RunTrace };

export interface CommandResult {
  __command: true;
  update?: Partial<GraphState>;
  goto?: string | string[];
}

export function Command(opts: { update?: Partial<GraphState>; goto?: string | string[] }): CommandResult {
  return { __command: true, ...opts };
}

export interface NodeContext {
  step: number;
  node: string;
  /** Call a model through the experiment layer. Record the call with recordLLM. */
  llm: (req: LLMRequest) => Promise<LLMResponse>;
  recordLLM: (rec: LLMCallRecord) => void;
  /** Pause the graph (LangGraph `interrupt()`); returns the resume value when resumed. */
  interrupt: <T = unknown>(payload: unknown) => T;
  log: (msg: string) => void;
  /** add simulated latency (tools, IO) */
  addLatency: (ms: number) => void;
}

export type NodeReturn = Partial<GraphState> | CommandResult | void | null;

export interface NodeDef {
  name: string;
  label?: string;
  kind?: NodeKind;
  fn: (state: GraphState, ctx: NodeContext) => Promise<NodeReturn> | NodeReturn;
  /** LangGraph `defer=True`: wait until all other pending branches finish */
  defer?: boolean;
  /** LangGraph RetryPolicy(max_attempts=N) */
  retry?: { maxAttempts: number };
}

export interface ConditionalEdge {
  source: string;
  route: (state: GraphState) => string | string[];
  routerId?: string;
  label?: string;
  explain?: (state: GraphState, result: string[]) => string;
  targets: string[];
}

export interface GraphDefinition {
  schema: StateSchema;
  nodes: NodeDef[];
  edges: { source: string; target: string }[];
  conditionalEdges: ConditionalEdge[];
  /** add_edge(["a","b"], "c"): c runs once after ALL sources finished */
  joinEdges?: { sources: string[]; target: string }[];
}

export interface RunOptions {
  llm: LLMInvoker;
  threadId?: string;
  checkpointer?: import("./checkpointer").MemoryCheckpointer | null;
  recursionLimit?: number;
  /** resume an interrupted thread: Command(resume=value) */
  resume?: { value: unknown };
  /** replay / fork from a specific checkpoint (time travel) */
  fromCheckpointId?: string;
  onEvent?: (e: EngineEvent) => void;
  /** animation pacing: called with simulated duration of each node */
  pace?: (simMs: number) => Promise<void>;
  /** step-through mode: awaited before each super-step */
  gate?: (step: number, nodes: string[]) => Promise<void>;
  signal?: { aborted: boolean };
}
