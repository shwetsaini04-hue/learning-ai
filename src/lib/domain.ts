/** Transcript-analysis domain: label taxonomy shared by every lab. */

export const INTENTS = ["interested", "not_interested", "unclear"] as const;
export type Intent = (typeof INTENTS)[number];

export const PRODUCTS = [
  "personal_loan",
  "home_loan",
  "car_loan",
  "credit_card",
  "savings_account",
  "insurance",
  "none",
] as const;
export type Product = (typeof PRODUCTS)[number];

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const NEXT_ACTIONS = [
  "send_details",
  "start_application",
  "schedule_callback",
  "follow_up",
  "close_lead",
  "escalate_complaint",
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export const REQUESTED_INFO = [
  "interest_rate",
  "emi",
  "eligibility",
  "documents",
  "fees",
  "limit",
  "cashback",
  "premium",
  "tenure",
] as const;
export type RequestedInfo = (typeof REQUESTED_INFO)[number];

export interface Turn {
  speaker: "Agent" | "Customer";
  text: string;
}

export interface TranscriptLabels {
  intent: Intent;
  product: Product;
  sentiment: Sentiment;
  next_action: NextAction;
  requested_info: RequestedInfo[];
}

export interface Transcript {
  id: string;
  title: string;
  turns: Turn[];
  labels: TranscriptLabels;
  /** 0 = trivial, 1 = very hard (sarcasm, contradictions, noise...) */
  difficulty: number;
  tags: string[];
  /** why this example is interesting / how it was labeled */
  note?: string;
}

export const LABELING_GUIDELINES = `Labeling guidelines (v2)
1. intent = the customer's interest in the product being discussed.
   - interested: an explicit positive signal — asks to apply, asks for details to be sent,
     or negotiates in order to switch.
   - not_interested: an explicit decline, a do-not-call request, or accepting ineligibility.
   - unclear: no explicit commitment — callbacks, "I'll think about it", a third party
     answering, suspicion, or information-seeking without intent.
2. If the customer changes their mind, the FINAL stated position wins.
3. product = the product the customer's decision is about (not merely what the agent pitched).
   Use "none" if no product is discussed.
4. sentiment = the customer's overall tone, not the agent's.`;

export const INTENT_DESCRIPTIONS: Record<Intent, string> = {
  interested: "Explicit positive signal: wants details, wants to apply, or negotiates to switch.",
  not_interested: "Explicit decline, do-not-call, or accepts they are not eligible.",
  unclear: "No explicit commitment: callback, 'will think', third party, suspicion.",
};

export const PRODUCT_LABELS: Record<Product, string> = {
  personal_loan: "Personal loan",
  home_loan: "Home loan",
  car_loan: "Car loan",
  credit_card: "Credit card",
  savings_account: "Savings account",
  insurance: "Insurance",
  none: "None",
};

export function transcriptToText(t: { turns: Turn[] }) {
  return t.turns.map((x) => `${x.speaker}: ${x.text}`).join("\n");
}

export function parseTranscriptText(text: string): Turn[] {
  const turns: Turn[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(agent|customer|a|c)\s*:\s*(.*)$/i);
    if (m) {
      const who = m[1].toLowerCase().startsWith("a") ? "Agent" : "Customer";
      turns.push({ speaker: who, text: m[2] });
    } else if (turns.length) {
      turns[turns.length - 1].text += " " + line;
    } else {
      turns.push({ speaker: "Customer", text: line });
    }
  }
  return turns;
}
