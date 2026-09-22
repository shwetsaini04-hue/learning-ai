// End-to-end smoke test with a locally installed Chrome/Edge (no browser download).
// Usage: node scripts/e2e.mjs [baseUrl] [screenshotDir]
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "e2e-screenshots";
fs.mkdirSync(OUT, { recursive: true });

const candidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];
const executablePath = candidates.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error("No local Chrome/Edge found");
  process.exit(2);
}

const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource.*404/.test(m.text())) errors.push(`${page.url()} :: ${m.text()}`);
  });
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
const clickText = (page, text, opts = {}) => page.getByRole("button", { name: text, exact: opts.exact ?? true }).first().click();

try {
  // ---------------------------------------------------------------- pages render without errors
  const page = await newPage();
  const routes = [
    "/",
    "/learn",
    "/learn/langgraph",
    "/learn/evaluation",
    "/learn/langgraph/a1-llm-apps",
    "/learn/langgraph/a1-structured-output",
    "/learn/langgraph/a1-patterns",
    "/learn/langgraph/a2-why-langgraph",
    "/learn/langgraph/a2-mental-model",
    "/learn/langgraph/a3-state",
    "/learn/langgraph/a3-nodes-edges",
    "/learn/langgraph/a3-routing",
    "/learn/langgraph/a3-loops",
    "/learn/langgraph/a3-parallel",
    "/learn/langgraph/a3-persistence",
    "/learn/langgraph/a3-hitl",
    "/learn/langgraph/a3-agents",
    "/learn/langgraph/a4-ladder",
    "/learn/langgraph/a4-debugging",
    "/learn/evaluation/b1-why-eval",
    "/learn/evaluation/b1-ground-truth",
    "/learn/evaluation/b2-correctness-relevance",
    "/learn/evaluation/b2-groundedness",
    "/learn/evaluation/b2-structured-consistency",
    "/learn/evaluation/b2-classification-metrics",
    "/learn/evaluation/b3-exact-semantic",
    "/learn/evaluation/b3-llm-judge",
    "/learn/evaluation/b3-regression",
    "/learn/evaluation/b4-cost",
    "/learn/evaluation/b4-latency",
    "/learn/evaluation/b4-observability",
    "/learn/evaluation/b4-production-loop",
    "/learn/langgraph/assessment/a1",
    "/learn/evaluation/assessment/b3",
    "/lab/playground",
    "/lab/transcripts",
    "/lab/debug",
    "/lab/eval",
    "/lab/datasets",
    "/lab/experiments",
    "/lab/models",
    "/lab/cost",
    "/lab/latency",
    "/capstone",
    "/glossary",
    "/settings",
  ];
  for (const r of routes) {
    const before = errors.length;
    const res = await page.goto(BASE + r, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const h1 = await page.locator("h1").first().textContent().catch(() => null);
    check(`render ${r}`, res.status() === 200 && errors.length === before && !!h1, `${res.status()} "${(h1 ?? "").slice(0, 50)}"${errors.length > before ? " ERR: " + errors.slice(before).join(" | ").slice(0, 200) : ""}`);
  }
  await page.goto(BASE + "/");
  await shot(page, "01-dashboard-dark");

  // ---------------------------------------------------------------- playground: debug challenge end to end
  await page.goto(BASE + "/lab/playground?challenge=dbg-prose", { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__edge-path", { timeout: 8000 });
  check("playground renders edges", (await page.locator(".react-flow__edge").count()) === 3);
  await clickText(page, "Run");
  await page.getByText("OutputParserException").first().waitFor({ timeout: 8000 });
  check("challenge reproduces OutputParserException", true);
  await shot(page, "02-playground-error");
  await page.locator(".react-flow__node", { hasText: "Classify intent" }).click();
  await page.getByRole("button", { name: "V3", exact: true }).first().click();
  await page.getByRole("tab", { name: "Challenge" }).click();
  await page.getByRole("button", { name: "4. Verify fix" }).click();
  await page.getByText("All checks passed ✓").waitFor({ timeout: 10000 });
  check("challenge fix verifies", true);
  await clickText(page, "Run");
  await page.waitForTimeout(3500);
  check("fixed graph runs to success", (await page.locator("text=success").count()) > 0);
  await shot(page, "03-playground-fixed");

  // ---------------------------------------------------------------- playground: add + delete node, python export tab
  await page.goto(BASE + "/lab/playground?template=routing", { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__edge-path", { timeout: 8000 });
  const n0 = await page.locator(".react-flow__node").count();
  await page.getByRole("button", { name: "Add Sentiment" }).click();
  await page.waitForTimeout(300);
  const n1 = await page.locator(".react-flow__node").count();
  check("palette adds a node", n1 === n0 + 1, `${n0} → ${n1}`);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(300);
  check("Delete key removes selected node", (await page.locator(".react-flow__node").count()) === n0);
  await page.getByRole("tab", { name: "Python" }).click();
  check("python export shows StateGraph", (await page.locator("text=builder = StateGraph(State)").count()) > 0);
  await shot(page, "04-playground-python");

  // ---------------------------------------------------------------- transcript lab: human in the loop
  await page.goto(BASE + "/lab/transcripts", { waitUntil: "networkidle" });
  await page.locator("select").filter({ hasText: "t01" }).first().selectOption("t03");
  await clickText(page, "Run");
  await page.getByText("waiting for a human").waitFor({ timeout: 15000 });
  check("transcript lab pauses for human review", true);
  await shot(page, "05-transcript-review");
  await page.getByRole("button", { name: /Approve & resume|Resume with correction/ }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("tab", { name: "Final output" }).click();
  check("resumed run produces final output", (await page.locator("text=review_status").count()) > 0);

  // ---------------------------------------------------------------- experiments
  await page.goto(BASE + "/lab/experiments", { waitUntil: "networkidle" });
  await page.getByText("select all (prompt comparison)").click();
  await page.getByRole("button", { name: /Run \d experiments?/ }).click();
  await page.getByText("Macro F1").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const rows = await page.locator("tbody tr").count();
  check("prompt comparison creates experiments", rows >= 4, `${rows} rows`);
  await shot(page, "06-experiments");

  // ---------------------------------------------------------------- lessons: quiz + reducer sim
  await page.goto(BASE + "/learn/langgraph/a3-state", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Run super-step 1" }).click();
  check("reducer sim shows InvalidUpdateError", (await page.locator("text=InvalidUpdateError").count()) > 0);
  await page.getByRole("button", { name: "Mark complete" }).click();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  check("progress persists to dashboard", (await page.locator("text=1/15").count()) > 0);

  // ---------------------------------------------------------------- light theme + mobile
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.waitForTimeout(300);
  await shot(page, "07-dashboard-light");
  const mobile = await newPage({ width: 390, height: 844 });
  await mobile.goto(BASE + "/learn/langgraph/a2-mental-model", { waitUntil: "networkidle" });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("mobile lesson has no horizontal page scroll", overflow <= 1, `${overflow}px`);
  await shot(mobile, "08-mobile-lesson");
  await mobile.goto(BASE + "/lab/playground", { waitUntil: "networkidle" });
  const overflow2 = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("mobile playground has no horizontal page scroll", overflow2 <= 1, `${overflow2}px`);
  await shot(mobile, "09-mobile-playground");
  await mobile.goto(BASE + "/", { waitUntil: "networkidle" });
  const overflow3 = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("mobile dashboard has no horizontal page scroll", overflow3 <= 1, `${overflow3}px`);
  await shot(mobile, "10-mobile-dashboard");

  // ---------------------------------------------------------------- api
  const cfg = await (await fetch(BASE + "/api/config")).json();
  check("GET /api/config exposes no secrets", !JSON.stringify(cfg).match(/sk-|key"/i), JSON.stringify(cfg).slice(0, 120));
  const llm = await fetch(BASE + "/api/llm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-5.4-mini", prompt: "hi" }) });
  check("POST /api/llm refuses when live mode is not configured", llm.status === 503 || llm.status === 400, String(llm.status));
} catch (e) {
  check("e2e script", false, e.message.split("\n")[0]);
}

await browser.close();
if (errors.length) {
  console.log("\nPage errors:");
  errors.slice(0, 20).forEach((e) => console.log("  " + e.slice(0, 300)));
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? `✗ ${failed} failed` : "✓ all passed"} (${results.length} checks)`);
process.exit(failed ? 1 : 0);
