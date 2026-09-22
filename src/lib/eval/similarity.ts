/**
 * Text comparison metrics, from strictest to most lenient.
 *
 * NOTE on "semantic similarity": real systems embed both texts with an
 * embedding model and take cosine similarity. Here we use a transparent
 * concept-lexicon vector so you can SEE why two sentences are "close".
 * The behaviour (paraphrases score high, exact match fails) is the same idea.
 */

const STOP = new Set(
  "a an the is are was were be been to of in on for and or but it its this that with as at by from i you he she they we me my our your their them his her do does did has have had will would can could should shall may might am about into than then so just also".split(
    " ",
  ),
);

export function normalizeText(s: string) {
  return s
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string) {
  return normalizeText(s).split(" ").filter(Boolean);
}

export function contentTokens(s: string) {
  return tokens(s).filter((t) => !STOP.has(t));
}

export function exactMatch(expected: string, actual: string) {
  return expected === actual ? 1 : 0;
}

const LABEL_SYNONYMS: Record<string, string> = {
  "not interested": "not_interested",
  "not_interested": "not_interested",
  "uninterested": "not_interested",
  "declined": "not_interested",
  "interested": "interested",
  "unclear": "unclear",
  "undecided": "unclear",
  "unsure": "unclear",
};

/** Case/whitespace/punctuation-insensitive match, plus label synonyms. */
export function normalizedMatch(expected: string, actual: string) {
  const a = normalizeText(expected);
  const b = normalizeText(actual);
  if (a === b) return 1;
  const la = LABEL_SYNONYMS[a];
  const lb = LABEL_SYNONYMS[b];
  return la && lb && la === lb ? 1 : 0;
}

/** SQuAD-style token overlap F1. */
export function tokenF1(expected: string, actual: string) {
  const e = contentTokens(expected);
  const a = contentTokens(actual);
  if (!e.length && !a.length) return { f1: 1, precision: 1, recall: 1, common: [] as string[] };
  if (!e.length || !a.length) return { f1: 0, precision: 0, recall: 0, common: [] as string[] };
  const counts = new Map<string, number>();
  e.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
  const common: string[] = [];
  a.forEach((t) => {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      common.push(t);
      counts.set(t, c - 1);
    }
  });
  const precision = common.length / a.length;
  const recall = common.length / e.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { f1, precision, recall, common };
}

