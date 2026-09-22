import type { ModelInfo, SimProfile } from "@/config/models";
import {
  INTENTS,
  type Intent,
  type NextAction,
  type Product,
  PRODUCT_LABELS,
  type RequestedInfo,
  type Sentiment,
  type TranscriptLabels,
} from "@/lib/domain";
import { costFor } from "@/lib/ai/pricing";
import { getPromptVersion, type PromptVersion } from "@/lib/ai/tasks";
import type { JudgeSimInput, LLMRequest, LLMResponse } from "@/lib/ai/types";
import { checkGroundedness, semanticSimilarity, normalizedMatch } from "@/lib/eval/similarity";
import { clamp, estimateTokens } from "@/lib/utils";
import { analyzeTranscript } from "./heuristics";
import { lognormal, normal, pick, rngFrom, type Rng, weightedPick } from "./rng";
import { findTranscript, lookupKnownTranscript } from "./transcripts";

/**
 * The simulated LLM.
 *
 * It is NOT a language model. It is a carefully designed stochastic model of
 * LLM *behaviour* so you can learn evaluation without an API key:
 *  - accuracy drops on hard examples; better prompts/models help most there
 *  - small models are over-confident (poor calibration)
 *  - weak prompts produce prose / malformed JSON
 *  - temperature > 0 makes outputs vary run to run
 *  - reasoning models spend hidden tokens (latency + cost)
 *  - summaries sometimes contain unsupported claims (hallucinations)
 *  - latency is lognormal (a long right tail -> P95 >> median)
 * Same inputs + temperature 0 => identical output (deterministic seed).
 */

type SimTraits = PromptVersion["sim"];

function inferTraits(system: string, prompt: string): SimTraits {
  const text = `${system}\n${prompt}`;
  const asksJson = /json/i.test(text);
  const listsLabels = /not_interested/.test(text) && /unclear/.test(text);
  const guidelines = /final stated position|guideline|final position/i.test(text);
  const examples = /example/i.test(text);
  return {
    qualityDelta: (listsLabels ? 0 : -0.06) + (guidelines ? 0.03 : 0) + (examples ? 0.015 : 0),
    formatReliability: asksJson ? (listsLabels ? 0.95 : 0.85) : 0.15,
    hardCaseHelp: (guidelines ? 0.3 : 0) + (examples ? 0.15 : 0) + (listsLabels ? 0.1 : 0),
    prose: !asksJson,
  };
}

function extractTranscript(req: LLMRequest): string {
  if (req.sim?.transcript) return req.sim.transcript;
  const m = req.prompt.match(/<<<\n?([\s\S]*?)\n?>>>/);
  return m ? m[1] : req.prompt;
}

interface Oracle {
  labels: TranscriptLabels;
  difficulty: number;
  key: string;
  tags: string[];
  known: boolean;
}

function getOracle(req: LLMRequest, transcript: string): Oracle {
  const byId = req.sim?.transcriptId ? findTranscript(req.sim.transcriptId) : undefined;
  const known = byId ?? lookupKnownTranscript(transcript);
  if (known) return { labels: known.labels, difficulty: known.difficulty, key: known.id, tags: known.tags, known: true };
  const h = analyzeTranscript(transcript);
  return {
    labels: { intent: h.intent, product: h.product, sentiment: h.sentiment, next_action: h.next_action, requested_info: h.requested_info },
    difficulty: clamp((1 - h.clarity) * 0.8, 0.05, 0.9),
    key: `custom:${transcript.length}:${transcript.slice(0, 80)}`,
    tags: ["custom"],
    known: false,
  };
}

function errorRate(p: SimProfile, traits: SimTraits, difficulty: number, temperature: number, isReasoning: boolean) {
  const eff = difficulty * (1 - traits.hardCaseHelp) * (isReasoning ? 0.65 : 1);
  const e0 = Math.max(0.01, 1 - p.quality - traits.qualityDelta);
  let e = e0 * (0.3 + 2.7 * eff);
  e += temperature * 0.07 * (0.4 + eff);
  return clamp(e, 0.004, 0.92);
}

