import { INTENTS, LABELING_GUIDELINES, NEXT_ACTIONS, PRODUCTS, REQUESTED_INFO, SENTIMENTS } from "@/lib/domain";
import type { ObjectSchema } from "./schema";
import type { TaskId } from "./types";

/**
 * Prompt versions are first-class, versioned artifacts — exactly how you
 * should treat them in production (prompt versioning -> regression testing).
 *
 * The `sim` block tells the SIMULATOR how this prompt tends to behave.
 * With a real provider those numbers are ignored and you measure reality.
 */
export interface PromptVersion {
  id: string;
  label: string;
  summary: string;
  system: string;
  user: string; // template: {{transcript}}
  sim: {
    /** added to model quality (can be negative) */
    qualityDelta: number;
    /** multiplier on format-following when JSON is requested (0..1) */
    formatReliability: number;
    /** fraction of the difficulty penalty removed (guidelines/few-shot help hard cases) */
    hardCaseHelp: number;
    /** answers in prose rather than JSON */
    prose?: boolean;
  };
}

export interface TaskDef {
  id: TaskId;
  label: string;
  description: string;
  schema: ObjectSchema;
  /** output field -> default state key */
  outputs: Record<string, string>;
  versions: PromptVersion[];
  defaultVersion: string;
}

const intentSchema: ObjectSchema = {
  intent: { type: "enum", values: INTENTS, description: "customer's interest in the product" },
  confidence: { type: "number", min: 0, max: 1, description: "0..1" },
};

const FEW_SHOT = `Examples:
Transcript: "Customer: Yes please, send me the application link."
{"intent": "interested", "confidence": 0.95}
Transcript: "Customer: Call me next week, I'm busy."
{"intent": "unclear", "confidence": 0.8}
Transcript: "Customer: Oh great, another loan call. Just what I needed. Bye."
{"intent": "not_interested", "confidence": 0.85}`;

const TRANSCRIPT_BLOCK = "Transcript:\n<<<\n{{transcript}}\n>>>";

