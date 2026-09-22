import { invokeLLM } from "@/lib/ai/client";
import { parseStructured } from "@/lib/ai/schema";
import { TASKS } from "@/lib/ai/tasks";
import type { LLMResponse } from "@/lib/ai/types";

export interface Rubric {
  levels: string[]; // index 0 = score 1 … index 4 = score 5
  strictness: number; // 0..1
  penalizeUnsupported: boolean;
  requireLabelMatch: boolean;
}

export const DEFAULT_RUBRIC: Rubric = {
  levels: ["Clearly incorrect", "Mostly incorrect", "Partially correct", "Mostly correct", "Fully correct"],
  strictness: 0.2,
  penalizeUnsupported: false,
  requireLabelMatch: false,
};

export interface JudgeInput {
  question: string;
  reference: string;
  answer: string;
  context?: string;
}

export function buildJudgePrompt(input: JudgeInput, rubric: Rubric) {
  const rules: string[] = ["Grade only against the reference answer and the transcript. Do not use outside knowledge.", "Do not reward length or style; a short correct answer can score 5."];
  if (rubric.requireLabelMatch) rules.push("The answer must explicitly state the correct intent label (interested / not_interested / unclear). If it doesn't, the score is at most 2.");
  if (rubric.penalizeUnsupported) rules.push("Any claim not supported by the transcript (invented numbers, dates, promises) must lower the score by at least 2 points.");
  if (rubric.strictness > 0.5) rules.push("Be strict: an answer that is only partially correct cannot score above 3.");
  const prompt = `You are grading an AI-generated answer about a customer service call.

QUESTION:
${input.question}

REFERENCE ANSWER (ground truth):
${input.reference}
${input.context ? `\nTRANSCRIPT:\n<<<\n${input.context}\n>>>\n` : ""}
ANSWER TO GRADE:
${input.answer}

RUBRIC (score 1–5):
${rubric.levels.map((l, i) => `${i + 1} = ${l}`).join("\n")}

RULES:
${rules.map((r) => `- ${r}`).join("\n")}

First reason briefly, then give the score. Return JSON only:
{"reasoning": "<2-3 sentences>", "score": <integer 1-5>}`;
  return { system: "You are a strict, careful evaluator of AI outputs. Respond with JSON only.", prompt };
}

export interface JudgeResult {
  score: number | null;
  reasoning: string;
  raw: string;
  prompt: string;
  system: string;
  model: string;
  res?: LLMResponse;
  error?: string;
}

export async function runJudge(model: string, input: JudgeInput, rubric: Rubric, opts: { runIndex?: number; position?: "A" | "B"; temperature?: number } = {}): Promise<JudgeResult> {
  const { system, prompt } = buildJudgePrompt(input, rubric);
  try {
    const res = await invokeLLM({
      model,
      system,
      prompt,
      temperature: opts.temperature ?? 0,
      maxTokens: 400,
      task: "judge",
      promptVersion: "v1",
      sim: {
        runIndex: opts.runIndex ?? 0,
        judge: {
          question: input.question,
          reference: input.reference,
          answer: input.answer,
          context: input.context,
          rubric: { strictness: rubric.strictness, penalizeUnsupported: rubric.penalizeUnsupported, requireLabelMatch: rubric.requireLabelMatch, scale: 5 },
          position: opts.position,
        },
      },
    });
    const p = parseStructured(res.text, TASKS.judge.schema);
    return {
      score: p.ok ? Math.round(Number(p.value!.score)) : null,
      reasoning: p.ok ? String(p.value!.reasoning) : p.error?.message ?? "",
      raw: res.text,
      prompt,
      system,
      model,
      res,
    };
  } catch (e) {
    return { score: null, reasoning: "", raw: "", prompt, system, model, error: (e as Error).message };
  }
}

export const JUDGE_QUESTION = "Is the customer interested in the loan, and what do they want next?";
export const JUDGE_REFERENCE = "Yes — the customer is interested in the personal loan; they want to compare interest rates first and asked for the full rate details by email.";

/** Answers with human scores, for judge calibration (transcript t01). */
export const JUDGE_CASES: { id: string; answer: string; human: number; note: string }[] = [
  { id: "a1", answer: "Interested — they asked for the full rate details to be emailed so they can compare.", human: 5, note: "Correct and complete." },
  { id: "a2", answer: "Yes, interested.", human: 4, note: "Correct but omits what they want next." },
  {
    id: "a3",
    answer: "The customer is interested but wants to compare rates first and asked us to email the details. They also mentioned a CIBIL score of 780 and agreed to apply today.",
    human: 2,
    note: "Starts right, then invents two facts (780, 'agreed to apply').",
  },
  { id: "a4", answer: "Not interested; they were just asking about rates.", human: 1, note: "Wrong intent." },
  {
    id: "a5",
    answer: "The caller seems somewhat keen on a personal loan product, discussed interest rates at some length, and the conversation was polite and professional throughout, covering the product and its features in reasonable detail.",
    human: 2,
    note: "Verbose and vague: never states the label or the next step.",
  },
  { id: "a6", answer: "Unclear — they didn't commit to anything.", human: 2, note: "Wrong under the guidelines ('please send me details' is interested)." },
  { id: "a7", answer: "Interested in the personal loan; wants the interest-rate details by email before deciding.", human: 5, note: "Correct and complete." },
  { id: "a8", answer: "They are interested in a personal loan and want to compare the interest rates.", human: 4, note: "Correct; misses the email request." },
];