const INTENT_CONFUSION: Record<Intent, { value: Intent; weight: number }[]> = {
  interested: [{ value: "unclear", weight: 0.72 }, { value: "not_interested", weight: 0.28 }],
  not_interested: [{ value: "unclear", weight: 0.55 }, { value: "interested", weight: 0.45 }],
  unclear: [{ value: "interested", weight: 0.6 }, { value: "not_interested", weight: 0.4 }],
};

function wrongIntent(gold: Intent, itemRng: Rng, tags: string[]): Intent {
  if (tags.includes("sarcasm") && gold === "not_interested") return "interested";
  if (tags.includes("mixed-signals") && gold === "not_interested") return "interested"; // early 'yes' trap
  return weightedPick(itemRng, INTENT_CONFUSION[gold]);
}

function wrongProduct(gold: Product, itemRng: Rng, tags: string[]): Product {
  if (tags.includes("multi-product")) return "personal_loan";
  const related: Record<Product, Product[]> = {
    personal_loan: ["home_loan", "credit_card", "none"],
    home_loan: ["personal_loan"],
    car_loan: ["personal_loan"],
    credit_card: ["personal_loan", "savings_account"],
    savings_account: ["credit_card", "none"],
    insurance: ["none", "savings_account"],
    none: ["personal_loan"],
  };
  return pick(itemRng, related[gold]);
}

function wrongSentiment(gold: Sentiment, itemRng: Rng, tags: string[]): Sentiment {
  if (tags.includes("sarcasm")) return "positive";
  if (gold === "neutral") return itemRng() < 0.6 ? "negative" : "positive";
  return "neutral";
}

function confidenceFor(p: SimProfile, correct: boolean, difficulty: number, rng: Rng, temperature: number) {
  const calibrated = correct ? 0.72 + 0.26 * (1 - difficulty) : 0.42 + 0.16 * (1 - difficulty);
  const overconfident = 0.82 + 0.13 * rng();
  let c = p.calibration * calibrated + (1 - p.calibration) * overconfident + normal(rng, 0, 0.035 + temperature * 0.04);
  c = clamp(c, 0.3, 0.99);
  return Math.round(c * 100) / 100;
}

function nextActionFor(intent: Intent, gold: TranscriptLabels, correctIntent: boolean): NextAction {
  if (correctIntent) return gold.next_action;
  if (intent === "not_interested") return "close_lead";
  if (intent === "interested") return "send_details";
  return "follow_up";
}

type Failure = "prose" | "prose_json" | "wrong_key" | "enum_case" | "conf_string" | "missing_field" | "fenced";

function renderJson(obj: Record<string, unknown>, rng: Rng, pFormat: number, traits: SimTraits): { text: string; failure?: Failure } {
  const roll = rng();
  if (roll < pFormat) {
    // valid; sometimes wrapped in markdown fences (a parser should handle this)
    if (rng() < 0.12) return { text: "```json\n" + JSON.stringify(obj, null, 2) + "\n```", failure: "fenced" };
    return { text: JSON.stringify(obj) };
  }
  if (traits.prose) {
    if (rng() < 0.9) return { text: proseFor(obj), failure: "prose" };
    return { text: `Sure! Here is my analysis:\n${JSON.stringify(obj)}\nLet me know if you need anything else.`, failure: "prose_json" };
  }
  const mode = weightedPick<Failure>(rng, [
    { value: "wrong_key", weight: 3 },
    { value: "enum_case", weight: 2.5 },
    { value: "conf_string", weight: 2 },
    { value: "prose_json", weight: 1.5 },
    { value: "missing_field", weight: 1 },
  ]);
  const o = { ...obj };
  switch (mode) {
    case "wrong_key": {
      const k = "intent" in o ? "intent" : Object.keys(o)[0];
      const v = o[k];
      delete o[k];
      const alt = k === "intent" ? "label" : k === "product" ? "product_name" : k === "sentiment" ? "tone" : `${k}_value`;
      return { text: JSON.stringify({ [alt]: v, ...o }), failure: mode };
    }
    case "enum_case": {
      const k = Object.keys(o).find((x) => typeof o[x] === "string") ?? Object.keys(o)[0];
      const v = String(o[k]);
      o[k] = v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return { text: JSON.stringify(o), failure: mode };
    }
    case "conf_string": {
      if ("confidence" in o) o.confidence = (o.confidence as number) > 0.8 ? "high" : "medium";
      else if ("score" in o) o.score = `${o.score}/5`;
      return { text: JSON.stringify(o), failure: mode };
    }
    case "missing_field": {
      const keys = Object.keys(o);
      delete o[keys[keys.length - 1]];
      return { text: JSON.stringify(o), failure: mode };
    }
    default:
      return { text: `Based on the transcript, here is the result: ${JSON.stringify(o)}`, failure: "prose_json" };
  }
}

