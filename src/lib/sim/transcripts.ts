import type { Intent, NextAction, Product, RequestedInfo, Sentiment, Transcript, Turn } from "@/lib/domain";
import { transcriptToText } from "@/lib/domain";
import { hashString, pick, rngFrom, shuffle } from "./rng";

const A = (text: string): Turn => ({ speaker: "Agent", text });
const C = (text: string): Turn => ({ speaker: "Customer", text });

function t(
  id: string,
  title: string,
  turns: Turn[],
  intent: Intent,
  product: Product,
  sentiment: Sentiment,
  next_action: NextAction,
  requested_info: RequestedInfo[],
  difficulty: number,
  tags: string[],
  note?: string,
): Transcript {
  return { id, title, turns, labels: { intent, product, sentiment, next_action, requested_info }, difficulty, tags, note };
}

/** Handcrafted examples used in lessons and labs. Each one teaches something. */
export const TRANSCRIPTS: Transcript[] = [
  t("t01", "Rate before commitment", [
    A("Good morning. How can I help you?"),
    C("I am calling regarding a personal loan."),
    A("Are you interested in applying?"),
    C("Yes, but I want to compare the interest rates first."),
    A("Sure, our rates start at 10.75% for salaried customers."),
    C("Okay, please send me the full rate details on email."),
  ], "interested", "personal_loan", "neutral", "send_details", ["interest_rate"], 0.2, ["baseline"],
  "Classic interested-with-a-question. The question does not make it 'unclear'."),

  t("t02", "Already has a loan", [
    A("Hello, this is Rahul from FinServe Bank. You have a pre-approved personal loan offer."),
    C("Thanks, but I already took a loan last month. I don't need another one."),
    A("Understood. Can I help with anything else?"),
    C("No, that's all. Thank you."),
  ], "not_interested", "personal_loan", "neutral", "close_lead", [], 0.1, ["baseline"]),

  t("t03", "Busy — call back later", [
    A("Hi, I'm calling about an upgrade to your credit card."),
    C("I'm in a meeting right now. Can you call me back later?"),
    A("Of course. What time works?"),
    C("Maybe tomorrow, not sure. Just call later."),
  ], "unclear", "credit_card", "neutral", "schedule_callback", [], 0.35, ["callback"],
  "A callback is not a commitment. Guideline 1 says: unclear."),

  t("t04", "Keen home buyer", [
    A("Welcome to FinServe home loans. How may I help?"),
    C("We just finalised a flat in Pune and I want to apply for a home loan as soon as possible."),
    A("Great! Do you know your approximate loan amount?"),
    C("Around 60 lakh. What documents do I need, and am I eligible with a 12 lakh annual salary?"),
    A("I'll send you the checklist and an eligibility estimate right away."),
    C("Perfect, thank you so much!"),
  ], "interested", "home_loan", "positive", "start_application", ["documents", "eligibility"], 0.1, ["baseline"]),

  t("t05", "Sarcastic 'wonderful'", [
    A("Good afternoon! I'm calling with an exclusive personal loan offer for you."),
    C("Oh wonderful, another loan call. Just what I needed today."),
    A("It's a very low rate, sir, only 11%."),
    C("Yeah, amazing. I'll be sure to rush right over. Take me off your list."),
  ], "not_interested", "personal_loan", "negative", "close_lead", [], 0.75, ["sarcasm", "hard"],
  "Positive words, negative meaning. Keyword-based systems and small models often get this wrong."),

  t("t06", "Hinglish car loan enquiry", [
    A("Namaste, FinServe Bank se bol rahi hoon. Aapne car loan ke liye enquiry ki thi?"),
    C("Haan, car loan ke baare mein soch raha tha. 5 lakh pe EMI kitni banegi?"),
    A("5 saal ke liye lagbhag 10,400 rupaye mahina."),
    C("Theek hai, details WhatsApp pe bhej do, main apply karna chahta hoon."),
  ], "interested", "car_loan", "neutral", "send_details", ["emi"], 0.45, ["hinglish"],
  "Code-mixed Hindi-English is common in Indian contact centres. Models vary a lot here."),

  t("t07", "Hidden charges complaint", [
    A("Thank you for calling FinServe. How can I help?"),
    C("I was charged a 999 rupee annual fee on my credit card that nobody told me about. This is cheating."),
    A("I'm sorry about that. Let me check."),
    C("I don't want any new offers. Just reverse the charge or I'm closing the card."),
  ], "not_interested", "credit_card", "negative", "escalate_complaint", ["fees"], 0.3, ["complaint"]),

  t("t08", "Can you match their rate?", [
    A("Hi, I'm calling about your personal loan balance transfer enquiry."),
    C("Yes. Another bank is offering me 10.5%. If you can match that I'll move my loan to you."),
    A("I can check with my manager for a special rate."),
    C("Please do, and send me the offer in writing. I'm ready to switch this month."),
  ], "interested", "personal_loan", "neutral", "send_details", ["interest_rate"], 0.5, ["price-sensitive", "mixed-signals"],
  "Negotiating in order to switch counts as interested (guideline 1)."),

  t("t09", "Spouse answers the phone", [
    A("Hello, may I speak with Mr. Arjun Mehta about his loan offer?"),
    C("This is his wife. He's not at home right now."),
    A("When would be a good time to reach him?"),
    C("I don't know, try in the evening. I can't say if he wants a loan."),
  ], "unclear", "personal_loan", "neutral", "schedule_callback", [], 0.5, ["third-party"]),

  t("t10", "Noisy line", [
    A("Hello? Am I audible? I'm calling from FinServe about the personal loan."),
    C("[inaudible] ... yes yes ... loan ... [crosstalk]"),
    A("Sorry, the line is breaking. Are you interested?"),
    C("Yes ... send me ... details on WhatsApp ... [inaudible]"),
  ], "interested", "personal_loan", "neutral", "send_details", [], 0.6, ["noisy-asr"],
  "Speech-to-text noise. The signal is there but weak — good test of confidence handling."),

  t("t11", "Just checking savings rates", [
    A("FinServe customer care, how can I help?"),
    C("What's the interest rate on your savings account these days?"),
    A("It's 3.5% up to 1 lakh and 4% above that."),
    C("Okay. Just checking, I'm not planning to switch right now."),
  ], "unclear", "savings_account", "neutral", "follow_up", ["interest_rate"], 0.55, ["mixed-signals"],
  "Information-seeking without commitment: 'not right now' is softer than a decline."),

  t("t12", "Already insured", [
    A("Hi, I'm calling about our family health insurance plans."),
    C("Thank you, but I already have a policy through my employer."),
    A("Our plan can top up your cover."),
    C("No, it's fine. I'm covered."),
  ], "not_interested", "insurance", "neutral", "close_lead", [], 0.15, ["baseline"]),

  t("t13", "Card upgrade — excited", [
    A("Congratulations, you're eligible for our Platinum credit card."),
    C("Oh nice! What's the credit limit and do I get cashback on fuel?"),
    A("Limit of 3 lakh and 5% fuel cashback."),
    C("Great, please upgrade my card. Let's do it."),
  ], "interested", "credit_card", "positive", "start_application", ["limit", "cashback"], 0.1, ["baseline"]),

  t("t14", "Not that loan — a home loan", [
    A("Hello, I'm calling with a personal loan offer of up to 10 lakh."),
    C("Not a personal loan. But I'm planning to buy a flat next year."),
    A("We have home loans too."),
    C("Yes, tell me about home loans. What rate would I get?"),
  ], "interested", "home_loan", "neutral", "send_details", ["interest_rate"], 0.6, ["multi-product", "hard"],
  "The agent pitched a personal loan but the customer's interest is a home loan (guideline 3)."),

  t("t15", "Needs to ask spouse", [
    A("Good evening, you enquired about a car loan on our website."),
    C("Yes, we are looking at a new car."),
    A("Would you like to start the application?"),
    C("I'll need to discuss with my husband first. Can I get back to you?"),
  ], "unclear", "car_loan", "neutral", "follow_up", [], 0.5, ["mixed-signals"]),

  t("t16", "Stop calling me", [
    A("Hello sir, personal loan offer for you—"),
    C("Stop calling me! I've told you people five times. I am NOT interested."),
    A("Sorry sir, I'll update our records."),
  ], "not_interested", "personal_loan", "negative", "close_lead", [], 0.05, ["baseline"]),

  t("t17", "Rejected before, trying again", [
    A("Hi, how can I help today?"),
    C("I applied for a personal loan last month and got rejected because of my CIBIL score. It was frustrating."),
    A("I'm sorry to hear that. Your score may have improved."),
    C("It has. Can I apply again? What's the eligibility now?"),
  ], "interested", "personal_loan", "negative", "start_application", ["eligibility"], 0.45, ["mixed-signals"],
  "Negative sentiment but positive intent — sentiment and intent are different dimensions."),

  t("t18", "Two-second call", [
    A("Hello, am I speaking with Ms. Kavya?"),
    C("Not interested. Bye."),
  ], "not_interested", "none", "neutral", "close_lead", [], 0.2, ["short"],
  "No product was ever mentioned, so product = none."),

  t("t19", "Document checklist", [
    A("FinServe home loans, how may I help?"),
    C("My home loan was sanctioned in principle. What documents should I submit for disbursal?"),
    A("Sale agreement, ID proof, and 6 months of bank statements."),
    C("Okay, send me the list on email please."),
  ], "interested", "home_loan", "neutral", "send_details", ["documents"], 0.15, ["baseline"]),

  t("t20", "Too expensive… maybe", [
    A("Your personal loan offer is at 12% for 3 years."),
    C("12% is too high. My friend got 10.5."),
    A("I can try for 11.25%."),
    C("Hmm. If you can do 11 I'll think about it."),
  ], "unclear", "personal_loan", "neutral", "follow_up", ["interest_rate"], 0.65, ["price-sensitive", "mixed-signals", "hard"],
  "Compare with t08: negotiating while promising to switch = interested; 'I'll think about it' = unclear."),

  t("t21", "Hinglish decline", [
    A("Sir, lifetime free credit card ka offer hai aapke liye."),
    C("Nahi chahiye bhai, already do credit cards hai mere paas."),
    A("Ye card bilkul free hai sir."),
    C("Bola na nahi chahiye. Thank you."),
  ], "not_interested", "credit_card", "neutral", "close_lead", [], 0.35, ["hinglish"]),

  t("t22", "Call me after 6", [
    A("Hello, I'm calling about the personal loan you checked on our app."),
    C("I'm driving. Can you call me after 6 pm tomorrow? Then we can discuss."),
    A("Sure, I'll schedule it."),
  ], "unclear", "personal_loan", "neutral", "schedule_callback", [], 0.45, ["callback"],
  "Mild openness, but no explicit commitment -> unclear. Teams often disagree here: a labeling-guideline case."),

  t("t23", "Top-up for existing customer", [
    A("You're eligible for a top-up of 2 lakh on your existing personal loan."),
    C("That's great timing actually, I need money for my daughter's admission."),
    A("Shall I process it?"),
    C("Yes please. How soon will it be disbursed?"),
  ], "interested", "personal_loan", "positive", "start_application", [], 0.2, ["baseline"]),

  t("t24", "Is this really the bank?", [
    A("Sir, to process your pre-approved loan I need your PAN number."),
    C("How do I know this is really the bank? I won't share my PAN on a call."),
    A("You can verify on our app."),
    C("Then I'll check the app myself. I'm not saying yes to anything on the phone."),
  ], "unclear", "personal_loan", "negative", "follow_up", [], 0.55, ["trust", "mixed-signals"]),

  t("t25", "Pre-approved, accepts", [
    A("You have a pre-approved credit card with a 2 lakh limit and no joining fee."),
    C("No joining fee? Then yes, I'll take it."),
    A("Great, I'll send the confirmation link."),
  ], "interested", "credit_card", "positive", "start_application", ["fees"], 0.05, ["baseline"]),

  t("t26", "Student, not eligible", [
    A("Hi, would you like a personal loan of up to 5 lakh?"),
    C("I'm a student, I don't have any income."),
    A("I'm sorry, you'd need a salaried or self-employed income to be eligible."),
    C("Okay then, no. Thanks."),
  ], "not_interested", "personal_loan", "neutral", "close_lead", ["eligibility"], 0.3, ["baseline"]),

  t("t27", "Yes… actually no", [
    A("We can offer you a personal loan at 10.99%."),
    C("Yes, that sounds good actually."),
    A("Great, shall I begin the application?"),
    C("Wait… actually no. My father told me not to take any loans. Sorry."),
  ], "not_interested", "personal_loan", "neutral", "close_lead", [], 0.7, ["mixed-signals", "hard"],
  "Guideline 2: the final stated position wins. Early 'yes' is a trap."),

  t("t28", "Customer reads out PII", [
    A("For the car loan application I need your contact details."),
    C("Sure, my number is 98765 43210 and PAN is ABCDE1234F. Email is ravi.k@example.com."),
    A("Thank you. And the car model?"),
    C("A Maruti Swift, around 7 lakh on-road. Please go ahead with the application."),
  ], "interested", "car_loan", "positive", "start_application", [], 0.2, ["pii"],
  "Contains personal data. A redaction node should run before any LLM sees this."),

  t("t29", "Insurance premium question", [
    A("Hi, calling about term insurance for your family."),
    C("I've been meaning to get one. What would the premium be for 1 crore cover? I'm 34."),
    A("Around 1,100 rupees a month."),
    C("That works. Send me the plan details, I'll buy it this week."),
  ], "interested", "insurance", "neutral", "send_details", ["premium"], 0.25, ["baseline"]),

  t("t30", "Opening a savings account", [
    A("Welcome to FinServe. How can I help?"),
    C("I just moved to Bangalore and want to open a savings account. Can I do it online?"),
    A("Yes, video KYC takes ten minutes."),
    C("Wonderful, that's really convenient. Let's start."),
  ], "interested", "savings_account", "positive", "start_application", [], 0.1, ["baseline"]),
];