/** ROUGE-L F-measure via longest common subsequence over tokens. */
export function rougeL(expected: string, actual: string) {
  const e = tokens(expected);
  const a = tokens(actual);
  if (!e.length || !a.length) return 0;
  const dp = Array.from({ length: e.length + 1 }, () => new Array<number>(a.length + 1).fill(0));
  for (let i = 1; i <= e.length; i++)
    for (let j = 1; j <= a.length; j++)
      dp[i][j] = e[i - 1] === a[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const lcs = dp[e.length][a.length];
  const p = lcs / a.length;
  const r = lcs / e.length;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

// ---- concept lexicon ------------------------------------------------------------------------

const CONCEPTS: { id: string; phrases: string[] }[] = [
  { id: "DECLINE", phrases: ["not interested", "no thanks", "doesnt want", "does not want", "do not want", "dont want", "declined", "declines", "refused", "rejects", "rejected the offer", "not_interested", "turned down", "no need", "not needed"] },
  { id: "UNCERTAIN", phrases: ["unclear", "unsure", "undecided", "not sure", "maybe", "think about", "hasnt decided", "has not decided", "did not commit", "no commitment", "on the fence", "hesitant", "might"] },
  { id: "INTEREST", phrases: ["interested", "wants", "want", "keen", "looking for", "would like", "eager", "open to", "willing", "plans to", "intends", "likely to"] },
  { id: "INFO", phrases: ["more information", "information", "details", "know more", "learn more", "more about", "find out", "asked about", "enquired", "inquired", "questions", "explore", "compare"] },
  { id: "RATE", phrases: ["interest rate", "rates", "rate", "pricing", "price", "apr", "cost"] },
  { id: "APPLY", phrases: ["apply", "application", "sign up", "proceed", "go ahead", "get", "getting", "take", "obtain"] },
  { id: "CALLBACK", phrases: ["call back", "callback", "call later", "call again", "reach out later"] },
  { id: "PERSONAL_LOAN", phrases: ["personal loan", "loan"] },
  { id: "HOME_LOAN", phrases: ["home loan", "mortgage", "housing loan"] },
  { id: "CAR_LOAN", phrases: ["car loan", "auto loan", "vehicle loan"] },
  { id: "CARD", phrases: ["credit card", "card"] },
  { id: "CUSTOMER", phrases: ["customer", "caller", "client", "they", "he", "she"] },
  { id: "YES", phrases: ["yes", "yeah", "affirmative", "correct"] },
  { id: "NO", phrases: ["no", "nope", "negative"] },
];

export interface ConceptVector {
  vec: Map<string, number>;
  concepts: string[];
}

export function conceptVector(s: string): ConceptVector {
  let text = ` ${normalizeText(s).replace(/'/g, "")} `;
  const vec = new Map<string, number>();
  const concepts: string[] = [];
  // longest phrases first so "not interested" wins over "interested"
  const all = CONCEPTS.flatMap((c) => c.phrases.map((p) => ({ id: c.id, p }))).sort((a, b) => b.p.length - a.p.length);
  for (const { id, p } of all) {
    const needle = ` ${p} `;
    while (text.includes(needle)) {
      text = text.replace(needle, " ");
      vec.set(id, (vec.get(id) ?? 0) + 1);
      if (!concepts.includes(id)) concepts.push(id);
    }
  }
  for (const tok of text.split(" ").filter((t) => t && !STOP.has(t))) {
    const key = `w:${tok.replace(/(ing|ed|s)$/, "")}`;
    vec.set(key, (vec.get(key) ?? 0) + 0.35);
  }
  return { vec, concepts };
}

function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((v, k) => {
    na += v * v;
    const w = b.get(k);
    if (w) dot += v * w;
  });
  b.forEach((v) => (nb += v * v));
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

export function semanticSimilarity(expected: string, actual: string) {
  const a = conceptVector(expected);
  const b = conceptVector(actual);
  let score = cosine(a.vec, b.vec);
  // opposite stances are far apart even if they share words
  const stance = (c: string[]) => (c.includes("DECLINE") ? "neg" : c.includes("UNCERTAIN") ? "unc" : c.includes("INTEREST") || c.includes("YES") ? "pos" : c.includes("NO") ? "neg" : null);
  const sa = stance(a.concepts);
  const sb = stance(b.concepts);
  if (sa && sb && sa !== sb) score *= sa === "unc" || sb === "unc" ? 0.6 : 0.3;
  return { score: Math.max(0, Math.min(1, score)), expectedConcepts: a.concepts, actualConcepts: b.concepts, stance: { expected: sa, actual: sb } };
}

/** Claim-level groundedness: which sentences are supported by the source? */
export interface ClaimCheck {
  claim: string;
  supported: boolean;
  reason: string;
  overlap: number;
}

export function splitClaims(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

export function checkGroundedness(answer: string, source: string): ClaimCheck[] {
  const srcNorm = normalizeText(source);
  const srcTokens = new Set(contentTokens(source).map((t) => t.replace(/(ing|ed|s)$/, "")));
  return splitClaims(answer).map((claim) => {
    if (/^next step\b/i.test(claim)) return { claim, supported: true, reason: "A recommendation, not a factual claim about the call", overlap: 1 };
    const numbers = claim.match(/\d+(?:[.,]\d+)?/g) ?? [];
    const missingNumbers = numbers.filter((n) => !srcNorm.includes(n.replace(",", "")) && !source.includes(n));
    const days = claim.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)\b/gi) ?? [];
    const missingDays = days.filter((d) => !srcNorm.includes(d.toLowerCase()));
    const ct = contentTokens(claim).map((t) => t.replace(/(ing|ed|s)$/, ""));
    const overlap = ct.length ? ct.filter((t) => srcTokens.has(t)).length / ct.length : 0;
    if (missingNumbers.length) return { claim, supported: false, reason: `Number(s) ${missingNumbers.join(", ")} never appear in the transcript`, overlap };
    if (missingDays.length) return { claim, supported: false, reason: `Time reference "${missingDays.join(", ")}" never appears in the transcript`, overlap };
    if (/\bconfirmed\b|\bagreed to\b|\bscheduled\b|\bapproved\b/i.test(claim) && overlap < 0.5)
      return { claim, supported: false, reason: "Asserts a commitment/confirmation with little support in the transcript", overlap };
    if (overlap < 0.25) return { claim, supported: false, reason: "Very little lexical overlap with the transcript", overlap };
    return { claim, supported: true, reason: overlap > 0.6 ? "Closely matches transcript content" : "Paraphrases transcript content", overlap };
  });
}