function proseFor(obj: Record<string, unknown>): string {
  const bits: string[] = [];
  if (obj.intent) {
    const i = obj.intent as Intent;
    bits.push(
      i === "interested"
        ? "The customer seems interested and would like to move forward"
        : i === "not_interested"
          ? "The customer does not appear to be interested"
          : "It's not entirely clear whether the customer wants to proceed",
    );
  }
  if (obj.product) bits.push(`the call is about a ${PRODUCT_LABELS[obj.product as Product]?.toLowerCase() ?? obj.product}`);
  if (obj.sentiment) bits.push(`their tone is ${obj.sentiment}`);
  if (typeof obj.confidence === "number") bits.push(`I'm fairly confident about this (${Math.round((obj.confidence as number) * 100)}%)`);
  return bits.length ? bits.join("; ") + "." : "The customer and the agent discussed a banking product.";
}

const FABRICATIONS = [
  "The agent confirmed an interest rate of 10.25% for the customer.",
  "The customer agreed to submit the documents by Friday.",
  "A follow-up call has been scheduled for Monday at 11 am.",
  "The customer mentioned a CIBIL score of 780.",
  "The agent approved a loan amount of 7.5 lakh on the call.",
];

function summarize(gold: TranscriptLabels, intent: Intent, rng: Rng, hallucinate: boolean, omit: boolean): { summary: string; fabricated?: string } {
  const productWord = PRODUCT_LABELS[gold.product].toLowerCase();
  const s: string[] = [];
  if (gold.product === "none") s.push(intent === "not_interested" ? "The customer ended the call quickly and declined the offer." : "The customer spoke briefly with the agent.");
  else if (intent === "interested") s.push(`The customer is interested in a ${productWord}.`);
  else if (intent === "not_interested") s.push(`The customer declined the ${productWord} offer.`);
  else s.push(`The customer did not commit to the ${productWord} and needs a follow-up.`);
  if (gold.requested_info.length && !omit) s.push(`They asked about ${gold.requested_info.map((x) => x.replace(/_/g, " ")).join(" and ")}.`);
  const next: Record<NextAction, string> = {
    send_details: "Next step: send the requested details.",
    start_application: "Next step: start the application.",
    schedule_callback: "Next step: call the customer back.",
    follow_up: "Next step: follow up later.",
    close_lead: "Next step: close the lead.",
    escalate_complaint: "Next step: escalate the complaint.",
  };
  s.push(next[gold.next_action]);
  let fabricated: string | undefined;
  if (hallucinate) {
    fabricated = pick(rng, FABRICATIONS);
    s.splice(1, 0, fabricated);
  }
  return { summary: s.join(" "), fabricated };
}

