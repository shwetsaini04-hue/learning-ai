# AI Engineering Lab

An interactive laboratory for becoming an **AI / LLM engineer**, built around one realistic domain:
**customer-call transcripts → LLM analysis → structured, reviewed results → downstream decisions.**

It is not a documentation site. Every concept follows the loop
**Concept → Visual → Example → Experiment → Exercise → Result → Explanation**, and everything runs in the
browser — for free — thanks to a deterministic **simulated LLM**. Plug in real API keys later for live runs.

> Learn → Understand → Experiment → Build → Evaluate → Debug

---

## What's inside

| Area | What you do there |
| --- | --- |
| **Dashboard** | Track progress (lessons, exercises, assessments, debug challenges, experiments, capstone) — stored in your browser. |
| **Track A · LangGraph & LLM Workflows** (15 lessons, 4 modules) | LLM apps, structured outputs, workflow patterns, why LangGraph exists, the graph mental model, state & reducers, nodes/edges, routing, loops & retries, parallelism & `Send`, persistence & time travel, human-in-the-loop, tools & agents, the workflow ladder, debugging. |
| **Track B · LLM Evaluation & Observability** (13 lessons, 4 modules) | Why eval is hard, ground truth & annotator agreement, correctness/relevance/completeness, groundedness & hallucination, validity & consistency, precision/recall/F1/confusion matrices, exact vs semantic metrics, LLM-as-a-judge (and calibrating it), regression testing, cost, latency, tracing & monitoring, the production loop. |
| **Workflow Playground** | Visual LangGraph-style builder (React Flow): add/remove/connect nodes, routers with branches, human-review nodes, tools, reducers, checkpointer, recursion limit. Run with animation or step-by-step, inspect **input → prompt → raw output → parsed output → state diff** per node, and **export real LangGraph Python**. |
| **Transcript Lab** | A production-style pipeline (redact PII → clean → 4 parallel analyses → confidence gate → human review → final JSON). Review low-confidence calls yourself; corrections flow into a feedback dataset. Batch mode shows model vs. system accuracy vs. review cost. |
| **Debugging Lab** | 8 deliberately broken workflows (format failures, reasoning tokens eating `max_tokens`, reducer conflicts, wrong state keys, infinite loops, silently swapped routes, missing checkpointer, PII sent before redaction). Reproduce → diagnose → fix → auto-verify. |
| **Eval Playground** | One example, every method: schema validity, exact/normalized match, token F1, ROUGE-L, semantic similarity, claim-level groundedness, LLM-as-a-judge with an editable rubric. |
| **Datasets** | Build, clone, tag, edit, import/export evaluation datasets; dataset-health checks (balance, hard-slice coverage, duplicates). |
| **Experiments** | Run datasets × models × prompt versions. Accuracy (with CI), macro P/R/F1, confusion matrix, per-slice accuracy, latency P50/P95/P99, tokens, cost, invalid outputs, error analysis, and per-example regression diffs. |
| **Model Comparison** | Quality ↔ cost ↔ latency ↔ reliability, requirement constraints (not a "best model"), and a small→large cascade. |
| **Cost / Latency Labs** | Token economics (caching, batch discount, reasoning tokens, per 1K/10K/100K/month), editable price table; Monte-Carlo latency for sequential vs parallel vs single-call architectures. |
| **Capstone** | Design review (graded), build (auto-checked), evaluate against targets on 60 held-out calls, error analysis, a data-driven release decision, and a downloadable report. |
| **Glossary** | 60+ terms: definition → plain words → example → why it matters, linked from lessons. |

Also: scenario-based assessments per module, 13 exercises (build-in-playground with automatic checkers,
code exercises with a static checker that flags legacy APIs, numeric problems), dark/light themes, and a
responsive layout.

---

## Architecture

```text
Browser (Next.js client components)
 ├─ UI: lessons, labs, playground (React Flow), charts (SVG)
 ├─ Teaching engine (src/lib/engine) — a LangGraph-style runtime:
 │    super-steps, reducers, conditional edges, Send, defer, RetryPolicy,
 │    checkpoints, interrupt()/resume, time-travel forks, recursion limit,
 │    InvalidUpdateError — with full per-node tracing
 ├─ AI experiment layer (src/lib/ai/client.ts)
 │    ├─ simulated models (src/lib/sim) — free, deterministic, in-browser
 │    └─ live models → POST /api/llm
 └─ Storage: localStorage (progress, datasets, experiments, workflows, settings)

Next.js server (route handlers — the ONLY place with API keys)
 ├─ GET  /api/config  → which providers are configured (booleans + limits, no secrets)
 └─ POST /api/llm     → token check → model allow-list → size caps → rate limit
                        → provider adapter (Anthropic | OpenAI | OpenAI-compatible)
```

