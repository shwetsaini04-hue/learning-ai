export type TrackId = "langgraph" | "evaluation";

export interface LessonMeta {
  id: string;
  track: TrackId;
  module: string;
  title: string;
  summary: string;
  minutes: number;
  /** key concepts, shown as chips */
  concepts: string[];
}

export interface ModuleMeta {
  id: string;
  track: TrackId;
  number: string;
  title: string;
  summary: string;
  lessons: string[];
  exercises: string[];
}

export interface TrackMeta {
  id: TrackId;
  title: string;
  short: string;
  tagline: string;
  modules: string[];
}

export const TRACKS: TrackMeta[] = [
  {
    id: "langgraph",
    title: "LangGraph & LLM Workflows",
    short: "LangGraph",
    tagline: "From a single prompt to stateful, routed, human-in-the-loop transcript pipelines.",
    modules: ["a1", "a2", "a3", "a4"],
  },
  {
    id: "evaluation",
    title: "LLM Evaluation & Observability",
    short: "Evaluation",
    tagline: "Measure quality, cost, latency and reliability — and catch regressions before users do.",
    modules: ["b1", "b2", "b3", "b4"],
  },
];

export const MODULES: ModuleMeta[] = [
  {
    id: "a1",
    track: "langgraph",
    number: "A1",
    title: "Understanding LLM applications",
    summary: "Prompt → model → output, structured outputs, and the core workflow patterns.",
    lessons: ["a1-llm-apps", "a1-structured-output", "a1-patterns"],
    exercises: ["ex-first-chain"],
  },
  {
    id: "a2",
    track: "langgraph",
    number: "A2",
    title: "Why LangGraph exists",
    summary: "The problems graphs solve: state, routing, loops, persistence, human review.",
    lessons: ["a2-why-langgraph", "a2-mental-model"],
    exercises: [],
  },
  {
    id: "a3",
    track: "langgraph",
    number: "A3",
    title: "LangGraph fundamentals",
    summary: "State & reducers, nodes & edges, routing, loops, parallelism, persistence, interrupts, agents.",
    lessons: ["a3-state", "a3-nodes-edges", "a3-routing", "a3-loops", "a3-parallel", "a3-persistence", "a3-hitl", "a3-agents"],
    exercises: ["ex-code-state", "ex-parallel", "ex-retry-loop"],
  },
  {
    id: "a4",
    track: "langgraph",
    number: "A4",
    title: "Building & debugging workflows",
    summary: "Climb the workflow ladder and learn to debug real failures.",
    lessons: ["a4-ladder", "a4-debugging"],
    exercises: ["ex-sentiment-review", "ex-intent-routing", "ex-code-hitl"],
  },
  {
    id: "b1",
    track: "evaluation",
    number: "B1",
    title: "Evaluation fundamentals",
    summary: "Why 'looks good' fails, ground truth, datasets, rubrics, human vs automated evaluation.",
    lessons: ["b1-why-eval", "b1-ground-truth"],
    exercises: ["ex-annotate"],
  },
  {
    id: "b2",
    track: "evaluation",
    number: "B2",
    title: "Evaluation dimensions",
    summary: "Correctness, relevance, groundedness, hallucination, validity, consistency, classification metrics.",
    lessons: ["b2-correctness-relevance", "b2-groundedness", "b2-structured-consistency", "b2-classification-metrics"],
    exercises: ["ex-prf-by-hand"],
  },
  {
    id: "b3",
    track: "evaluation",
    number: "B3",
    title: "Evaluation methods",
    summary: "Exact vs semantic matching, LLM-as-a-judge, datasets and regression testing.",
    lessons: ["b3-exact-semantic", "b3-llm-judge", "b3-regression"],
    exercises: ["ex-judge-calibration", "ex-regression"],
  },
  {
    id: "b4",
    track: "evaluation",
    number: "B4",
    title: "Production: cost, latency & observability",
    summary: "Token economics, latency percentiles, tracing, monitoring and the improvement loop.",
    lessons: ["b4-cost", "b4-latency", "b4-observability", "b4-production-loop"],
    exercises: ["ex-cost-estimate", "ex-latency-sla"],
  },
];