function judgeScore(j: JudgeSimInput, p: SimProfile, rng: Rng, temperature: number) {
  const scale = j.rubric.scale || 5;
  const sim = semanticSimilarity(j.reference, j.answer);
  const factors: string[] = [];
  let s = 1 + (scale - 1) * Math.pow(sim.score, 0.8);
  factors.push(`Meaning overlap with the reference ≈ ${(sim.score * 100).toFixed(0)}%`);
  const refLabel = (["not_interested", "interested", "unclear"] as const).find((l) => normalizedMatch(l, j.reference) || new RegExp(`\\b${l.replace("_", "[ _]")}\\b`, "i").test(j.reference));
  if (j.rubric.requireLabelMatch && refLabel) {
    const has = new RegExp(`\\b${refLabel.replace("_", "[ _]")}\\b`, "i").test(j.answer) && !(refLabel === "interested" && /not[ _]interested/i.test(j.answer));
    if (!has) {
      s = Math.min(s, Math.ceil(scale * 0.4));
      factors.push(`Required label "${refLabel}" is not stated explicitly`);
    } else factors.push(`States the required label "${refLabel}"`);
  }
  if (j.rubric.penalizeUnsupported && j.context) {
    const bad = checkGroundedness(j.answer, j.context).filter((c) => !c.supported);
    if (bad.length) {
      s -= 1.5 * bad.length;
      factors.push(`${bad.length} claim(s) not supported by the transcript`);
    }
  }
  s -= j.rubric.strictness * 0.9;
  if (j.rubric.strictness > 0.5) factors.push("Strict rubric: partial answers lose points");
  // biases that real judges exhibit
  const judgeWeakness = 1 - p.quality;
  const verbosity = clamp((j.answer.length - 80) / 220, 0, 1) * (0.4 + judgeWeakness * 4);
  if (verbosity > 0.25) factors.push("(bias) longer answer nudged the score up");
  s += verbosity;
  if (j.position === "A") s += 0.25 + judgeWeakness * 2;
  s += normal(rng, 0, 0.18 + judgeWeakness * 1.5 + temperature * 0.35);
  const score = clamp(Math.round(s), 1, scale);
  return { score, factors };
}