// ------------------------------------------------------------------------------------------------
// Benchmark generator: deterministic, labeled-by-construction transcripts for experiments.
// ------------------------------------------------------------------------------------------------

const NAMES = ["Priya", "Rohan", "Ananya", "Vikram", "Sneha", "Arjun", "Meera", "Karan", "Divya", "Imran", "Neha", "Suresh"];
const AGENTS = ["Pooja", "Rahul", "Aisha", "Deepak", "Farah", "Nikhil"];

const PRODUCT_PITCH: Record<Exclude<Product, "none">, string[]> = {
  personal_loan: ["a pre-approved personal loan of up to 8 lakh at {rate}%", "a personal loan offer with instant disbursal"],
  home_loan: ["home loan rates starting at {rate}%", "a home loan balance transfer at {rate}%"],
  car_loan: ["a car loan with up to 90% on-road funding", "a new car loan at {rate}%"],
  credit_card: ["a lifetime-free credit card", "an upgrade to our Platinum credit card"],
  savings_account: ["a zero-balance savings account", "a savings account with 4% interest"],
  insurance: ["a term insurance plan for your family", "a health insurance top-up"],
};

const PRODUCT_WORD: Record<Exclude<Product, "none">, string> = {
  personal_loan: "personal loan",
  home_loan: "home loan",
  car_loan: "car loan",
  credit_card: "credit card",
  savings_account: "savings account",
  insurance: "insurance plan",
};