**Why a simulator?** The simulated models (Atlas-L, Swift-M, Pico-S, Sage-R) are *models of LLM behaviour*,
not language models: accuracy drops on hard calls and better prompts help most there; small models are
over-confident; weak prompts produce prose or malformed JSON; temperature adds run-to-run variance; reasoning
models spend hidden tokens; summaries sometimes hallucinate; latency is heavy-tailed. Temperature 0 is
deterministic. This makes every lesson and lab work without an API key — and the same prompts, parsers,
metrics and dashboards work unchanged with live models.

**Why re-implement LangGraph semantics in TypeScript?** So you can *watch* super-steps, reducers,
checkpoints and interrupts happen in the browser. The playground exports real Python that targets
LangGraph 1.x (`StateGraph`, `add_conditional_edges`, `compile(checkpointer=…)`, `interrupt()` +
`Command(resume=…)`, `RetryPolicy`, `defer=True`, `init_chat_model("provider:model")`).

---

## Getting started

Prerequisites: **Node.js 20.9+** (tested on Node 24) and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000. That's it — Simulation mode needs no configuration.

### Optional: live models

1. Copy `.env.example` to `.env.local` and add at least one key:

   ```bash
   ANTHROPIC_API_KEY=...
   OPENAI_API_KEY=...
   ```

2. Restart `npm run dev`, open **Settings**, switch to **Live**. Live models now appear in every model picker.
3. Set a browser spend budget in Settings (default $2). Live batch experiments always ask for confirmation
   with a cost estimate first.

Live model notes (pricing and capabilities live in `src/config/models.ts`, last verified 2026-09-22):
Claude Opus 5 / Sonnet 5 think by default and don't take `temperature` (the adapter sends
`output_config.effort: "low"` for these classification-style calls; Opus 5 requests opt into server-side
refusal fallbacks), Haiku 4.5 and GPT-4.1 mini support temperature, GPT-5.x models are reasoning models
(reasoning tokens are billed as output).

---

## Environment variables

All are optional and **server-side only** (never exposed to the browser).

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | – | Enables Claude models in Live mode. |
| `OPENAI_API_KEY` | – | Enables OpenAI models in Live mode. |
| `OPENAI_COMPATIBLE_BASE_URL` | – | Any OpenAI-compatible server (Groq, Together, OpenRouter, local Ollama…). |
| `OPENAI_COMPATIBLE_API_KEY` | – | Key for that server (if it needs one). |
| `OPENAI_COMPATIBLE_MODELS` | – | Comma-separated model ids to allow, e.g. `llama3.1:8b,qwen2.5:7b`. |
| `LIVE_LLM_ENABLED` | `true` | `false` hard-disables live calls. |
| `LAB_ACCESS_TOKEN` | – | If set, live calls require this token (entered in Settings). **Set it on any public deployment with keys.** |
| `MAX_INPUT_CHARS` | `16000` | Max system+prompt characters per request. |
| `MAX_OUTPUT_TOKENS` | `1024` | Max output tokens per request. |
| `RATE_LIMIT_PER_MINUTE` | `20` | Per-IP requests/minute (in-memory, per instance). |
| `DAILY_REQUEST_LIMIT` | `500` | Requests/day (in-memory, per instance). |

---

## Security & cost controls

- API keys are read only in `src/lib/server/*` (marked `server-only`) and used only by `/api/llm`.
  `/api/config` returns booleans and limits, never secrets. `.env*` files are git-ignored (except `.env.example`).
- `/api/llm` enforces: live-mode switch, optional access token (constant-time compare), a model allow-list,
  input size cap, output token cap, per-IP rate limit and a daily cap.
- The browser adds: a spend budget that stops live calls, a max-examples cap for live experiments, and a
  cost-estimate confirmation before every live batch.