export function simulateLLM(req: LLMRequest, model: ModelInfo): LLMResponse {
  const p = model.sim!;
  const temperature = model.supportsTemperature ? clamp(req.temperature ?? 0, 0, 2) : 1;
  const effTemp = model.supportsTemperature ? temperature : 0.15;
  const task = req.task ?? "custom";
  const pv = req.promptVersion && req.promptVersion !== "custom" ? getPromptVersion(task, req.promptVersion) : undefined;
  const templateUsed = pv && req.prompt.length > 0;
  const traits: SimTraits = templateUsed ? pv!.sim : inferTraits(req.system, req.prompt);
  const transcript = extractTranscript(req);
  const oracle = getOracle(req, transcript);
  const runIndex = temperature > 0 ? req.sim?.runIndex ?? 0 : 0;
  const rng = rngFrom(model.id, task, pv?.id ?? "custom", oracle.key, runIndex, req.prompt.length);
  const itemRng = rngFrom("item", oracle.key, task);
  const isReasoning = !!model.reasoning;
  const e = errorRate(p, traits, oracle.difficulty, effTemp, isReasoning);
  let pFormat = clamp(p.formatDiscipline * traits.formatReliability - effTemp * 0.04, 0.02, 0.995);
  if (!/json/i.test(req.system + req.prompt)) pFormat = Math.min(pFormat, 0.1);
  // a retry prompt that feeds the parse error back ("repair prompt") usually fixes format issues
  if (/previous answer was invalid/i.test(req.prompt)) pFormat = Math.max(pFormat, 0.9);

  let obj: Record<string, unknown> = {};
  let text = "";

  const gold = oracle.labels;
  const intentCorrect = rng() > e;
  const intent = intentCorrect ? gold.intent : wrongIntent(gold.intent, itemRng, oracle.tags);

  switch (task) {
    case "classify_intent": {
      obj = { intent, confidence: confidenceFor(p, intentCorrect, oracle.difficulty, rng, effTemp) };
      text = renderJson(obj, rng, pFormat, traits).text;
      break;
    }
    case "extract_product": {
      const ok = rng() > e * 0.6;
      obj = { product: ok ? gold.product : wrongProduct(gold.product, itemRng, oracle.tags), confidence: confidenceFor(p, ok, oracle.difficulty * 0.7, rng, effTemp) };
      text = renderJson(obj, rng, pFormat, traits).text;
      break;
    }
    case "sentiment": {
      const ok = rng() > e * 0.8;
      obj = { sentiment: ok ? gold.sentiment : wrongSentiment(gold.sentiment, itemRng, oracle.tags), confidence: confidenceFor(p, ok, oracle.difficulty, rng, effTemp) };
      text = renderJson(obj, rng, pFormat, traits).text;
      break;
    }
    case "extract_details":
    case "full_analysis": {
      const prodOk = rng() > e * 0.6;
      const sentOk = rng() > e * 0.8;
      const info: RequestedInfo[] = gold.requested_info.filter(() => rng() > e * 0.7);
      if (rng() < e * 0.3) info.push("fees");
      const next = nextActionFor(intent, gold, intentCorrect);
      if (task === "extract_details") obj = { requested_info: [...new Set(info)], next_action: next };
      else
        obj = {
          intent,
          product: prodOk ? gold.product : wrongProduct(gold.product, itemRng, oracle.tags),
          sentiment: sentOk ? gold.sentiment : wrongSentiment(gold.sentiment, itemRng, oracle.tags),
          requested_info: [...new Set(info)],
          next_action: next,
          confidence: confidenceFor(p, intentCorrect && prodOk, oracle.difficulty, rng, effTemp),
        };
      text = renderJson(obj, rng, pFormat, traits).text;
      break;
    }
    case "summarize": {
      const hallucinationP = p.hallucinationRate * (1 - traits.hardCaseHelp * 1.3) * (1 + effTemp * 0.8);
      const s = summarize(gold, intent, rng, rng() < clamp(hallucinationP, 0.005, 0.9), rng() < e * 0.8);
      obj = { summary: s.summary };
      text = renderJson(obj, rng, pFormat, traits).text;
      break;
    }
    case "judge": {
      const j = req.sim?.judge;
      if (!j) {
        text = JSON.stringify({ score: 3, reasoning: "No judge input provided to the simulator." });
        break;
      }
      const jr = judgeScore(j, p, rngFrom(model.id, "judge", j.answer, j.reference, j.position ?? "", JSON.stringify(j.rubric), runIndex), effTemp);
      obj = { score: jr.score, reasoning: jr.factors.join(". ") + "." };
      text = renderJson(obj, rng, clamp(pFormat + 0.05, 0, 0.99), traits).text;
      break;
    }
    default: {
      // custom prompt: best effort
      if (/transcript|customer|agent/i.test(req.prompt)) {
        obj = {
          intent,
          product: gold.product,
          sentiment: gold.sentiment,
          confidence: confidenceFor(p, intentCorrect, oracle.difficulty, rng, effTemp),
        };
        text = renderJson(obj, rng, pFormat, traits).text;
      } else {
        text =
          "(Simulated model) I only simulate transcript-analysis tasks: intent, product, sentiment, details, summaries and judging. Switch to Live mode in Settings to send arbitrary prompts to a real model.";
      }
    }
  }

  // ---- tokens, truncation, latency, cost ----
  const inputTokens = estimateTokens(req.system) + estimateTokens(req.prompt) + 7;
  const reasoningTokens = isReasoning ? Math.round(lognormal(rng, p.reasoningTokens * (0.6 + oracle.difficulty), 0.35)) : 0;
  let outputTokens = estimateTokens(text) + 1;
  let stopReason = "end_turn";
  const budget = req.maxTokens;
  if (reasoningTokens + outputTokens > budget) {
    const room = Math.max(0, budget - reasoningTokens);
    text = room <= 0 ? "" : text.slice(0, Math.max(0, room * 4 - 2));
    outputTokens = estimateTokens(text);
    stopReason = "max_tokens";
  }

  const ttft = lognormal(rng, p.ttftMs, p.latencySigma) + inputTokens * 0.12 + (reasoningTokens / p.tokensPerSec) * 1000;
  const gen = (outputTokens / p.tokensPerSec) * 1000;
  const network = 35 + rng() * 70;
  const latencyMs = Math.round(ttft + gen + network);

  return {
    text,
    inputTokens,
    outputTokens,
    reasoningTokens,
    latencyMs,
    ttftMs: Math.round(ttft + network / 2),
    costUsd: costFor(model.id, inputTokens, outputTokens, reasoningTokens),
    model: model.id,
    provider: "simulated",
    simulated: true,
    stopReason,
  };
}

export { INTENTS };