const INFO_QUESTIONS: Partial<Record<RequestedInfo, string[]>> = {
  interest_rate: ["What's the interest rate?", "What rate would I get?"],
  emi: ["What would the EMI be?", "How much is the monthly EMI?"],
  eligibility: ["Am I eligible?", "What's the eligibility?"],
  documents: ["What documents do you need?", "Which papers should I keep ready?"],
  fees: ["Are there any processing fees?", "Any hidden charges?"],
  limit: ["What's the limit?"],
  premium: ["What's the premium?"],
};

type Style = {
  key: string;
  intent: Intent;
  sentiment: Sentiment;
  next: NextAction;
  difficulty: number;
  tags: string[];
  lines: (p: string) => string[];
};

const STYLES: Style[] = [
  { key: "int-explicit", intent: "interested", sentiment: "positive", next: "start_application", difficulty: 0.08, tags: ["baseline"],
    lines: (p) => [`That's great, I've been looking for a ${p}.`, "Please go ahead and start the application."] },
  { key: "int-details", intent: "interested", sentiment: "neutral", next: "send_details", difficulty: 0.18, tags: ["baseline"],
    lines: (p) => [`Okay, the ${p} sounds useful.`, "Send me the details on email and I'll apply."] },
  { key: "int-hedged", intent: "interested", sentiment: "neutral", next: "send_details", difficulty: 0.45, tags: ["mixed-signals"],
    lines: (p) => [`Hmm, a ${p}... I did need one.`, "If the numbers are reasonable I'll go ahead. Send it over."] },
  { key: "int-hinglish", intent: "interested", sentiment: "neutral", next: "send_details", difficulty: 0.45, tags: ["hinglish"],
    lines: (p) => [`Haan, ${p} chahiye tha actually.`, "Details bhej do, main apply kar dunga."] },
  { key: "int-noisy", intent: "interested", sentiment: "neutral", next: "send_details", difficulty: 0.6, tags: ["noisy-asr"],
    lines: (p) => [`[inaudible] ... ${p} ... yes`, "yes send ... details ... [crosstalk] ... okay"] },
  { key: "not-explicit", intent: "not_interested", sentiment: "neutral", next: "close_lead", difficulty: 0.06, tags: ["baseline"],
    lines: (p) => [`No thanks, I'm not interested in a ${p}.`, "Please don't call again for this."] },
  { key: "not-already", intent: "not_interested", sentiment: "neutral", next: "close_lead", difficulty: 0.2, tags: ["baseline"],
    lines: (p) => [`I already have a ${p} with another bank.`, "Not needed, thank you."] },
  { key: "not-angry", intent: "not_interested", sentiment: "negative", next: "close_lead", difficulty: 0.1, tags: ["baseline"],
    lines: () => ["This is the third call this week! Stop calling me.", "I am not interested, take my number off your list."] },
  { key: "not-sarcasm", intent: "not_interested", sentiment: "negative", next: "close_lead", difficulty: 0.75, tags: ["sarcasm", "hard"],
    lines: (p) => [`Oh fantastic, a ${p}. Exactly what my life was missing.`, "Sure, I'll get right on that. Goodbye."] },
  { key: "not-flip", intent: "not_interested", sentiment: "neutral", next: "close_lead", difficulty: 0.7, tags: ["mixed-signals", "hard"],
    lines: () => ["Yes, sounds interesting actually.", "Actually no, I just remembered I can't take this on now. Sorry, no."] },
  { key: "not-hinglish", intent: "not_interested", sentiment: "neutral", next: "close_lead", difficulty: 0.35, tags: ["hinglish"],
    lines: () => ["Nahi chahiye, thank you.", "Already hai mere paas, zarurat nahi hai."] },
  { key: "unc-callback", intent: "unclear", sentiment: "neutral", next: "schedule_callback", difficulty: 0.35, tags: ["callback"],
    lines: () => ["I'm driving right now.", "Call me back later, we'll see."] },
  { key: "unc-think", intent: "unclear", sentiment: "neutral", next: "follow_up", difficulty: 0.55, tags: ["mixed-signals"],
    lines: (p) => [`A ${p}... maybe. I'm not sure.`, "Let me think about it and get back to you."] },
  { key: "unc-third", intent: "unclear", sentiment: "neutral", next: "schedule_callback", difficulty: 0.5, tags: ["third-party"],
    lines: () => ["This is his brother, he's not at home.", "I can't say whether he wants it. Try in the evening."] },
  { key: "unc-trust", intent: "unclear", sentiment: "negative", next: "follow_up", difficulty: 0.55, tags: ["trust"],
    lines: () => ["How do I know this call is genuine?", "I won't decide anything on the phone. I'll check your app."] },
  { key: "unc-price", intent: "unclear", sentiment: "neutral", next: "follow_up", difficulty: 0.65, tags: ["price-sensitive", "mixed-signals", "hard"],
    lines: () => ["That rate is too high for me.", "If it comes down a lot, maybe I'll consider it."] },
];

