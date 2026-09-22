export const CAPSTONE_BRIEF = {
  company: "FinServe Bank — outbound & inbound sales calls",
  volume: "≈ 20,000 call transcripts per day (speech-to-text output, English + Hinglish)",
  goal: "Turn every call into a structured lead record: intent, product, sentiment, requested info, next action — feeding a lead-scoring model and the sales team's CRM.",
  constraints: [
    "Compliance: customers read out phone numbers and PAN; no PII may reach an external model or its logs.",
    "Quality: false 'interested' leads waste agent time; missed leads lose revenue. Complaints must never be auto-closed.",
    "Human reviewers exist (≈ 8 people) but can only handle a fraction of calls.",
    "Budget: target ≤ $2 per 1,000 calls in LLM cost (simulated prices).",
    "Results are needed within minutes for the dashboard, not in real time.",
    "The prompt and model will change over time; regressions must be caught before release.",
  ],
};

export interface DesignQuestion {
  id: string;
  question: string;
  multi?: boolean;
  options: { text: string; correct?: boolean; feedback: string }[];
  weight: number;
}

export const DESIGN_QUESTIONS: DesignQuestion[] = [
  {
    id: "arch",
    question: "Overall architecture?",
    weight: 2,
    options: [
      { text: "One big prompt called from a script", feedback: "Can extract fields, but can't pause for reviewers, guarantee redaction order, retry safely or resume." },
      { text: "A LangGraph workflow: fixed steps + conditional routing + human-in-the-loop with persistence", correct: true, feedback: "Known steps with decisions and pauses: exactly what a graph workflow is for." },
      { text: "An autonomous agent that decides what to do with each call", feedback: "The steps are known; an agent adds cost, variance and testing difficulty for no benefit." },
    ],
  },
  {
    id: "chain",
    question: "Where is a plain, fixed chain (no routing) sufficient?",
    multi: true,
    weight: 1,
    options: [
      { text: "Redact PII → clean transcript", correct: true, feedback: "Always the same order, no decisions." },
      { text: "Formatting the final CRM record", correct: true, feedback: "Deterministic assembly of fields." },
      { text: "Deciding whether a call needs human review", feedback: "That's a decision — a conditional edge." },
      { text: "Retrying when the output is invalid", feedback: "Needs a loop with an exit condition." },
    ],
  },
  {
    id: "hitl",
    question: "What should send a call to human review?",
    multi: true,
    weight: 2,
    options: [
      { text: "Model confidence below a calibrated threshold", correct: true, feedback: "The core trigger — only if confidence is validated as meaningful." },
      { text: "A complaint is detected", correct: true, feedback: "High stakes: never auto-close a complaint." },
      { text: "Output still invalid after bounded retries", correct: true, feedback: "Graceful degradation instead of dropping the call." },
      { text: "Every call", feedback: "Reviewers can't scale to 20K calls/day; it defeats the purpose." },
      { text: "High-value leads (e.g. home loans above a threshold)", correct: true, feedback: "Reasonable business rule: spend attention where value is highest." },
    ],
  },
  {
    id: "state",
    question: "Which keys belong in the graph state?",
    multi: true,
    weight: 1,
    options: [
      { text: "cleaned (redacted) transcript", correct: true, feedback: "Needed by every analysis node." },
      { text: "intent, product, confidence", correct: true, feedback: "Outputs that routing and the final record depend on." },
      { text: "review_status and reviewer corrections", correct: true, feedback: "Audit trail and future evaluation data." },
      { text: "attempts counter (with an add reducer)", correct: true, feedback: "Bounds retry loops." },
      { text: "prompt/model version used", correct: true, feedback: "Makes every result attributable for regression analysis." },
      { text: "The customer's PAN number, for convenience", feedback: "State is checkpointed and often traced — never store raw PII there." },
      { text: "The raw call audio bytes", feedback: "Store a reference (URL/id), not large blobs." },
    ],
  },
  {
    id: "metrics",
    question: "Which metrics should the evaluation report?",
    multi: true,
    weight: 2,
    options: [
      { text: "Per-class precision/recall/F1 (esp. 'interested') and a confusion matrix", correct: true, feedback: "Tells you the business cost of errors and which mistakes happen." },
      { text: "Invalid-output rate", correct: true, feedback: "Reliability of the structured contract." },
      { text: "Human review rate", correct: true, feedback: "Your main operational cost driver besides tokens." },
      { text: "Cost per 1K calls and P95 latency", correct: true, feedback: "Operational constraints from the brief." },
      { text: "Accuracy per slice (sarcasm, callbacks, Hinglish, noisy ASR)", correct: true, feedback: "Averages hide the slices that matter." },
      { text: "BLEU score of the intent label", feedback: "BLEU is for translation-style text overlap, not labels." },
    ],
  },
  {
    id: "regress",
    question: "How will you detect regressions when the prompt or model changes?",
    weight: 2,
    options: [
      { text: "Re-run a frozen, tagged dataset on every change; diff per example vs the baseline; block on slice regressions", correct: true, feedback: "That's regression testing." },
      { text: "Spot-check five outputs after each change", feedback: "A vibe check — misses concentrated slice damage." },
      { text: "Wait for complaints from the sales team", feedback: "Too late, and silent failures never produce complaints." },
      { text: "Read the provider's changelog", feedback: "Useful context, not a test of YOUR task." },
    ],
  },
  {
    id: "cost",
    question: "How will you measure cost?",
    weight: 1,
    options: [
      { text: "Log token usage per LLM call × a versioned price table, aggregated per node, prompt version and day", correct: true, feedback: "Attributable, forecastable, comparable across versions." },
      { text: "Look at the monthly invoice", feedback: "Too coarse and too late to guide design choices." },
      { text: "Count API calls", feedback: "Calls vary hugely in tokens (transcript length, reasoning)." },
    ],
  },
  {
    id: "latency",
    question: "How will you measure latency?",
    weight: 1,
    options: [
      { text: "Trace spans per node; report P50/P95/P99 end-to-end and per node", correct: true, feedback: "Percentiles over real traffic, attributable to nodes." },
      { text: "Average of five manual runs", feedback: "Averages hide the tail; five runs is noise." },
      { text: "Use the provider's advertised tokens/sec", feedback: "Ignores your prompts, network, queueing and architecture." },
    ],
  },
];

export const JUSTIFICATION_RUBRIC: { concept: string; patterns: RegExp; tip: string }[] = [
  { concept: "PII redaction before the model", patterns: /redact|pii|mask|privacy|compliance/i, tip: "Mention where PII is removed and why it must happen before any model call." },
  { concept: "Parallelism / latency", patterns: /parallel|concurren|latency|p95/i, tip: "Explain which steps run in parallel and the latency effect." },
  { concept: "Confidence-based routing & human review", patterns: /confiden|threshold|review|human|interrupt/i, tip: "Say how and when calls reach a reviewer." },
  { concept: "Structured output & validation", patterns: /schema|json|structured|validat|pydantic/i, tip: "Say how outputs are validated and what happens when they're invalid." },
  { concept: "Persistence / resumability", patterns: /checkpoint|persist|resume|thread/i, tip: "Explain why reviews need a checkpointer." },
  { concept: "Evaluation & regression", patterns: /dataset|eval|regress|f1|recall|precision|baseline/i, tip: "Describe how quality is measured and protected over time." },
  { concept: "Cost", patterns: /cost|token|budget|cheap|price|\$/i, tip: "Connect design choices to cost per 1K calls." },
];

export const CAPSTONE_TARGETS = {
  systemAccuracy: 0.9,
  maxReviewRate: 0.35,
  maxCostPer1k: 2,
};
