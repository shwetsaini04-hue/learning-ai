"use client";

import { useMemo, useState } from "react";
import { FlowDiagram } from "@/components/graph/FlowDiagram";
import { CodeBlock, Exercise, LessonShell, QuickCheck, Steps, Term, TryIt, WhyCard } from "@/components/learn/Learn";
import { JsonBlock } from "@/components/learn/JsonView";
import { Badge, Callout, Card, Pill, Segmented, TextArea } from "@/components/ui";
import { parseStructured, schemaToTypeString } from "@/lib/ai/schema";
import { TASKS } from "@/lib/ai/tasks";
import { cn } from "@/lib/utils";
import type { WorkflowSpec } from "@/lib/workflows/spec";
import { edge, endNode, getTemplate, llmNode, routerNode, startNode, toolNode } from "@/lib/workflows/templates";
import { PromptPlayground } from "./widgets/PromptPlayground";

// ================================================================ A1.1
export default function LLMApps() {
  return (
    <LessonShell id="a1-llm-apps">
      <Steps items={["Concept", "Visual", "Experiment", "Code", "Why it breaks"]} />
      <p>
        An <strong>LLM application</strong> is ordinary software that, at some point, sends text to a language model and does something useful with what comes back. For transcript
        analysis the “something useful” is usually: turn a messy conversation into <strong>fields your systems can use</strong> — intent, product, next action.
      </p>

      <FlowDiagram
        spec={{
          id: "llm-app",
          name: "LLM app",
          nodes: [
            { id: "start", kind: "start", label: "START", x: 0, y: 0 },
            { id: "prompt", kind: "function", label: "Build prompt", x: 200, y: 0 },
            { id: "llm", kind: "llm", label: "LLM call", x: 400, y: 0 },
            { id: "parse", kind: "function", label: "Parse output", x: 600, y: 0 },
            { id: "end", kind: "end", label: "END", x: 800, y: 0 },
          ],
          edges: [edge("start", "prompt"), edge("prompt", "llm"), edge("llm", "parse"), edge("parse", "end")],
        }}
        maxHeight={140}
        subtitles={{ prompt: "template + transcript", llm: "tokens in → tokens out", parse: "text → JSON → your DB" }}
      />

      <h2>Prompt → LLM → Output</h2>
      <p>
        The model never sees your “intent”. It sees a <Term>Prompt</Term> — instructions plus the transcript — split into <Term>Token</Term>s. It returns tokens, which
        become text. Everything else (labels, JSON, routing) is your code. Try the three prompt versions below on the same call and watch what changes: the output format, the number of
        input tokens, the cost. Then set <Term>Temperature</Term> above 0 and press <em>Run 8×</em>.
      </p>
      <PromptPlayground task="classify_intent" defaultVersion="v1" />

      <Callout kind="tip" title="What you should notice">
        V1 answers in a friendly sentence — great for a human, useless for a database. V2 adds labels and asks for JSON. V3 adds guidelines and examples: more input tokens (more cost), better
        answers on tricky calls. Nothing about the model changed — only the prompt.
      </Callout>

      <WhyCard
        what={<>A program that calls a language model as one step inside a larger process.</>}
        why={<>LLMs understand unstructured language (calls, emails) far better than rules — but only software makes that understanding reliable and useful.</>}
        when={<>Messy human language in, structured decisions out: classifying calls, extracting fields, summarizing for the CRM.</>}
        whenNot={<>When a regex, lookup table or classical ML model already solves it reliably — cheaper, faster and fully deterministic.</>}
        how={<>Prompt template + input → API call → raw text → parse &amp; validate → use in code. Each step can fail independently.</>}
        real={<>A bank processes 20,000 sales calls a day: each transcript becomes {"{intent, product, next_action}"} that a lead-scoring model and the sales team use.</>}
      />

      <h2>The smallest real version</h2>
      <p>The same thing in Python. The LangChain version uses a provider-agnostic model interface; the SDK tabs show what happens underneath.</p>
      <CodeBlock
        verified
        tabs={[
          {
            label: "LangChain",
            code: `from langchain.chat_models import init_chat_model

model = init_chat_model("openai:gpt-5.4-mini")      # or "anthropic:claude-haiku-4-5"

transcript = """Agent: Good morning. How can I help you?
Customer: I am calling regarding a personal loan.
Agent: Are you interested in applying?
Customer: Yes, but I want to compare the interest rates first."""

response = model.invoke([
    {"role": "system", "content": "You analyze bank call transcripts."},
    {"role": "user", "content": f"What is the customer's intent?\\n\\n{transcript}"},
])
print(response.content)          # free text — a human can read it, your code can't
print(response.usage_metadata)   # {'input_tokens': ..., 'output_tokens': ..., 'total_tokens': ...}`,
          },
          {
            label: "Anthropic SDK",
            code: `from anthropic import Anthropic

client = Anthropic()  # reads ANTHROPIC_API_KEY from the environment — never hardcode keys

msg = client.messages.create(
    model="claude-opus-5",
    max_tokens=1024,
    output_config={"effort": "low"},   # simple classification: keep (billed) thinking small
    system="You analyze bank call transcripts.",
    messages=[{"role": "user", "content": f"What is the customer's intent?\\n\\n{transcript}"}],
)
text = next(b.text for b in msg.content if b.type == "text")
print(text, msg.usage.input_tokens, msg.usage.output_tokens)`,
          },
          {
            label: "OpenAI SDK",
            code: `from openai import OpenAI

client = OpenAI()  # reads OPENAI_API_KEY

resp = client.responses.create(
    model="gpt-5.4-mini",
    instructions="You analyze bank call transcripts.",
    input=f"What is the customer's intent?\\n\\n{transcript}",
)
print(resp.output_text, resp.usage.input_tokens, resp.usage.output_tokens)`,
          },
        ]}
      />

      <h2>Why a single prompt eventually isn't enough</h2>
      <p>The first version always looks great in a demo. Then production asks for more:</p>
      <div className="my-4 grid gap-2 sm:grid-cols-2">
        {[
          ["Format", "Downstream code needs JSON with fixed labels — not prose."],
          ["Validation", "Some outputs will be malformed. Retry? Fail? Flag?"],
          ["Several steps", "Redact PII → classify → extract → summarize, each with its own prompt."],
          ["Branching", "Complaints go to a different team; unclear calls get a callback."],
          ["Confidence", "Low-confidence predictions should be checked by a person."],
          ["Cost & latency", "20,000 calls/day × tokens × price — and agents waiting on a screen."],
          ["Debuggability", "When a lead is misrouted, which step went wrong and why?"],
          ["Evaluation", "Is prompt V3 actually better than V2? On which calls?"],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="text-sm font-semibold text-ink">{t}</div>
            <div className="text-xs text-ink-2">{d}</div>
          </div>
        ))}
      </div>
      <p>
        The first half of that list is <strong>orchestration</strong> (Track A: workflows and LangGraph). The second half is <strong>evaluation and operations</strong> (Track B). This
        whole lab is about both.
      </p>
      <QuickCheck
        q={{
          id: "a1l1",
          scenario: "Prompt V3 costs about 3× more input tokens than V2 because of guidelines and examples.",
          question: "What's the right way to decide between them?",
          options: [
            { text: "Always pick the cheaper one", why: "Cheaper is only better if quality is acceptable." },
            { text: "Always pick the longer one — more context is better", why: "Longer prompts cost more on every single call; the gain must justify it." },
            { text: "Measure both on the same labeled dataset and compare quality, cost and latency", correct: true, why: "This is exactly what Track B teaches: decide with measurements." },
            { text: "Ask the model which prompt it prefers", why: "Models are not reliable judges of their own prompts without validation." },
          ],
          takeaway: "Every prompt change is a trade-off you can measure.",
        }}
      />
    </LessonShell>
  );
}

