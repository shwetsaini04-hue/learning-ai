export interface QuizOption {
  text: string;
  correct?: boolean;
  why: string;
}

export interface QuizQuestion {
  id: string;
  scenario: string;
  question: string;
  options: QuizOption[];
  multi?: boolean;
  takeaway: string;
}

export const ASSESSMENTS: Record<string, QuizQuestion[]> = {
  a1: [
    {
      id: "a1q1",
      scenario: "Your first prototype sends each transcript to a model with “What does the customer want?” and a product manager reads the answers. It looks great in the demo.",
      question: "What is the most important change before feeding results into a downstream lead-scoring model?",
      options: [
        { text: "Switch to the largest available model", why: "A bigger model still answers in free text your pipeline can't consume." },
        { text: "Define a schema (allowed labels + confidence), ask for it explicitly, and validate every response", correct: true, why: "Downstream code needs fields it can trust. Validation turns silent format drift into visible errors." },
        { text: "Increase temperature for more nuanced answers", why: "More randomness makes downstream processing harder, not easier." },
        { text: "Ask the PM to label more examples", why: "Useful later for evaluation, but it doesn't make outputs machine-readable." },
      ],
      takeaway: "LLM applications fail at the boundary between text and code. Structure + validation first.",
    },
    {
      id: "a1q2",
      scenario: "You need intent, product and sentiment for each call. These three analyses don't depend on each other.",
      question: "Which pattern fits best?",
      options: [
        { text: "An autonomous agent that decides which analyses to run", why: "The steps are known in advance — agent autonomy adds cost and unpredictability for no benefit." },
        { text: "A sequential chain: intent → product → sentiment", why: "Works, but latency is the sum of all three for no reason." },
        { text: "Parallel branches followed by a merge step", correct: true, why: "Independent work runs concurrently; latency ≈ the slowest branch." },
        { text: "A loop that repeats until all three are filled", why: "Nothing needs repeating here." },
      ],
      takeaway: "Pick the simplest pattern that matches the dependency structure of the work.",
    },
    {
      id: "a1q3",
      scenario: "A teammate proposes an agent for transcript classification “so it can decide how to handle each call”. The labels, fields and follow-up actions are fully specified by the business.",
      question: "What's your recommendation?",
      options: [
        { text: "Build the agent — it's more flexible", why: "Flexibility you don't need becomes behaviour you can't test." },
        { text: "Use a workflow with explicit routing; consider agent loops only for genuinely open-ended sub-tasks", correct: true, why: "When the path is known, a workflow is cheaper, faster, more predictable and easier to evaluate." },
        { text: "Avoid LLMs entirely", why: "LLMs are a good fit for understanding messy transcripts; the question is orchestration." },
        { text: "Use an agent but with temperature 0", why: "Temperature doesn't make an agent's control flow predictable or testable." },
      ],
      takeaway: "Workflows for known paths, agents for open-ended paths.",
    },
    {
      id: "a1q4",
      scenario: "Your intent prompt includes 3 few-shot examples and labeling guidelines, making it 900 tokens. Transcripts average 350 tokens.",
      question: "What's true about this design? (select all that apply)",
      multi: true,
      options: [
        { text: "Most of your input cost is instructions, not transcripts", correct: true, why: "900 of 1,250 input tokens are the fixed prompt." },
        { text: "Prompt caching could significantly reduce cost", correct: true, why: "A stable prefix repeated on every call is the ideal caching case." },
        { text: "Few-shot examples never improve accuracy", why: "They often help on hard cases — measure it." },
        { text: "You should measure whether removing the examples hurts quality before cutting them", correct: true, why: "That's a regression test: cheaper isn't better if hard-case accuracy collapses." },
      ],
      takeaway: "Every prompt token is paid on every call. Decide with measurements, not intuition.",
    },
    {
      id: "a1q5",
      scenario: "The same transcript sometimes returns “interested” and sometimes “unclear”.",
      question: "What is the FIRST thing to check?",
      options: [
        { text: "Whether temperature > 0 (sampling randomness)", correct: true, why: "For classification you usually want deterministic-ish decoding; check the setting before anything else." },
        { text: "Whether the provider is down", why: "Outages produce errors, not alternating labels." },
        { text: "Whether you need a bigger context window", why: "The transcript fits; this is about sampling." },
        { text: "Whether the labels should be renamed", why: "Possible later if the guideline is ambiguous, but check randomness first." },
      ],
      takeaway: "Inconsistency has two sources: randomness (settings) and ambiguity (task definition). Rule out the cheap one first.",
    },
  ],
  a2: [
    {
      id: "a2q1",
      scenario: "Your plain-Python pipeline has grown: retries when JSON is invalid, a branch for complaints, a pause for human review of low-confidence results, and the ability to resume after a crash.",
      question: "Which LangGraph features map to these needs? (select all that apply)",
      multi: true,
      options: [
        { text: "Cycles/loops for retries", correct: true, why: "An edge back to the classifier with a bounded exit." },
        { text: "Conditional edges for the complaint branch", correct: true, why: "Routing on state." },
        { text: "interrupt() + a checkpointer for human review and resume", correct: true, why: "Pausing requires persisted state and a thread_id." },
        { text: "Vector stores for retries", why: "Retrieval is unrelated to control flow." },
      ],
      takeaway: "LangGraph earns its place when you need state + control flow + persistence together.",
    },
    {
      id: "a2q2",
      scenario: "You only need: clean the transcript → one LLM call → save JSON. No branches, no pauses.",
      question: "Should you use LangGraph?",
      options: [
        { text: "Yes, always use LangGraph for LLM apps", why: "Framework overhead without benefit is still overhead." },
        { text: "Not necessarily — a simple function or chain is enough; adopt a graph when routing/loops/state/persistence appear", correct: true, why: "Choose the least machinery that meets the requirements." },
        { text: "No, LangGraph can't do single calls", why: "It can; it's just unnecessary here." },
        { text: "Yes, because it's faster", why: "Orchestration doesn't make the model faster." },
      ],
      takeaway: "Simple chain first. Graph when complexity is real.",
    },
    {
      id: "a2q3",
      scenario: "In a super-step, nodes A and B run in parallel. Both return {\"notes\": ...}. The `notes` key has no reducer.",
      question: "What happens?",
      options: [
        { text: "The last node to finish wins", why: "LangGraph refuses to guess which write should win." },
        { text: "InvalidUpdateError: the key can receive only one value per step", correct: true, why: "Without a reducer, concurrent writes to one key are an error." },
        { text: "Both values are appended automatically", why: "Only with an append reducer such as Annotated[list, operator.add]." },
        { text: "The graph silently drops both", why: "Silent data loss would be worse — it raises." },
      ],
      takeaway: "Super-steps + reducers are why parallel graphs are safe.",
    },
    {
      id: "a2q4",
      scenario: "A node returns {\"intent\": \"interested\"}. The state already has transcript, product and confidence.",
      question: "What does the state look like after the node?",
      options: [
        { text: "Only {\"intent\": \"interested\"}", why: "Nodes return partial updates; other keys are kept." },
        { text: "All previous keys, with intent updated", correct: true, why: "Updates are merged key by key through reducers (default: overwrite that key)." },
        { text: "It depends on the edge", why: "Edges decide what runs next, not how state merges." },
        { text: "The node must return the full state", why: "That's not required, and partial updates are the idiom." },
      ],
      takeaway: "Nodes return deltas; the graph owns the state.",
    },
    {
      id: "a2q5",
      scenario: "A low-confidence call is waiting for review. The reviewer answers two hours later — after the server restarted.",
      question: "What makes it possible to continue exactly where the run paused?",
      options: [
        { text: "An in-memory checkpointer", why: "In-memory state is lost on restart. Fine for demos, not production." },
        { text: "A durable checkpointer (e.g., Postgres) and the same thread_id when resuming", correct: true, why: "State was saved at the interrupt; resuming loads it by thread_id." },
        { text: "Re-running the whole graph from START", why: "That repeats all LLM calls (cost) and may produce different results." },
        { text: "Storing the transcript in a global variable", why: "Doesn't survive restarts or scale across workers." },
      ],
      takeaway: "Persistence is what turns a script into a resumable workflow.",
    },
  ],
  a3: [
    {
      id: "a3q1",
      scenario: "You're designing the State for the transcript pipeline. A retry loop increments `attempts`; three parallel nodes each add a string to `notes`.",
      question: "Which state definition is correct?",
      options: [
        { text: "attempts: int; notes: list[str]", why: "Both would be overwritten, and parallel writes to notes would raise InvalidUpdateError." },
        { text: "attempts: Annotated[int, operator.add]; notes: Annotated[list[str], operator.add]", correct: true, why: "Reducers make the counter accumulate and parallel notes append." },
        { text: "attempts: str; notes: dict", why: "Wrong types and still no reducers." },
        { text: "Use global variables for both", why: "Globals are invisible to checkpoints, traces and parallel branches." },
      ],
      takeaway: "Reducers encode how information accumulates.",
    },
    {
      id: "a3q2",
      scenario: "Your router function reads state[\"confidence\"], but on some calls the LLM node failed to parse and never set confidence.",
      question: "What's the most robust design?",
      options: [
        { text: "Wrap everything in try/except and route to END", why: "You'd silently drop calls." },
        { text: "Handle the missing case explicitly: route unparsed/None confidence to review (or a retry), and test the router with those states", correct: true, why: "Routers must cover every possible state, including failures." },
        { text: "Set confidence = 1.0 by default", why: "That auto-approves exactly the calls you know nothing about." },
        { text: "Raise the recursion limit", why: "Unrelated to routing on missing keys." },
      ],
      takeaway: "Routing functions are code: define behaviour for every state, then unit-test them.",
    },
    {
      id: "a3q3",
      scenario: "An LLM node fails with invalid JSON about 3% of the time. You add RetryPolicy(max_attempts=3) with temperature 0 and the same prompt.",
      question: "Why might this barely help?",
      options: [
        { text: "RetryPolicy doesn't work on LLM nodes", why: "It works on any node that raises." },
        { text: "Same deterministic input → same bad output; a retry should change something (e.g., feed back the error, or sample differently)", correct: true, why: "A repair prompt with the parse error is far more likely to succeed. Also check which exceptions your retry policy retries on." },
        { text: "Three attempts is too few", why: "Quantity doesn't fix a deterministic failure." },
        { text: "You need a checkpointer for retries", why: "Retries don't require persistence." },
      ],
      takeaway: "Retries fix transient failures. Deterministic failures need a different input.",
    },
    {
      id: "a3q4",
      scenario: "Three independent LLM calls take 0.8 s, 0.7 s and 0.9 s. You can run them sequentially or in parallel.",
      question: "Which statements are true? (select all that apply)",
      multi: true,
      options: [
        { text: "Parallel latency ≈ 0.9 s; sequential ≈ 2.4 s", correct: true, why: "Parallel = slowest branch; sequential = sum." },
        { text: "Parallel is cheaper", why: "You pay for the same three calls either way." },
        { text: "Parallel may hit rate limits sooner under load", correct: true, why: "Concurrency multiplies requests per second." },
        { text: "If one parallel branch has a slow tail, the whole step waits for it", correct: true, why: "The step's P95 is the P95 of a max()." },
      ],
      takeaway: "Parallelism trades concurrency pressure for latency; cost is unchanged.",
    },
    {
      id: "a3q5",
      scenario: "A human-review node sends a Slack notification and then calls interrupt(). Reviewers complain they get the notification twice.",
      question: "Why?",
      options: [
        { text: "Slack's API is duplicating messages", why: "The duplicate comes from your code running twice." },
        { text: "On resume, the interrupted node re-runs from its beginning, so code before interrupt() executes again", correct: true, why: "Move side effects after interrupt(), into a separate node, or make them idempotent." },
        { text: "The checkpointer saves every message twice", why: "Checkpointers save state, they don't send messages." },
        { text: "Two threads were created", why: "Same thread; the node itself re-runs." },
      ],
      takeaway: "interrupt() semantics: the node restarts on resume. Keep pre-interrupt code side-effect free.",
    },
  ],
  a4: [
    {
      id: "a4q1",
      scenario: "Calls must be classified within 2 seconds for a live agent-assist screen. Your pipeline: redact (5 ms) → 4 LLM analyses (~0.8 s each, sequential) → confidence gate.",
      question: "What's the best first change?",
      options: [
        { text: "Switch every node to the largest model", why: "Slower and more expensive." },
        { text: "Run the 4 independent analyses in parallel (or merge them into one well-structured call) and measure P95", correct: true, why: "Removes ~2.4 s of serialized waiting; then verify the tail latency." },
        { text: "Remove the redaction step", why: "It's 5 ms and it's a compliance control." },
        { text: "Add human review for every call", why: "Humans take minutes." },
      ],
      takeaway: "Architecture is the biggest latency lever.",
    },
    {
      id: "a4q2",
      scenario: "One single-call prompt extracts everything (intent, product, sentiment, next action). A multi-node graph does each separately.",
      question: "Which trade-offs are real? (select all that apply)",
      multi: true,
      options: [
        { text: "Single call: fewer input tokens overall (transcript sent once)", correct: true, why: "Multi-node sends the transcript to every node." },
        { text: "Multi-node: each prompt can be specialised, tested and versioned independently", correct: true, why: "Smaller, focused prompts are easier to debug and evaluate." },
        { text: "Multi-node is always more accurate", why: "Not always — measure it on your dataset." },
        { text: "Multi-node outputs can be mutually inconsistent (e.g., next_action vs intent)", correct: true, why: "Independent calls can disagree; you may need a consistency check." },
      ],
      takeaway: "No universally best architecture — only measured trade-offs.",
    },
    {
      id: "a4q3",
      scenario: "A node fails with “Invalid structured output: intent: \"Interested\" is not one of …”.",
      question: "What does the trace tell you, and what do you fix?",
      options: [
        { text: "The model is wrong; switch models", why: "The label is semantically right; the format is wrong." },
        { text: "The raw output uses the wrong casing — tighten the prompt (exact allowed values), use provider structured outputs, and/or normalise before validating", correct: true, why: "Read raw vs parsed output; fix the contract, not the vibe." },
        { text: "Disable validation", why: "You'd ship \"Interested\", \"interested \" and \"INTERESTED\" into your database." },
        { text: "Increase max_tokens", why: "The output isn't truncated." },
      ],
      takeaway: "Debug by comparing prompt → raw output → parsed output → state.",
    },
    {
      id: "a4q4",
      scenario: "No errors in production, but sales says too many 'interested' leads are junk.",
      question: "What's the most effective next step?",
      options: [
        { text: "Rewrite the prompt based on intuition", why: "You don't yet know WHICH errors occur." },
        { text: "Sample recent traces, label them, and look at the confusion matrix and failure slices (e.g., callbacks, sarcasm)", correct: true, why: "Error analysis tells you what to fix; then verify with a regression run." },
        { text: "Raise the confidence threshold to 0.99", why: "Might help precision but floods human review — decide with data." },
        { text: "Switch to an agent", why: "Doesn't address the labeling problem." },
      ],
      takeaway: "Silent quality bugs are found with evaluation, not exceptions.",
    },
    {
      id: "a4q5",
      scenario: "Your graph calls send_followup (sends a WhatsApp message) and later a human-review interrupt. After resume, customers occasionally get two messages.",
      question: "Best fix?",
      options: [
        { text: "Move human review before side effects, and make side-effecting nodes idempotent (e.g., dedupe key per thread)", correct: true, why: "Side effects after the decision point; idempotency for replays and retries." },
        { text: "Disable the checkpointer", why: "Then you can't resume at all." },
        { text: "Add a sleep", why: "Timing hacks don't fix re-execution semantics." },
        { text: "Use temperature 0", why: "Unrelated to duplicated side effects." },
      ],
      takeaway: "Durable workflows replay. Design side effects for it.",
    },
  ],
  b1: [
    {
      id: "b1q1",
      scenario: "The team tested a new prompt on 5 transcripts and all outputs “looked right”. They want to ship.",
      question: "What's wrong with this evaluation?",
      options: [
        { text: "Nothing — 5/5 is 100%", why: "With n = 5, the 95% interval on accuracy spans roughly 57%–100%." },
        { text: "Too few, unrepresentative examples judged by eye; no fixed dataset, no ground truth, no comparison to the old prompt", correct: true, why: "You need a labeled set that covers hard cases, a metric, and a baseline." },
        { text: "They should have used 5 different models", why: "The problem is the evaluation, not the model count." },
        { text: "They should have used temperature 1", why: "Irrelevant." },
      ],
      takeaway: "“Looks good” is a vibe, not a measurement.",
    },
    {
      id: "b1q2",
      scenario: "Two annotators label 100 calls. They agree on 70, and Cohen's κ = 0.45.",
      question: "What does this suggest?",
      options: [
        { text: "The annotators are careless", why: "Maybe, but moderate agreement usually signals an ambiguous task." },
        { text: "The labeling guidelines are ambiguous for some cases — clarify them before trusting model accuracy numbers", correct: true, why: "If humans disagree, a model can't reach 'truth'; your metric ceiling is fuzzy." },
        { text: "The model will score 70% at most", why: "Not a strict bound, but agreement does cap how meaningful accuracy is." },
        { text: "κ is irrelevant for classification", why: "It's exactly for categorical labels." },
      ],
      takeaway: "Measure human agreement before blaming the model.",
    },
    {
      id: "b1q3",
      scenario: "You're building an evaluation dataset for intent classification.",
      question: "Which choices make it better? (select all that apply)",
      multi: true,
      options: [
        { text: "Include hard slices on purpose (sarcasm, callbacks, noisy audio, Hinglish)", correct: true, why: "Averages over easy cases hide the failures that matter." },
        { text: "Tag examples so you can compute per-slice metrics", correct: true, why: "Tags enable error analysis." },
        { text: "Reuse the few-shot examples from the prompt as test cases", why: "That's testing on training data — inflated scores." },
        { text: "Keep the dataset fixed across prompt versions", correct: true, why: "Comparisons are only fair on the same data." },
      ],
      takeaway: "A good eval set is representative, hard where it matters, tagged and frozen.",
    },
    {
      id: "b1q4",
      scenario: "You must evaluate (a) intent labels and (b) free-text call summaries.",
      question: "Which evaluation approach fits each?",
      options: [
        { text: "Exact match for both", why: "Summaries paraphrase; exact match would call nearly everything wrong." },
        { text: "(a) deterministic metrics vs ground truth; (b) rubric-based human or validated LLM-judge grading, plus groundedness checks", correct: true, why: "Deterministic tasks get deterministic metrics; subjective outputs need rubrics." },
        { text: "LLM-judge for both", why: "Wasteful and noisier for labels you can compare exactly." },
        { text: "Human review of everything forever", why: "Doesn't scale; use humans to calibrate automated checks." },
      ],
      takeaway: "Match the metric to the output type.",
    },
    {
      id: "b1q5",
      scenario: "Accuracy on 40 examples went from 85% to 90% after a prompt change.",
      question: "How confident should you be that the new prompt is better?",
      options: [
        { text: "Very — 5 points is a lot", why: "On 40 examples that's 2 examples; intervals overlap heavily." },
        { text: "Not very — check per-example flips and use a larger/more targeted set before concluding", correct: true, why: "Small samples produce noisy estimates. Look at which examples changed." },
        { text: "Completely — accuracy never lies", why: "It can mislead on small or imbalanced sets." },
        { text: "Only if latency also improved", why: "Latency is a separate dimension." },
      ],
      takeaway: "Treat small-sample metrics as estimates with error bars.",
    },
  ],
  b2: [
    {
      id: "b2q1",
      scenario: "A lead-routing model has 94% accuracy. 90% of calls are 'not interested'.",
      question: "Why might 94% be unimpressive?",
      options: [
        { text: "Because accuracy above 90% is always suspicious", why: "High accuracy can be real." },
        { text: "A model that always predicts 'not interested' already gets 90%; check precision/recall for the class you care about", correct: true, why: "On imbalanced data, per-class metrics tell the real story." },
        { text: "Because it should be 100%", why: "Unrealistic for ambiguous calls." },
        { text: "Accuracy is only for regression tasks", why: "It's a classification metric." },
      ],
      takeaway: "Look at per-class precision/recall on imbalanced data.",
    },
    {
      id: "b2q2",
      scenario: "Sales has limited agents: every false 'interested' lead wastes 10 minutes. Missing a real lead costs a sale.",
      question: "How should this shape your metric choice?",
      options: [
        { text: "Optimize accuracy only", why: "Accuracy weighs all errors equally." },
        { text: "Look at precision and recall for 'interested' separately and set the confidence threshold based on the business cost of each error type", correct: true, why: "Metrics should reflect the cost of mistakes." },
        { text: "Only optimise recall", why: "You'd flood agents with junk leads." },
        { text: "Only optimise precision", why: "You'd silently lose customers." },
      ],
      takeaway: "Precision vs recall is a business decision.",
    },
    {
      id: "b2q3",
      scenario: "A summary says: “Customer is interested in a home loan. The agent confirmed a 10.25% rate.” No rate was said on the call.",
      question: "Which dimension fails?",
      options: [
        { text: "Relevance", why: "It is on-topic." },
        { text: "Groundedness / faithfulness (a hallucinated claim)", correct: true, why: "The claim isn't supported by the source transcript." },
        { text: "Completeness", why: "Completeness is about omissions, not inventions." },
        { text: "Schema validity", why: "The JSON may be perfectly valid." },
      ],
      takeaway: "Check every claim against the source.",
    },
    {
      id: "b2q4",
      scenario: "Running the same prompt 10 times at temperature 0.8 on a borderline call yields 6× 'unclear', 4× 'interested'.",
      question: "What does that tell you? (select all that apply)",
      multi: true,
      options: [
        { text: "The call is genuinely borderline for this model/prompt", correct: true, why: "Disagreement across samples is a useful uncertainty signal." },
        { text: "Single-run evaluation at this temperature is noisy", correct: true, why: "Measure over multiple samples or lower the temperature." },
        { text: "The model is broken", why: "Variation at high temperature is expected behaviour." },
        { text: "Self-consistency (majority vote over samples) could be used, at extra cost", correct: true, why: "More calls → more stable answers and a confidence estimate." },
      ],
      takeaway: "Consistency is measurable, and it's a signal.",
    },
    {
      id: "b2q5",
      scenario: "Your model returns confidence 0.9 on almost everything, including many wrong answers.",
      question: "What's the implication for a 'review if confidence < 0.7' policy?",
      options: [
        { text: "The policy works fine", why: "Almost nothing will be reviewed, including wrong answers." },
        { text: "Confidence is poorly calibrated, so the threshold won't catch errors — calibrate/validate confidence or use other signals", correct: true, why: "Routing on confidence only works if confidence tracks correctness." },
        { text: "Lower the threshold to 0.5", why: "That reviews even less." },
        { text: "Confidence scores are always meaningless", why: "They can be useful; validate them." },
      ],
      takeaway: "Validate the signals you route on.",
    },
  ],
  b3: [
    {
      id: "b3q1",
      scenario: "Reference: “Customer is interested in a personal loan.” Output: “The customer wants to know more about getting a personal loan.”",
      question: "Which metric gives the most sensible result?",
      options: [
        { text: "Exact match → 0", why: "Technically true, practically useless for paraphrases." },
        { text: "Semantic similarity (embeddings) or a rubric-based judge", correct: true, why: "Both capture meaning rather than surface form." },
        { text: "Character count ratio", why: "Length says nothing about meaning." },
        { text: "BLEU with one reference", why: "N-gram overlap is weak for short paraphrases." },
      ],
      takeaway: "Pick metrics that match how the output can legitimately vary.",
    },
    {
      id: "b3q2",
      scenario: "Your LLM judge gives higher scores to longer answers, even when they contain an unsupported claim.",
      question: "What should you do?",
      options: [
        { text: "Trust the judge — it's a strong model", why: "Verbosity bias is a known judge failure." },
        { text: "Add explicit rubric criteria (penalise unsupported claims, don't reward length), then validate judge scores against human scores", correct: true, why: "The judge is a model; evaluate it like one." },
        { text: "Ask the judge to be nicer", why: "The issue is bias, not tone." },
        { text: "Use the judge only on long answers", why: "That doubles down on the bias." },
      ],
      takeaway: "Validate the evaluator.",
    },
    {
      id: "b3q3",
      scenario: "Prompt V4 is 60% cheaper than V3 and overall accuracy only dropped 1 point.",
      question: "What else must you check before switching?",
      options: [
        { text: "Nothing — 1 point is noise", why: "Averages can hide concentrated breakage." },
        { text: "Per-example regressions and per-slice accuracy (e.g., sarcasm, callbacks), plus invalid-output rate", correct: true, why: "V4 may have broken a slice that matters a lot." },
        { text: "Whether V4 is shorter", why: "You already know it's cheaper." },
        { text: "The model's name", why: "Irrelevant to the regression." },
      ],
      takeaway: "Compare per example and per slice, not just the mean.",
    },
    {
      id: "b3q4",
      scenario: "You use the same model family as both the system under test and the judge.",
      question: "What risk should you consider?",
      options: [
        { text: "Self-preference bias: the judge may favour outputs in its own style", correct: true, why: "Known risk; mitigate with a different judge model, rubrics and human calibration." },
        { text: "The judge will crash", why: "No technical issue." },
        { text: "It's always cheaper, so no risk", why: "Cost isn't the risk here." },
        { text: "Judges can't grade classification", why: "They can, though you rarely need one for labels." },
      ],
      takeaway: "Judges have biases: position, verbosity, self-preference.",
    },
    {
      id: "b3q5",
      scenario: "You've collected 200 human corrections from the review queue in the Transcript Lab.",
      question: "What's their best use?",
      options: [
        { text: "Throw them away after review", why: "They're the most valuable labeled data you have." },
        { text: "Add them (tagged) to the evaluation dataset as hard cases and use them in regression tests", correct: true, why: "Production failures make the best test cases." },
        { text: "Paste them all into the prompt as few-shot examples", why: "Huge prompts cost more and you lose your test set." },
        { text: "Use them only to compute review rate", why: "That wastes their label value." },
      ],
      takeaway: "Human feedback → dataset → regression tests: the improvement loop.",
    },
  ],
  b4: [
    {
      id: "b4q1",
      scenario: "Monthly cost is $4,000. Breakdown per call: 1,100 input tokens (900 are fixed instructions), 30 output tokens.",
      question: "Which levers help most? (select all that apply)",
      multi: true,
      options: [
        { text: "Prompt caching for the fixed instructions", correct: true, why: "The stable prefix dominates input tokens." },
        { text: "Batch processing if results aren't needed in real time", correct: true, why: "Batch APIs are often ~50% cheaper." },
        { text: "Shortening outputs from 30 to 20 tokens", why: "Output is a small share of cost here." },
        { text: "Testing a smaller model on the eval set", correct: true, why: "Could cut price per token a lot — if quality holds." },
      ],
      takeaway: "Find where the tokens are before optimising.",
    },
    {
      id: "b4q2",
      scenario: "Average latency is 900 ms, but agents complain the screen sometimes takes 4 seconds.",
      question: "Which metric should you monitor and set SLAs on?",
      options: [
        { text: "Mean latency", why: "The mean hides the tail users feel." },
        { text: "P95/P99 latency", correct: true, why: "Percentiles capture the slow requests." },
        { text: "Minimum latency", why: "Best case is irrelevant." },
        { text: "Tokens per second", why: "Useful diagnostic, not the user-facing SLA." },
      ],
      takeaway: "SLAs live on percentiles.",
    },
    {
      id: "b4q3",
      scenario: "A provider silently updates the model behind an alias. Your invalid-output rate goes from 0.5% to 4%.",
      question: "What would have caught this fastest?",
      options: [
        { text: "Monitoring invalid-output rate (and quality samples) in production, with alerts", correct: true, why: "Observability detects drift; pinning model versions reduces the risk." },
        { text: "A bigger unit test suite for the UI", why: "UI tests don't see model behaviour." },
        { text: "Increasing max_tokens", why: "Unrelated." },
        { text: "Nothing can catch this", why: "It's detectable with the right metrics." },
      ],
      takeaway: "Monitor model-facing metrics, pin versions, re-run evals on change.",
    },
    {
      id: "b4q4",
      scenario: "You want to debug why call #2931 was misrouted last Tuesday.",
      question: "What do you need to have recorded?",
      options: [
        { text: "Only the final label", why: "You can't tell where it went wrong." },
        { text: "A trace: each node's inputs, prompt (version), raw output, parsed output, state changes, route decisions, tokens and latency", correct: true, why: "Traces make runs reproducible and explainable." },
        { text: "The model's weights", why: "You don't have them for hosted models, and don't need them." },
        { text: "Only the error logs", why: "Silent misroutes produce no errors." },
      ],
      takeaway: "If it isn't traced, it didn't happen (as far as debugging goes).",
    },
    {
      id: "b4q5",
      scenario: "Leadership asks: “Which model is the best?”",
      question: "What's the engineering answer?",
      options: [
        { text: "The one with the highest benchmark score", why: "Public benchmarks aren't your transcripts." },
        { text: "It depends on the constraints: quality on OUR eval set, cost per 1K calls, P95 latency, reliability — choose the cheapest option that meets the requirements", correct: true, why: "Model choice is a constrained trade-off, measured on your data." },
        { text: "The newest one", why: "Newer isn't always better for your task or budget." },
        { text: "The cheapest one", why: "Only if it meets quality requirements." },
      ],
      takeaway: "Quality ↔ cost ↔ latency ↔ reliability — decide with your own measurements.",
    },
  ],
};
