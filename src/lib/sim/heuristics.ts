import type { Intent, NextAction, Product, RequestedInfo, Sentiment, TranscriptLabels } from "@/lib/domain";

/**
 * A deliberately simple rule-based analyzer. The simulated LLM uses it as its
 * "understanding" of text it has never seen (custom transcripts you type in).
 * It has realistic blind spots on purpose (e.g. sarcasm) — a nice reminder of
 * why keyword rules were replaced by LLMs, and why LLMs still need evaluation.
 */

const PRODUCT_PATTERNS: [Product, RegExp][] = [
  ["home_loan", /\bhome\s*loans?\b|\bhousing loan\b|\bflat\b|\bmortgage\b/i],
  ["car_loan", /\bcar\s*loans?\b|\bauto loan\b|\bvehicle loan\b|\bnew car\b/i],
  ["credit_card", /\bcredit\s*cards?\b|\bcard upgrade\b|\bplatinum card\b/i],
  ["savings_account", /\bsavings?\s*account\b|\bzero[- ]balance\b/i],
  ["insurance", /\binsurance\b|\bpolicy\b|\bpremium\b|\bterm plan\b|\bcover\b/i],
  ["personal_loan", /\bpersonal\s*loans?\b|\btop[- ]?up\b|\bbalance transfer\b|\bloan\b/i],
];