// ================================================================ A1.2
const FAILURES: { id: string; label: string; text: string; lesson: string }[] = [
  { id: "ok", label: "Valid JSON", text: '{"intent": "interested", "confidence": 0.91}', lesson: "What you want: exact keys, allowed values, correct types." },
  { id: "fenced", label: "Markdown fences", text: '```json\n{"intent": "interested", "confidence": 0.88}\n```', lesson: "Common and harmless if your parser strips fences." },
  { id: "prose", label: "Prose", text: "The customer seems interested in the personal loan but wants to compare rates first.", lesson: "Correct meaning, zero structure. The prompt never asked for JSON." },
  { id: "chatty", label: "JSON inside chatter", text: 'Sure! Here is the analysis:\n{"intent": "interested", "confidence": 0.9}\nLet me know if you need more.', lesson: "Recoverable by extracting the {...} block — but it's a sign your prompt isn't strict enough." },
  { id: "case", label: "Wrong casing", text: '{"intent": "Interested", "confidence": 0.9}', lesson: "Looks right to a human; fails an enum. Normalize or tighten the prompt/schema." },
  { id: "key", label: "Renamed key", text: '{"label": "interested", "confidence": 0.9}', lesson: "The model 'helpfully' renamed a field. Downstream code reading `intent` breaks." },
  { id: "type", label: "Wrong type", text: '{"intent": "interested", "confidence": "high"}', lesson: "A string where a number was expected. Your routing on confidence < 0.7 would crash." },
  { id: "trunc", label: "Truncated", text: '{"intent": "interes', lesson: "Output hit max_tokens. Common with long outputs or reasoning models." },
];