export const TASKS: Record<Exclude<TaskId, "custom">, TaskDef> = {
  classify_intent: {
    id: "classify_intent",
    label: "Classify intent",
    description: "Is the customer interested, not interested, or unclear?",
    schema: intentSchema,
    outputs: { intent: "intent", confidence: "confidence" },
    defaultVersion: "v3",
    versions: [
      {
        id: "v1",
        label: "V1 · Naive",
        summary: "One-line question. No labels, no format. Answers in prose.",
        system: "You are a helpful assistant.",
        user: "What is the customer's intent in this call?\n\n{{transcript}}",
        sim: { qualityDelta: -0.08, formatReliability: 0.12, hardCaseHelp: 0, prose: true },
      },
      {
        id: "v2",
        label: "V2 · Labels + JSON",
        summary: "Defines the three labels and asks for JSON.",
        system: "You analyze customer call transcripts for a bank's sales team. Respond with JSON only.",
        user: `Classify the customer's intent.

Labels:
- interested: the customer wants to proceed or wants details in order to proceed
- not_interested: the customer declines
- unclear: no clear commitment either way

Return JSON: {"intent": "interested" | "not_interested" | "unclear", "confidence": number between 0 and 1}

${TRANSCRIPT_BLOCK}`,
        sim: { qualityDelta: 0, formatReliability: 0.97, hardCaseHelp: 0.1 },
      },
      {
        id: "v3",
        label: "V3 · Guidelines + few-shot",
        summary: "Adds the labeling guidelines (final position wins, callbacks = unclear, sarcasm) and 3 examples.",
        system: "You analyze customer call transcripts for a bank's sales team. Follow the labeling guidelines exactly. Respond with JSON only.",
        user: `${LABELING_GUIDELINES}

${FEW_SHOT}

Now classify this call. Return JSON only:
{"intent": "interested" | "not_interested" | "unclear", "confidence": number between 0 and 1}

${TRANSCRIPT_BLOCK}`,
        sim: { qualityDelta: 0.045, formatReliability: 0.992, hardCaseHelp: 0.45 },
      },
      {
        id: "v4",
        label: "V4 · Compressed (cost-cut)",
        summary: "V3 shortened to cut tokens: guidelines and examples removed.",
        system: "Classify call intent. JSON only.",
        user: `intent ∈ {interested, not_interested, unclear}. Output {"intent": ..., "confidence": 0-1}.
${TRANSCRIPT_BLOCK}`,
        sim: { qualityDelta: -0.025, formatReliability: 0.95, hardCaseHelp: 0 },
      },
    ],
  },
  extract_product: {
    id: "extract_product",
    label: "Extract product",
    description: "Which product is the customer's decision about?",
    schema: {
      product: { type: "enum", values: PRODUCTS },
      confidence: { type: "number", min: 0, max: 1 },
    },
    outputs: { product: "product", confidence: "product_confidence" },
    defaultVersion: "v2",
    versions: [
      {
        id: "v1",
        label: "V1 · Naive",
        summary: "Asks which product, no allowed values.",
        system: "You are a helpful assistant.",
        user: "Which banking product is this call about?\n\n{{transcript}}",
        sim: { qualityDelta: -0.06, formatReliability: 0.15, hardCaseHelp: 0, prose: true },
      },
      {
        id: "v2",
        label: "V2 · Allowed values + JSON",
        summary: "Lists allowed products and asks for JSON.",
        system: "You extract structured data from bank call transcripts. Respond with JSON only.",
        user: `Which product is the customer's decision about? If the customer asks about a different product than the one pitched, use the customer's product.

Allowed: ${PRODUCTS.join(", ")}

Return JSON: {"product": <allowed value>, "confidence": number between 0 and 1}

${TRANSCRIPT_BLOCK}`,
        sim: { qualityDelta: 0.02, formatReliability: 0.99, hardCaseHelp: 0.35 },
      },
    ],
  },
  sentiment: {
    id: "sentiment",
    label: "Sentiment",
    description: "The customer's overall tone.",
    schema: {
      sentiment: { type: "enum", values: SENTIMENTS },
      confidence: { type: "number", min: 0, max: 1 },
    },
    outputs: { sentiment: "sentiment", confidence: "sentiment_confidence" },
    defaultVersion: "v2",
    versions: [
      {
        id: "v1",
        label: "V1 · Naive",
        summary: "How does the customer feel?",
        system: "You are a helpful assistant.",
        user: "How does the customer feel in this call?\n\n{{transcript}}",
        sim: { qualityDelta: -0.05, formatReliability: 0.15, hardCaseHelp: 0, prose: true },
      },
      {
        id: "v2",
        label: "V2 · Labels + JSON",
        summary: "Customer tone only (not the agent's); JSON.",
        system: "You analyze the CUSTOMER's tone in bank call transcripts. Respond with JSON only.",
        user: `Classify the customer's overall sentiment (ignore the agent). Watch for sarcasm.

Return JSON: {"sentiment": "positive" | "neutral" | "negative", "confidence": number between 0 and 1}

${TRANSCRIPT_BLOCK}`,
        sim: { qualityDelta: 0.02, formatReliability: 0.99, hardCaseHelp: 0.3 },
      },
    ],
  },
  full_analysis: {
    id: "full_analysis",
    label: "Full analysis (single call)",
    description: "Everything in one prompt: intent, product, sentiment, requested info, next action.",
    schema: {
      intent: { type: "enum", values: INTENTS },
      product: { type: "enum", values: PRODUCTS },
      sentiment: { type: "enum", values: SENTIMENTS },
      requested_info: { type: "string[]", values: REQUESTED_INFO },
      next_action: { type: "enum", values: NEXT_ACTIONS },
      confidence: { type: "number", min: 0, max: 1 },
    },
    outputs: {
      intent: "intent",
      product: "product",
      sentiment: "sentiment",
      requested_info: "requested_info",
      next_action: "next_action",
      confidence: "confidence",
    },
    defaultVersion: "v2",
    versions: [
      {
        id: "v1",
        label: "V1 · Schema only",
        summary: "Asks for all fields with allowed values.",
        system: "You extract structured data from bank call transcripts. Respond with JSON only.",
        user: `Analyze the call and return JSON with keys:
intent (${INTENTS.join("|")}), product (${PRODUCTS.join("|")}), sentiment (${SENTIMENTS.join("|")}),
requested_info (array of ${REQUESTED_INFO.join("|")}), next_action (${NEXT_ACTIONS.join("|")}), confidence (0-1).

${TRANSCRIPT_BLOCK}`,
        sim: { qualityDelta: -0.02, formatReliability: 0.95, hardCaseHelp: 0.1 },
      },
      {
        id: "v2",
        label: "V2 · Guidelines + schema",
        summary: "Adds the labeling guidelines. Longer prompt, better hard cases.",
        system: "You extract structured data from bank call transcripts. Follow the guidelines exactly. Respond with JSON only.",
        user: `${LABELING_GUIDELINES}

Return JSON with keys:
intent (${INTENTS.join("|")}), product (${PRODUCTS.join("|")}), sentiment (${SENTIMENTS.join("|")}),
requested_info (array of ${REQUESTED_INFO.join("|")}), next_action (${NEXT_ACTIONS.join("|")}), confidence (0-1).

${TRANSCRIPT_BLOCK}`,
        sim: { qualityDelta: 0.03, formatReliability: 0.985, hardCaseHelp: 0.4 },
      },
    ],
  },
  extract_details: {
    id: "extract_details",
    label: "Extract details",
    description: "What did the customer ask about, and what should happen next?",
    schema: {
      requested_info: { type: "string[]", values: REQUESTED_INFO },
      next_action: { type: "enum", values: NEXT_ACTIONS },
    },
    outputs: { requested_info: "requested_info", next_action: "next_action" },
    defaultVersion: "v1",
    versions: [
      {
        id: "v1",
        label: "V1 · Schema",
        summary: "Requested info + next best action.",
        system: "You extract structured data from bank call transcripts. Respond with JSON only.",
        user: `Return JSON: {"requested_info": [${REQUESTED_INFO.map((x) => `"${x}"`).join(", ")}] (only those the customer asked about), "next_action": ${NEXT_ACTIONS.map((x) => `"${x}"`).join(" | ")}}

${TRANSCRIPT_BLOCK}`,
        sim: { qualityDelta: 0, formatReliability: 0.985, hardCaseHelp: 0.2 },
      },
    ],
  },
  summarize: {
    id: "summarize",
    label: "Summarize",
    description: "A 1–3 sentence call summary for the CRM.",
    schema: { summary: { type: "string", minLength: 10 } },
    outputs: { summary: "summary" },
    defaultVersion: "v2",
    versions: [
      {
        id: "v1",
        label: "V1 · Free summary",
        summary: "'Summarize the call.' No grounding instruction.",
        system: "You write concise CRM notes.",
        user: `Summarize this call in 2-3 sentences. Return JSON: {"summary": string}

${TRANSCRIPT_BLOCK}`,
        sim: { qualityDelta: 0, formatReliability: 0.985, hardCaseHelp: 0 },
      },
      {
        id: "v2",
        label: "V2 · Grounded summary",
        summary: "Only facts stated in the transcript; no numbers that were not said.",
        system: "You write concise, strictly factual CRM notes.",
        user: `Summarize this call in 2-3 sentences using ONLY facts stated in the transcript.
Do not add rates, amounts, dates or promises that were not explicitly said. Return JSON: {"summary": string}

${TRANSCRIPT_BLOCK}`,
        sim: { qualityDelta: 0.02, formatReliability: 0.99, hardCaseHelp: 0.5 },
      },
    ],
  },
  judge: {
    id: "judge",
    label: "LLM-as-a-judge",
    description: "Score an answer against a reference using a rubric.",
    schema: {
      score: { type: "number", min: 1, max: 5 },
      reasoning: { type: "string" },
    },
    outputs: { score: "judge_score", reasoning: "judge_reasoning" },
    defaultVersion: "v1",
    versions: [
      {
        id: "v1",
        label: "V1 · Rubric judge",
        summary: "Reference-based grading with an explicit rubric.",
        system: "You are a strict, careful evaluator of AI outputs. Respond with JSON only.",
        user: "{{judge_prompt}}",
        sim: { qualityDelta: 0, formatReliability: 0.99, hardCaseHelp: 0 },
      },
    ],
  },
};

export function getTask(id: TaskId): TaskDef | undefined {
  if (id === "custom") return undefined;
  return TASKS[id];
}

export function getPromptVersion(task: TaskId, versionId?: string): PromptVersion | undefined {
  const def = getTask(task);
  if (!def) return undefined;
  return def.versions.find((v) => v.id === (versionId ?? def.defaultVersion)) ?? def.versions[0];
}

export function renderPrompt(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export const TASK_OPTIONS = (Object.keys(TASKS) as Exclude<TaskId, "custom">[]).filter((t) => t !== "judge");