const POSITIVE_INTENT = [
  /\binterested\b(?!.*\bnot\b)/i,
  /\bsend (me )?(the )?(full )?(rate )?details\b/i,
  /\bsend me\b/i,
  /\bhow (do|can) i apply\b/i,
  /\b(i('| a)m|i am) ready\b/i,
  /\bgo ahead\b/i,
  /\blet'?s (do it|start)\b/i,
  /\bsign me up\b/i,
  /\bi'?ll take it\b/i,
  /\bapply\b/i,
  /\byes,? please\b/i,
  /\bplease (upgrade|process|do)\b/i,
  /\bbhej do\b/i,
  /\bapply kar/i,
  /\bchahiye tha\b/i,
  /\bi'?ll buy\b/i,
  /\bswitch\b/i,
];

const NEGATIVE_INTENT = [
  /\bnot interested\b/i,
  /\bno,? thanks?\b/i,
  /\bdon'?t need\b/i,
  /\bnot needed\b/i,
  /\bstop calling\b/i,
  /\btake (me|my number) off\b/i,
  /\bnahi chahiye\b/i,
  /\bzarurat nahi\b/i,
  /\balready (have|took|hai)\b/i,
  /\bactually no\b/i,
  /\bokay then,? no\b/i,
  /\bdon'?t call\b/i,
  /\bi'?m covered\b/i,
];

const UNCLEAR_INTENT = [
  /\bcall (me )?(back )?later\b/i,
  /\bcall me (back|after)\b/i,
  /\bthink about it\b/i,
  /\bget back to you\b/i,
  /\bdiscuss with\b/i,
  /\bnot at home\b/i,
  /\bnot sure\b/i,
  /\bmaybe\b/i,
  /\bhow do i know\b/i,
  /\bjust checking\b/i,
  /\bnot planning\b/i,
  /\bi can'?t say\b/i,
  /\bin a meeting\b/i,
  /\bdriving\b/i,
  /\bwe'?ll see\b/i,
];

const POS_SENT = /\b(great|nice|perfect|wonderful|thank you so much|convenient|love|excellent|good timing|sounds good)\b/i;
const NEG_SENT = /\b(stop|cheating|frustrat|angry|annoy|hidden charge|too high|rejected|won'?t share|third call|not interested!|told you)\b/i;
const SARCASM = /(just what i needed|exactly what my life|i'?ll be sure to rush|oh (wonderful|fantastic|great), (another|a)\b|sure, i'?ll get right on)/i;

const INFO_PATTERNS: [RequestedInfo, RegExp][] = [
  ["interest_rate", /\b(interest )?rates?\b|\brate would\b/i],
  ["emi", /\bemi\b/i],
  ["eligibility", /\beligib|\bcibil\b/i],
  ["documents", /\bdocuments?\b|\bpapers\b|\bchecklist\b/i],
  ["fees", /\bfees?\b|\bcharges?\b|\bjoining fee\b/i],
  ["limit", /\blimit\b/i],
  ["cashback", /\bcashback\b/i],
  ["premium", /\bpremium\b/i],
  ["tenure", /\btenure\b/i],
];

function customerLines(text: string): string[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const cust = lines.filter((l) => /^customer\s*:/i.test(l)).map((l) => l.replace(/^customer\s*:\s*/i, ""));
  return cust.length ? cust : lines;
}

export interface HeuristicAnalysis extends TranscriptLabels {
  /** 0..1 how clear the signal was — drives simulated difficulty & confidence */
  clarity: number;
  cues: string[];
}

export function analyzeTranscript(text: string): HeuristicAnalysis {
  const cust = customerLines(text);
  const all = text;
  const cues: string[] = [];

  // Intent: later customer lines weigh more (final position wins)
  let pos = 0;
  let neg = 0;
  let unc = 0;
  cust.forEach((line, i) => {
    const w = 1 + i * 0.8;
    if (POSITIVE_INTENT.some((r) => r.test(line)) && !NEGATIVE_INTENT.some((r) => r.test(line))) {
      pos += w;
      cues.push(`+interest: "${line.slice(0, 60)}"`);
    }
    if (NEGATIVE_INTENT.some((r) => r.test(line))) {
      neg += w * 1.2;
      cues.push(`-interest: "${line.slice(0, 60)}"`);
    }
    if (UNCLEAR_INTENT.some((r) => r.test(line))) {
      unc += w;
      cues.push(`?unclear: "${line.slice(0, 60)}"`);
    }
  });
  let intent: Intent = "unclear";
  const max = Math.max(pos, neg, unc);
  if (max === 0) intent = "unclear";
  else if (max === neg) intent = "not_interested";
  else if (max === pos) intent = "interested";
  else intent = "unclear";
  const sorted = [pos, neg, unc].sort((a, b) => b - a);
  const margin = sorted[0] === 0 ? 0 : (sorted[0] - sorted[1]) / (sorted[0] + 1);
  let clarity = Math.min(1, 0.35 + margin * 0.9);
  if (/\[inaudible\]|\[crosstalk\]/i.test(all)) clarity -= 0.2;
  // note: the heuristic does NOT detect sarcasm for intent (a deliberate blind spot)
  const sarcastic = SARCASM.test(all);
  if (sarcastic) {
    cues.push("tone: possible sarcasm");
    clarity -= 0.15;
  }

  // Product: prefer the last product the customer mentions, else first mentioned overall
  let product: Product = "none";
  for (const line of [...cust].reverse()) {
    const hit = PRODUCT_PATTERNS.find(([, r]) => r.test(line));
    if (hit) {
      product = hit[0];
      break;
    }
  }
  if (product === "none") {
    const hit = PRODUCT_PATTERNS.find(([, r]) => r.test(all));
    if (hit) product = hit[0];
  }

  // Sentiment
  const custText = cust.join(" ");
  let sentiment: Sentiment = "neutral";
  if (NEG_SENT.test(custText) || sarcastic) sentiment = "negative";
  else if (POS_SENT.test(custText)) sentiment = "positive";

  const requested_info = INFO_PATTERNS.filter(([, r]) => r.test(custText)).map(([k]) => k);

  let next_action: NextAction = "follow_up";
  if (/complain|reverse the charge|cheating/i.test(custText)) next_action = "escalate_complaint";
  else if (intent === "not_interested") next_action = "close_lead";
  else if (intent === "unclear" && /call (me )?(back|later|after)|evening|not at home/i.test(custText)) next_action = "schedule_callback";
  else if (intent === "interested" && /send|email|whatsapp|bhej/i.test(custText)) next_action = "send_details";
  else if (intent === "interested") next_action = "start_application";

  return {
    intent,
    product,
    sentiment,
    requested_info,
    next_action,
    clarity: Math.max(0.05, Math.min(1, clarity)),
    cues,
  };
}

/** Simple PII redaction used by the "redact_pii" function node. */
export function redactPII(text: string) {
  return text
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[PAN]")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[EMAIL]")
    .replace(/\b(\+91[- ]?)?\d{5}[- ]?\d{5}\b/g, "[PHONE]")
    .replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, "[AADHAAR]");
}

export function cleanTranscript(text: string) {
  return text
    .replace(/\b(umm+|uhh*|hmm+|erm)\b[,.]?\s*/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