function ParseGallery() {
  const [sel, setSel] = useState("prose");
  const [custom, setCustom] = useState('{"intent": "unclear", "confidence": 1.4}');
  const schema = TASKS.classify_intent.schema;
  const item = FAILURES.find((f) => f.id === sel);
  const text = sel === "custom" ? custom : item?.text ?? "";
  const parsed = useMemo(() => parseStructured(text, schema), [text, schema]);
  return (
    <Card className="my-6 p-4">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FAILURES.map((f) => (
          <Pill key={f.id} active={sel === f.id} onClick={() => setSel(f.id)}>
            {f.label}
          </Pill>
        ))}
        <Pill active={sel === "custom"} onClick={() => setSel("custom")}>
          ✎ Try your own
        </Pill>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Model output</div>
          {sel === "custom" ? <TextArea rows={5} value={custom} onChange={(e) => setCustom(e.target.value)} className="font-mono text-xs" /> : <JsonBlock value={text} />}
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Expected schema</div>
          <JsonBlock value={schemaToTypeString(schema)} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">What the parser does</div>
          <ol className="list-decimal pl-5 text-sm text-ink-2">
            {parsed.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {parsed.ok ? (
            <Callout kind="success" title="Valid — safe to write to state">
              <code className="font-mono text-xs">{JSON.stringify(parsed.value)}</code>
            </Callout>
          ) : (
            <Callout kind="danger" title={parsed.error?.type === "parse" ? "Not parseable" : "Parsed, but violates the schema"}>
              {parsed.error?.issues.length ? (
                <ul className="list-disc pl-4">
                  {parsed.error.issues.map((i, k) => (
                    <li key={k}>
                      <code className="font-mono text-xs">{i.path}</code>: {i.message}
                    </li>
                  ))}
                </ul>
              ) : (
                parsed.error?.message
              )}
            </Callout>
          )}
          {item && sel !== "custom" && <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">{item.lesson}</div>}
        </div>
      </div>
    </Card>
  );
}

export function StructuredOutput() {
  return (
    <LessonShell id="a1-structured-output">
      <p>
        Your lead-scoring model can't read “the customer seems keen”. It needs{" "}
        <code>{`{"intent": "interested", "product": "personal_loan", "confidence": 0.91}`}</code>. A <Term>Structured output</Term> is a contract: exact keys, allowed values, correct types. And a
        contract is only worth something if you <Term>Schema validation</Term>-check it every single time.
      </p>
      <WhyCard
        what={<>Model output that follows a schema (usually JSON), plus code that validates it.</>}
        why={<>LLMs produce text. Software needs typed fields. Without a contract, format drift silently corrupts data downstream.</>}
        when={<>Any time a model's output feeds code, a database, a router or another model.</>}
        whenNot={<>Pure free-text for humans (e.g. a reply draft) — though even then you often want a few structured fields alongside.</>}
        how={<>Describe the schema in the prompt and/or use provider-native structured outputs (<code>with_structured_output</code> in LangChain), then validate — types, enums, ranges.</>}
        real={<>Each call becomes a row: intent, product, sentiment, requested_info[], next_action, confidence. The confidence field drives human-review routing.</>}
      />
      <h2>Eight ways a model output can go wrong</h2>
      <p>These are real failure modes. Click through them and watch a production-style parser (raw → strip fences → extract block → validate) react.</p>
      <ParseGallery />
      <h2>In code: let the framework enforce the schema</h2>
      <p>
        With LangChain, <code>with_structured_output</code> binds a Pydantic model to the model call. Where the provider supports native structured outputs, the schema is enforced during
        generation; otherwise it falls back to tool calling / JSON parsing. Either way you get a validated object — or an exception you can handle.
      </p>
      <CodeBlock
        verified
        tabs={[
          {
            label: "with_structured_output",
            code: `from typing import Literal
from pydantic import BaseModel, Field
from langchain.chat_models import init_chat_model


class IntentResult(BaseModel):
    """Customer intent in a bank sales call."""
    intent: Literal["interested", "not_interested", "unclear"] = Field(
        description="interested = explicit positive signal; unclear = no commitment"
    )
    product: Literal["personal_loan", "home_loan", "car_loan", "credit_card",
                     "savings_account", "insurance", "none"]
    confidence: float = Field(ge=0, le=1)


model = init_chat_model("openai:gpt-5.4-mini")
classifier = model.with_structured_output(IntentResult)

result = classifier.invoke(f"Classify this call:\\n{transcript}")
print(result.intent, result.confidence)        # a validated Python object`,
          },
          {
            label: "keep the raw message",
            code: `# include_raw=True returns the raw AIMessage too — useful for token usage and debugging
classifier = model.with_structured_output(IntentResult, include_raw=True)
out = classifier.invoke(prompt)

out["raw"]            # AIMessage (usage_metadata, response metadata)
out["parsed"]         # IntentResult, or None if parsing failed
out["parsing_error"]  # the exception, or None — decide: retry, flag, or route to review`,
          },
        ]}
      />
      <Callout kind="info" title="Conceptual vs current syntax">
        The <strong>concept</strong> (schema + validation) is stable and framework-independent. The <strong>syntax</strong> (<code>with_structured_output</code>,{" "}
        <code>include_raw</code>, provider-native JSON schema features) is version-sensitive — that's why code blocks carry a “Last verified” date.
      </Callout>
      <TryIt title="See it inside a workflow" href="/lab/debug" cta="Open Debugging Lab">
        Challenge 1 in the Debugging Lab is a pipeline crashing on exactly this problem. Fix it.
      </TryIt>
    </LessonShell>
  );
}

// ================================================================ A1.3
const agentSpec: WorkflowSpec = {
  id: "agent-pattern",
  name: "Agent loop",
  nodes: [
    startNode(300, 0),
    llmNode("agent", "LLM decides", "custom", 300, 110),
    routerNode("has_tool_call", "Tool call?", { mode: "expression", field: "", expression: "state.tool_call ? 'tool' : 'done'", branches: ["tool", "done"] }, 300, 220),
    toolNode("tools", "Run tool", "crm_lookup", 600, 110),
    endNode(300, 340),
  ],
  edges: [edge("start", "agent"), edge("agent", "has_tool_call"), edge("has_tool_call", "tools", "tool"), edge("has_tool_call", "end", "done"), edge("tools", "agent")],
};

const PATTERNS: { id: string; name: string; spec: () => WorkflowSpec; what: string; transcript: string; use: string }[] = [
  { id: "chain", name: "Chain", spec: () => getTemplate("sequential"), what: "Fixed steps in order; each output feeds the next.", transcript: "clean → classify intent → extract product → final JSON.", use: "The default. Predictable and easy to test." },
  { id: "routing", name: "Routing", spec: () => getTemplate("routing"), what: "A decision picks the next step.", transcript: "Interested callers get details extracted; others skip it.", use: "Different inputs need different handling." },
  { id: "parallel", name: "Parallel", spec: () => getTemplate("parallel"), what: "Independent steps run at the same time, then merge.", transcript: "Intent, product and sentiment computed concurrently.", use: "Independent sub-tasks; you want lower latency." },
  { id: "loop", name: "Loop", spec: () => getTemplate("loop"), what: "Go back and try again until a condition is met.", transcript: "Invalid JSON → feed the error back → retry, at most twice.", use: "Validate-and-retry, iterative refinement." },
  { id: "state", name: "State & memory", spec: () => getTemplate("stateful"), what: "Information accumulates and is saved after each step.", transcript: "Analysis + CRM profile + follow-up actions build up in one state, checkpointed.", use: "Multi-step, resumable, auditable work." },
  { id: "tools", name: "Tools", spec: () => getTemplate("agentic"), what: "Steps call external systems (APIs, databases).", transcript: "CRM lookup, rate lookup, send a WhatsApp follow-up.", use: "When the answer depends on data or actions outside the model." },
  { id: "hitl", name: "Human-in-the-loop", spec: () => getTemplate("hitl"), what: "The workflow pauses for a person, then continues.", transcript: "Confidence < 0.7 → a reviewer confirms or corrects the intent.", use: "High stakes, low confidence, compliance." },
  { id: "agent", name: "Agent", spec: () => agentSpec, what: "The model decides which tool to call next, in a loop, until done.", transcript: "“Prepare a follow-up for this caller”: the model chooses CRM lookup, then rates, then drafts.", use: "Open-ended tasks where the steps can't be predefined." },
];

function PatternGallery() {
  const [sel, setSel] = useState("chain");
  const p = PATTERNS.find((x) => x.id === sel)!;
  const spec = useMemo(() => p.spec(), [p]);
  return (
    <Card className="my-6 p-4">
      <Segmented size="sm" value={sel} onChange={setSel} options={PATTERNS.map((x) => ({ id: x.id, label: x.name }))} className="mb-3 max-w-full overflow-x-auto" />
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <FlowDiagram spec={spec} maxHeight={380} compact />
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">What</div>
            <div className="text-ink">{p.what}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Transcript example</div>
            <div className="text-ink-2">{p.transcript}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Use it when</div>
            <div className="text-ink-2">{p.use}</div>
          </div>
          <Badge tone={p.id === "agent" ? "warn" : "good"}>{p.id === "agent" ? "Model controls the flow" : "You control the flow (workflow)"}</Badge>
        </div>
      </div>
    </Card>
  );
}

export function Patterns() {
  return (
    <LessonShell id="a1-patterns">
      <p>
        Almost every LLM system is built from a handful of patterns. The most important distinction is <strong>who decides what happens next</strong>:
      </p>
      <div className="my-4 grid gap-3 sm:grid-cols-2">
        <div className={cn("rounded-xl border border-line bg-surface p-4")}>
          <div className="text-sm font-semibold text-ink">
            <Term t="Workflow">Workflow</Term>
          </div>
          <p className="mt-1 text-sm text-ink-2">You define the paths in code. The LLM performs steps. Predictable, testable, cheaper.</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-sm font-semibold text-ink">
            <Term t="Agent">Agent</Term>
          </div>
          <p className="mt-1 text-sm text-ink-2">The LLM decides which actions/tools to use, in a loop. Flexible, but harder to bound, test and budget.</p>
        </div>
      </div>
      <h2>Pattern gallery</h2>
      <p>Each pattern below is a real, runnable graph in this lab. Click through them — notice how each adds exactly one capability.</p>
      <PatternGallery />
      <WhyCard
        what={<>Reusable shapes for combining LLM calls, code, tools and people: chain, routing, parallel, loop, state, tools, human review, agent.</>}
        why={<>Real tasks have dependencies, decisions, failures and risk. Patterns are proven ways to handle each.</>}
        when={<>Pick the pattern that mirrors the task's real structure: dependencies → chain; decisions → routing; independent parts → parallel; unreliable output → loop.</>}
        whenNot={<>Don't add a pattern “for flexibility”. Every branch, loop and tool is more to test, trace and pay for.</>}
        real={<>The Transcript Lab pipeline uses five of these at once: chain (redact → clean), parallel (4 analyses), routing (confidence gate), state (checkpoints) and human-in-the-loop.</>}
      />
      <QuickCheck
        q={{
          id: "a1l3",
          scenario: "For each call you must: redact PII, then (independently) classify intent and extract product, then — only for low-confidence results — ask a reviewer.",
          question: "Which combination of patterns is this?",
          options: [
            { text: "Just an agent", why: "Nothing here is open-ended; the steps are known." },
            { text: "Chain + parallel + routing + human-in-the-loop", correct: true, why: "Redact first (chain), two independent analyses (parallel), a confidence decision (routing) and a reviewer (HITL)." },
            { text: "A loop", why: "Nothing needs repeating." },
            { text: "A single prompt", why: "Could extract fields, but can't pause for a reviewer or guarantee redaction happens first." },
          ],
          takeaway: "Decompose the task, then map each requirement to a pattern.",
        }}
      />
      <Exercise id="ex-first-chain" />
    </LessonShell>
  );
}