const STYLE_WEIGHTS: Record<string, number> = {
  "int-explicit": 3, "int-details": 3, "int-hedged": 2, "int-hinglish": 1.5, "int-noisy": 1,
  "not-explicit": 3, "not-already": 2.5, "not-angry": 1.5, "not-sarcasm": 1, "not-flip": 1, "not-hinglish": 1,
  "unc-callback": 2, "unc-think": 2, "unc-third": 1, "unc-trust": 1, "unc-price": 1,
};

function generateOne(i: number, seed: number): Transcript {
  const rng = rngFrom("bench", seed, i);
  // weighted style
  const entries = STYLES.map((s) => ({ s, w: STYLE_WEIGHTS[s.key] ?? 1 }));
  const total = entries.reduce((a, b) => a + b.w, 0);
  let r = rng() * total;
  let style = STYLES[0];
  for (const e of entries) {
    r -= e.w;
    if (r <= 0) {
      style = e.s;
      break;
    }
  }
  const products = Object.keys(PRODUCT_PITCH) as Exclude<Product, "none">[];
  const product = pick(rng, products);
  const rate = (9.5 + Math.floor(rng() * 8) * 0.25).toFixed(2);
  const pitch = pick(rng, PRODUCT_PITCH[product]).replace("{rate}", rate);
  const name = pick(rng, NAMES);
  const agent = pick(rng, AGENTS);
  const word = PRODUCT_WORD[product];

  const turns: Turn[] = [
    A(`Hello, this is ${agent} from FinServe Bank. Am I speaking with ${name}?`),
    C(style.key === "unc-third" ? "Hello? Who is this?" : pick(rng, ["Yes, speaking.", "Haan, bolo.", "Yes, who's this?"])),
    A(`I'm calling to tell you about ${pitch}.`),
  ];

  const requested: RequestedInfo[] = [];
  const [l1, l2] = style.lines(word);
  turns.push(C(l1));
  // interested / hedged customers sometimes ask a question
  if (style.intent !== "not_interested" && !style.key.includes("third") && !style.key.includes("noisy") && rng() < 0.55) {
    const opts = (Object.keys(INFO_QUESTIONS) as RequestedInfo[]).filter((k) => {
      if (k === "limit") return product === "credit_card";
      if (k === "premium") return product === "insurance";
      if (k === "emi" || k === "interest_rate") return product.includes("loan") || (k === "interest_rate" && product === "savings_account");
      return true;
    });
    const info = pick(rng, opts);
    requested.push(info);
    turns.push(A("Sure, happy to help with any questions."));
    turns.push(C(pick(rng, INFO_QUESTIONS[info] ?? ["Tell me more."])));
    turns.push(A("I'll share all of that with you."));
  } else {
    turns.push(A(style.intent === "not_interested" ? "Are you sure? It's a limited-period offer." : "Would you like to proceed?"));
  }
  turns.push(C(l2));

  const next: NextAction = style.next === "send_details" && requested.length === 0 && style.key === "int-explicit" ? "start_application" : style.next;
  return {
    id: `b${String(i + 1).padStart(3, "0")}`,
    title: `${word} · ${style.key}`,
    turns,
    labels: { intent: style.intent, product, sentiment: style.sentiment, next_action: next, requested_info: requested },
    difficulty: Math.min(0.95, Math.max(0.02, style.difficulty + (rng() - 0.5) * 0.1)),
    tags: [...style.tags, product],
    note: undefined,
  };
}