export const LESSONS: LessonMeta[] = [
  // ---- A1
  { id: "a1-llm-apps", track: "langgraph", module: "a1", title: "What is an LLM application?", summary: "Prompt → LLM → output. Tokens, temperature, and why one prompt eventually isn't enough.", minutes: 8, concepts: ["Prompt", "Token", "Temperature", "Latency"] },
  { id: "a1-structured-output", track: "langgraph", module: "a1", title: "Structured outputs", summary: "Turning free text into validated JSON your code can trust.", minutes: 8, concepts: ["Schema", "Parsing", "Validation"] },
  { id: "a1-patterns", track: "langgraph", module: "a1", title: "Workflow patterns vs agents", summary: "Chains, routing, parallelism, loops, state, memory, tools, human-in-the-loop.", minutes: 10, concepts: ["Chain", "Router", "Agent", "Tool"] },
  // ---- A2
  { id: "a2-why-langgraph", track: "langgraph", module: "a2", title: "Why LangGraph exists", summary: "Watch a simple script turn into spaghetti — and what a graph gives you instead.", minutes: 8, concepts: ["Orchestration", "State", "Persistence"] },
  { id: "a2-mental-model", track: "langgraph", module: "a2", title: "The graph mental model", summary: "Nodes, edges, conditional edges, state and super-steps — stepped through live.", minutes: 10, concepts: ["Node", "Edge", "Super-step", "Checkpoint"] },
  // ---- A3
  { id: "a3-state", track: "langgraph", module: "a3", title: "State & reducers", summary: "The information moving through the graph, and how updates are merged.", minutes: 10, concepts: ["State", "Reducer", "TypedDict"] },
  { id: "a3-nodes-edges", track: "langgraph", module: "a3", title: "Nodes, edges, START & END", summary: "add_node, add_edge, compile, invoke — the building blocks.", minutes: 8, concepts: ["Node", "Edge", "compile()"] },
  { id: "a3-routing", track: "langgraph", module: "a3", title: "Conditional routing", summary: "add_conditional_edges and Command: let state decide what runs next.", minutes: 8, concepts: ["Conditional edge", "Router", "Command"] },
  { id: "a3-loops", track: "langgraph", module: "a3", title: "Loops, retries & limits", summary: "Validate-and-retry loops, RetryPolicy and recursion_limit.", minutes: 9, concepts: ["Cycle", "RetryPolicy", "recursion_limit"] },
  { id: "a3-parallel", track: "langgraph", module: "a3", title: "Parallel branches & Send", summary: "Fan-out/fan-in, super-steps, reducers for concurrent writes, map-reduce with Send.", minutes: 10, concepts: ["Fan-out", "Send", "defer"] },
  { id: "a3-persistence", track: "langgraph", module: "a3", title: "Persistence & time travel", summary: "Checkpointers, threads, get_state, history, replay and forks.", minutes: 9, concepts: ["Checkpointer", "Thread", "Time travel"] },
  { id: "a3-hitl", track: "langgraph", module: "a3", title: "Human-in-the-loop", summary: "interrupt() and Command(resume=...) — pause for a human, then continue.", minutes: 9, concepts: ["interrupt", "Command(resume)"] },
  { id: "a3-agents", track: "langgraph", module: "a3", title: "Tools & agents", summary: "Tool calling, the agent loop, create_agent — and when NOT to build an agent.", minutes: 10, concepts: ["Tool calling", "ReAct loop", "create_agent"] },
  // ---- A4
  { id: "a4-ladder", track: "langgraph", module: "a4", title: "The workflow ladder", summary: "Eight runnable workflows, from simple chain to agentic — pick the lowest rung that works.", minutes: 12, concepts: ["Architecture", "Trade-offs"] },
  { id: "a4-debugging", track: "langgraph", module: "a4", title: "Debugging LLM workflows", summary: "Read traces like an engineer: inputs, prompts, raw outputs, parsed outputs, state diffs.", minutes: 10, concepts: ["Trace", "Error analysis"] },
  // ---- B1
  { id: "b1-why-eval", track: "evaluation", module: "b1", title: "Why evaluating LLMs is hard", summary: "Why 'it looks good' is not a strategy, and what to do instead.", minutes: 8, concepts: ["Vibe check", "Test set", "Deterministic vs subjective"] },
  { id: "b1-ground-truth", track: "evaluation", module: "b1", title: "Ground truth, datasets & rubrics", summary: "Label data yourself, measure annotator agreement, write guidelines.", minutes: 10, concepts: ["Ground truth", "Rubric", "Cohen's κ"] },
  // ---- B2
  { id: "b2-correctness-relevance", track: "evaluation", module: "b2", title: "Correctness, relevance & completeness", summary: "Three different questions you can ask about one answer.", minutes: 8, concepts: ["Correctness", "Relevance", "Completeness"] },
  { id: "b2-groundedness", track: "evaluation", module: "b2", title: "Groundedness & hallucination", summary: "Is every claim supported by the transcript? Check claim by claim.", minutes: 9, concepts: ["Faithfulness", "Hallucination"] },
  { id: "b2-structured-consistency", track: "evaluation", module: "b2", title: "Validity & consistency", summary: "Does it follow the schema? Does it give the same answer twice?", minutes: 9, concepts: ["Schema validity", "Consistency", "Temperature"] },
  { id: "b2-classification-metrics", track: "evaluation", module: "b2", title: "Precision, recall, F1 & confusion matrices", summary: "The metrics that matter for transcript classification.", minutes: 12, concepts: ["Precision", "Recall", "F1", "Confusion matrix"] },
  // ---- B3
  { id: "b3-exact-semantic", track: "evaluation", module: "b3", title: "Exact match vs semantic similarity", summary: "Why exact match fails on paraphrases — and why similarity can fool you too.", minutes: 8, concepts: ["Exact match", "Token F1", "Embeddings"] },
  { id: "b3-llm-judge", track: "evaluation", module: "b3", title: "LLM-as-a-judge", summary: "Rubrics, judge prompts, biases, and validating the judge against humans.", minutes: 12, concepts: ["Judge", "Rubric", "Bias"] },
  { id: "b3-regression", track: "evaluation", module: "b3", title: "Datasets & regression testing", summary: "Prompt versions, baselines, and finding what broke.", minutes: 10, concepts: ["Regression", "Prompt versioning", "Baseline"] },
  // ---- B4
  { id: "b4-cost", track: "evaluation", module: "b4", title: "Cost: token economics", summary: "Where the money goes: input, output, reasoning tokens, caching, batching.", minutes: 8, concepts: ["Token", "Pricing", "Caching"] },
  { id: "b4-latency", track: "evaluation", module: "b4", title: "Latency: TTFT, P50, P95", summary: "Why averages lie and how architecture shapes latency.", minutes: 9, concepts: ["TTFT", "P95", "Tail latency"] },
  { id: "b4-observability", track: "evaluation", module: "b4", title: "Tracing & observability", summary: "Traces, spans, logs, metrics and human feedback in production.", minutes: 9, concepts: ["Trace", "Span", "Monitoring"] },
  { id: "b4-production-loop", track: "evaluation", module: "b4", title: "The production improvement loop", summary: "How datasets, evals, tracing and feedback fit together.", minutes: 8, concepts: ["LLMOps", "Feedback loop"] },
];

export function getLesson(id: string) {
  return LESSONS.find((l) => l.id === id);
}
export function getModule(id: string) {
  return MODULES.find((m) => m.id === id);
}
export function getTrack(id: string) {
  return TRACKS.find((t) => t.id === id);
}
export function lessonNeighbors(id: string) {
  const l = getLesson(id);
  if (!l) return { prev: undefined, next: undefined };
  const inTrack = LESSONS.filter((x) => x.track === l.track);
  const i = inTrack.findIndex((x) => x.id === id);
  return { prev: inTrack[i - 1], next: inTrack[i + 1] };
}
export function quizIdFor(moduleId: string) {
  return `quiz-${moduleId}`;
}