- In-memory limits are per serverless instance — treat them as guard rails. For hard quotas use a shared
  store (e.g. Upstash Redis / Vercel KV) **and** provider-side spend limits.
- PII: the transcript pipelines redact phone numbers, PAN and e-mails *before* model calls; the Debugging Lab
  teaches why the order matters.

---

## Deploying to Vercel

No database is required — learner data lives in each visitor's browser.

1. Push this folder to a Git repository (GitHub/GitLab/Bitbucket).
2. In Vercel: **Add New… → Project**, import the repository. Framework preset: **Next.js** (auto-detected).
   If the app is in a subfolder of the repo, set **Root Directory** to that folder.
3. (Optional) **Settings → Environment Variables**: add provider keys and — if you add keys —
   `LAB_ACCESS_TOKEN`.
4. Deploy. Build command `next build`, output handled by Vercel.

Or with the CLI:

```bash
npm i -g vercel
vercel          # first deploy (preview)
vercel --prod   # production
```

Without any environment variables the deployed site is a fully working, zero-cost simulation lab.

---

## Your data

Everything is stored in `localStorage` under `ael-settings-v1`, `ael-progress-v1`, `ael-datasets-v1`,
`ael-experiments-v1` and `ael-workflows-v2`. **Settings → Export everything** downloads a JSON backup;
**Import backup** restores it (e.g. on another machine). Clearing site data resets the lab.

---

## Quality checks

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint (Next.js + React hooks rules)
npm run selftest    # 31 checks: simulator calibration, every template runs & lints clean,
                    # every debug challenge fails broken / passes fixed, every exercise
                    # solution passes its checker, the judge-calibration exercise is solvable
npm run build       # production build
npm run e2e -- http://localhost:3000   # optional: headless smoke test with your local Chrome/Edge
                                       # (uses playwright-core; no browser download)
```

---

## Project structure

```text
src/
  app/                    routes (dashboard, learn/*, lab/*, capstone, glossary, settings, api/*)
  lessons/                28 lesson modules + interactive widgets
  components/
    graph/                FlowDiagram (SVG), WorkflowRunner, inspectors, runner hook
    playground/           React Flow nodes, config panel, exercise/challenge panel
    charts/               bar, grouped bar, histogram, line, scatter, confusion matrix, sparkline
    eval/ labs/ learn/    metric comparer, judge lab, cost & latency sims, quiz/exercise/lesson shell
  content/                curriculum, assessments, exercises (+ checkers), debug challenges, glossary, capstone
  config/models.ts        model registry + prices (configuration, with "last verified" dates)
  lib/
    engine/               LangGraph-style runtime + checkpointer
    workflows/            visual spec, compiler, linter, Python codegen, templates, batch runner
    ai/                   experiment layer, provider-agnostic types, prompt versions, schema validation
    sim/                  simulated LLM, transcripts (30 handcrafted + 120 generated), heuristics
    eval/                 metrics, similarity/groundedness, judge, experiment runner
    server/               provider adapters, limits, rate limiting (server-only)
    store/                zustand stores persisted to localStorage
scripts/                  selftest.ts, e2e.mjs
```

## Extending

- **Update prices / add a model:** edit `src/config/models.ts` (and bump `lastVerified`). Users can also
  override prices in Settings.
- **Add a provider:** add an adapter in `src/lib/server/providers.ts`, list its models in `LIVE_MODELS`, and
  report it from `providersConfigured()` in `src/lib/server/config.ts`.
- **Add a prompt version:** add it to the task in `src/lib/ai/tasks.ts` — it immediately appears in the
  playground, experiments and regression tools.
- **Add a lesson:** add metadata in `src/content/curriculum.ts`, a component in `src/lessons/`, and register it in
  `src/lessons/LessonRenderer.tsx`.

## Accuracy notes

API details were verified against the official LangGraph/LangChain documentation on **2026-09-22**
(LangGraph 1.2.x): e.g. the default `recursion_limit` is 1000 since 1.0.6, node retries use
`retry_policy=RetryPolicy(...)`, human-in-the-loop uses `interrupt()` + `Command(resume=...)`, and agents are
built with `langchain.agents.create_agent`. Version-sensitive code blocks carry a **"Last verified"** badge.
Simulated models, the claim checker and the lexicon-based semantic similarity are teaching instruments —
measure real systems with real models on your own data.