let benchCache: Transcript[] | null = null;
/** 120 generated transcripts, labeled by construction. Stable across sessions (seeded). */
export function getBenchmark(n = 120, seed = 7): Transcript[] {
  if (benchCache && benchCache.length === n && seed === 7) return benchCache;
  const out = Array.from({ length: n }, (_, i) => generateOne(i, seed));
  if (seed === 7 && n === 120) benchCache = out;
  return out;
}

/** A shuffled split of handcrafted + generated examples for the capstone. */
export function getCapstoneSet(): Transcript[] {
  const rng = rngFrom("capstone-split");
  const hard = TRANSCRIPTS;
  const gen = getBenchmark().slice(60, 90);
  return shuffle(rng, [...hard, ...gen]);
}

export function findTranscript(id: string): Transcript | undefined {
  return TRANSCRIPTS.find((x) => x.id === id) ?? getBenchmark().find((x) => x.id === id);
}

/** Oracle lookup: the simulated model "knows" gold labels only for unmodified known transcripts. */
const oracleIndex = new Map<number, Transcript>();
function buildOracle() {
  if (oracleIndex.size) return;
  for (const x of [...TRANSCRIPTS, ...getBenchmark()]) oracleIndex.set(hashString(normalizeForHash(transcriptToText(x))), x);
}
function normalizeForHash(s: string) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}
export function lookupKnownTranscript(text: string): Transcript | undefined {
  buildOracle();
  return oracleIndex.get(hashString(normalizeForHash(text)));
}
