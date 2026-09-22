import { INTENTS } from "@/lib/domain";
import { parseStructured, extractJson, schemaToTypeString } from "@/lib/ai/schema";
import { getPromptVersion, getTask, renderPrompt } from "@/lib/ai/tasks";
import type { LLMInvoker } from "@/lib/ai/types";
import { GraphRuntimeError } from "@/lib/engine/graph";
import type { ConditionalEdge, GraphDefinition, GraphState, NodeDef, StateSchema } from "@/lib/engine/types";
import { END, START } from "@/lib/engine/types";
import { cleanTranscript, redactPII } from "@/lib/sim/heuristics";
import { hashString } from "@/lib/sim/rng";
import { uid } from "@/lib/utils";
import {
  FUNCTION_INFO,
  type FunctionNodeConfig,
  type HumanNodeConfig,
  type LLMNodeConfig,
  type RouterConfig,
  TOOL_INFO,
  type ToolNodeConfig,
  type WfNode,
  type WorkflowSpec,
} from "./spec";

export interface HumanDecision {
  action: "approve" | "correct" | "reject";
  corrections?: Record<string, unknown>;
  note?: string;
}

/** Which state keys a node writes (used for the schema, lint and codegen). */
export function nodeWrites(n: WfNode): string[] {
  switch (n.kind) {
    case "llm": {
      const cfg = n.config as LLMNodeConfig;
      const task = getTask(cfg.task);
      const outs = task ? Object.entries(task.outputs).map(([field, key]) => cfg.outputs?.[field] ?? key) : ["llm_output"];
      return cfg.onParseError === "store" ? [...outs, `${n.id}_error`] : outs;
    }
    case "function": {
      const cfg = n.config as FunctionNodeConfig;
      if (cfg.fn === "custom") {
        const keys = [...(cfg.code ?? "").matchAll(/(\w+)\s*:/g)].map((m) => m[1]).filter((k) => !["return", "state"].includes(k));
        return [...new Set(keys)];
      }
      return FUNCTION_INFO[cfg.fn].writes;
    }
    case "tool":
      return TOOL_INFO[(n.config as ToolNodeConfig).tool].writes;
    case "human":
      return ["review_status", "reviewer_note", ...((n.config as HumanNodeConfig).fields ?? [])];
    default:
      return [];
  }
}

export function deriveSchema(spec: WorkflowSpec): StateSchema {
  const schema: StateSchema = {
    transcript: { reducer: "overwrite", description: "input transcript" },
    transcript_id: { reducer: "overwrite", description: "id of a known sample (optional)" },
  };
  for (const n of spec.nodes) {
    for (const key of nodeWrites(n)) {
      if (schema[key]) continue;
      if (key === "attempts") schema[key] = { reducer: "add", default: 0 };
      else if (key === "actions") schema[key] = { reducer: "append", default: [] };
      else schema[key] = { reducer: "overwrite" };
    }
  }
  for (const [k, r] of Object.entries(spec.reducers ?? {})) {
    schema[k] = { ...(schema[k] ?? {}), reducer: r, default: r === "append" ? [] : r === "add" ? 0 : r === "merge" ? {} : null };
  }
  return schema;
}

function compare(a: unknown, op: RouterConfig["op"], b: unknown, field: string) {
  if (a === undefined) {
    throw new Error(`KeyError: '${field}' — no node writes this key, so it is not in the state`);
  }
  const numeric = typeof b === "number" || (typeof b === "string" && b !== "" && !isNaN(Number(b)));
  if (numeric && ["<", "<=", ">", ">="].includes(op ?? "")) {
    if (a === null || typeof a !== "number") {
      throw new Error(`TypeError: '${op}' not supported between ${a === null ? "NoneType" : typeof a} ('${field}' = ${JSON.stringify(a)}) and float`);
    }
    const bn = Number(b);
    switch (op) {
      case "<":
        return a < bn;
      case "<=":
        return a <= bn;
      case ">":
        return a > bn;
      case ">=":
        return a >= bn;
    }
  }
  const bv = numeric && typeof a === "number" ? Number(b) : b;
  return op === "!=" ? a !== bv : a === bv;
}

export function routerBranch(cfg: RouterConfig, state: GraphState): string {
  if (cfg.mode === "threshold") {
    const ok = compare(state[cfg.field], cfg.op ?? "<", cfg.value, cfg.field);
    return ok ? cfg.branches[0] : cfg.branches[1];
  }
  if (cfg.mode === "category") {
    const v = state[cfg.field];
    if (v === undefined) throw new Error(`KeyError: '${cfg.field}'`);
    if (typeof v === "string" && cfg.branches.includes(v)) return v;
    if (cfg.defaultBranch) return cfg.defaultBranch;
    throw new Error(`value ${JSON.stringify(v)} of '${cfg.field}' matches no branch (${cfg.branches.join(", ")}) and there is no default`);
  }
  // expression (evaluated in the learner's own browser, on their own graph)
  const f = new Function("state", `"use strict"; return (${cfg.expression || "null"});`);
  const r = f(state);
  if (typeof r !== "string") throw new Error(`expression returned ${JSON.stringify(r)}, expected a branch name`);
  return r;
}

export function describeRouter(cfg: RouterConfig) {
  if (cfg.mode === "threshold") return `${cfg.field} ${cfg.op} ${cfg.value} ? "${cfg.branches[0]}" : "${cfg.branches[1]}"`;
  if (cfg.mode === "category") return `state["${cfg.field}"] → ${cfg.branches.join(" | ")}${cfg.defaultBranch ? ` (else ${cfg.defaultBranch})` : ""}`;
  return cfg.expression ?? "";
}

function toolResult(tool: ToolNodeConfig["tool"], state: GraphState) {
  const key = String(state.transcript_id ?? state.transcript ?? "x");
  const h = hashString(key);
  switch (tool) {
    case "crm_lookup":
      return {
        customer_profile: {
          customer_id: `C${(h % 90000) + 10000}`,
          segment: ["salaried", "self-employed", "premium"][h % 3],
          existing_products: [["savings_account"], ["savings_account", "credit_card"], ["personal_loan"]][h % 3],
          do_not_call: h % 11 === 0,
        },
      };
    case "rate_lookup": {
      const product = String(state.product ?? "personal_loan");
      const rates: Record<string, string> = {
        personal_loan: "10.75% – 16%",
        home_loan: "8.4% – 9.6%",
        car_loan: "9.1% – 11%",
        credit_card: "3.5% / month",
        savings_account: "3.5% – 4%",
        insurance: "n/a",
        none: "n/a",
      };
      return { rate_info: { product, rate: rates[product] ?? "n/a", processing_fee: product.includes("loan") ? "up to 1%" : "none" } };
    }
    case "send_followup":
      return { actions: [`queued follow-up (${state.next_action ?? "send_details"}) for ${state.product ?? "product"}`] };
  }
}

export interface CompileEnv {
  llm: LLMInvoker;
}

let runCounter = 0;

export function compileWorkflow(spec: WorkflowSpec, env: CompileEnv): GraphDefinition {
  void env; // kept for API symmetry: the engine injects the LLM invoker at run time
  const schema = deriveSchema(spec);
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const nodeName = (id: string) => {
    const n = byId.get(id);
    if (!n) return id;
    if (n.kind === "start") return START;
    if (n.kind === "end") return END;
    return n.id;
  };

  const nodes: NodeDef[] = [];
  for (const n of spec.nodes) {
    if (n.kind === "start" || n.kind === "end" || n.kind === "router") continue;
    nodes.push(buildNode(n));
  }

  // routers compile into conditional edges on their predecessors
  const routers = spec.nodes.filter((n) => n.kind === "router");
  const resolveRouter = (routerId: string, state: GraphState, path: string[] = []): { target: string; path: string[] } => {
    const r = byId.get(routerId)!;
    const cfg = r.config as RouterConfig;
    const branch = routerBranch(cfg, state);
    const edge = spec.edges.find((e) => e.source === routerId && e.branch === branch);
    if (!edge) throw new Error(`router '${r.label}' chose branch "${branch}" but no edge is connected for that branch`);
    const t = byId.get(edge.target);
    const p = [...path, `${r.label}: ${branch}`];
    if (t?.kind === "router") return resolveRouter(t.id, state, p);
    return { target: nodeName(edge.target), path: p };
  };
  const routerTargets = (routerId: string, seen = new Set<string>()): string[] => {
    if (seen.has(routerId)) return [];
    seen.add(routerId);
    return spec.edges
      .filter((e) => e.source === routerId)
      .flatMap((e) => (byId.get(e.target)?.kind === "router" ? routerTargets(e.target, seen) : [nodeName(e.target)]));
  };

  const edges: { source: string; target: string }[] = [];
  const conditionalEdges: ConditionalEdge[] = [];
  for (const e of spec.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    if (s.kind === "router") continue; // handled via predecessors
    if (t.kind === "router") {
      const router = t;
      conditionalEdges.push({
        source: nodeName(s.id),
        routerId: router.id,
        label: router.label,
        targets: routerTargets(router.id),
        route: (state) => resolveRouter(router.id, state).target,
        explain: (state, result) => {
          try {
            const r = resolveRouter(router.id, state);
            const cfg = router.config as RouterConfig;
            const val = cfg.mode === "expression" ? "" : ` (${cfg.field} = ${JSON.stringify(state[cfg.field])})`;
            return `${r.path.join(" → ")}${val} → ${result.join(", ")}`;
          } catch {
            return `→ ${result.join(", ")}`;
          }
        },
      });
      continue;
    }
    edges.push({ source: nodeName(s.id), target: nodeName(t.id) });
  }
  void routers;
  return { schema, nodes, edges, conditionalEdges };
}

/** LLM calls go through ctx.llm (the engine's invoker), so nodes never hold a client themselves. */
function buildNode(n: WfNode): NodeDef {
  const base = { name: n.id, label: n.label, kind: n.kind, defer: n.defer } as const;
  switch (n.kind) {
    case "llm": {
      const cfg = n.config as LLMNodeConfig;
      return {
        ...base,
        retry: cfg.retries > 1 ? { maxAttempts: cfg.retries } : undefined,
        fn: async (state, ctx) => {
          const inputKey = cfg.inputKey || (state.cleaned_transcript != null ? "cleaned_transcript" : "transcript");
          const input = state[inputKey];
          if (input === undefined || input === null || input === "") {
            throw new GraphRuntimeError({
              type: "KeyError",
              message: `Node '${n.id}' reads '${inputKey}' but it is ${input === undefined ? "missing from" : "empty in"} the state`,
              hint: "Check the node order: is the node that produces this key upstream of this one?",
            });
          }
          const task = getTask(cfg.task);
          const pv = getPromptVersion(cfg.task, cfg.promptVersion);
          const system = cfg.customSystem ?? pv?.system ?? "You are a helpful assistant.";
          let userT = cfg.customPrompt ?? pv?.user ?? "{{transcript}}";
          if (!userT.includes("{{transcript}}")) userT += "\n\n<<<\n{{transcript}}\n>>>";
          let prompt = renderPrompt(userT, { transcript: String(input) });
          const prevErr = state[`${n.id}_error`];
          if (cfg.onParseError === "store" && typeof prevErr === "string" && prevErr) {
            prompt += `\n\nYour previous answer was invalid: ${prevErr}. Return valid JSON only, exactly matching the schema.`;
          }
          const res = await ctx.llm({
            model: cfg.model,
            system,
            prompt,
            temperature: cfg.temperature,
            maxTokens: cfg.maxTokens,
            task: cfg.task,
            promptVersion: cfg.customPrompt || cfg.customSystem ? "custom" : pv?.id,
            sim: { transcript: String(input), transcriptId: (state.transcript_id as string) ?? undefined, runIndex: ++runCounter },
          });
          const parsed = task ? parseStructured(res.text, task.schema) : { ...extractJsonAsParsed(res.text) };
          ctx.recordLLM({
            id: uid("llm"),
            model: res.model,
            provider: res.provider,
            simulated: res.simulated,
            task: cfg.task,
            promptVersion: pv?.id,
            system,
            prompt,
            temperature: cfg.temperature,
            maxTokens: cfg.maxTokens,
            rawOutput: res.text,
            parsed: parsed.ok ? parsed.value ?? null : null,
            parseSteps: parsed.steps,
            parseError: parsed.ok
              ? null
              : {
                  message: parsed.error?.message ?? "invalid output",
                  expected: task ? schemaToTypeString(task.schema) : "JSON object",
                  received: res.text.slice(0, 800) || "(empty string)",
                },
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
            reasoningTokens: res.reasoningTokens,
            costUsd: res.costUsd,
            latencyMs: res.latencyMs,
            ttftMs: res.ttftMs,
            stopReason: res.stopReason,
          });
          if (!parsed.ok) {
            const msg = parsed.error?.message ?? "invalid output";
            if (cfg.onParseError === "store") {
              ctx.log(`Stored parse error in '${n.id}_error' instead of failing`);
              return { [`${n.id}_error`]: msg };
            }
            throw new GraphRuntimeError({
              type: "OutputParserException",
              message: `Invalid structured output: ${msg}`,
              expected: task ? schemaToTypeString(task.schema) : "JSON object",
              received: res.text.slice(0, 600) || "(empty string)",
              hint:
                res.stopReason === "max_tokens"
                  ? "The model hit max_tokens — the JSON was cut off. Increase max tokens."
                  : "Use a prompt version that specifies the JSON schema, add a validate→retry loop, or set on_parse_error to 'store'.",
            });
          }
          const update: GraphState = {};
          if (task) {
            for (const [field, key] of Object.entries(task.outputs)) {
              const k = cfg.outputs?.[field] ?? key;
              update[k] = parsed.value?.[field] ?? null;
            }
          } else update.llm_output = parsed.value;
          if (cfg.onParseError === "store") update[`${n.id}_error`] = null;
          return update;
        },
      };
    }
    case "function": {
      const cfg = n.config as FunctionNodeConfig;
      return {
        ...base,
        fn: async (state, ctx) => {
          ctx.addLatency(3 + Math.round(Math.random() * 4));
          switch (cfg.fn) {
            case "clean_transcript":
              return { cleaned_transcript: cleanTranscript(String(state.cleaned_transcript ?? state.transcript ?? "")) };
            case "redact_pii": {
              const src = String(state.cleaned_transcript ?? state.transcript ?? "");
              const red = redactPII(src);
              if (red !== src) ctx.log("PII masked before any model call");
              return { cleaned_transcript: red };
            }
            case "compute_confidence": {
              const vals = ["confidence", "product_confidence", "sentiment_confidence"]
                .map((k) => state[k])
                .filter((v): v is number => typeof v === "number");
              const c = vals.length ? Math.min(...vals) : null;
              ctx.log(vals.length ? `min(${vals.join(", ")}) = ${c}` : "no confidences found in state");
              return { confidence: c };
            }
            case "validate_output": {
              const errs = Object.entries(state).filter(([k, v]) => k.endsWith("_error") && v);
              const ok = typeof state.intent === "string" && (INTENTS as readonly string[]).includes(state.intent) && errs.length === 0;
              ctx.log(ok ? "output valid" : `invalid: ${errs.map(([k, v]) => `${k}=${v}`).join("; ") || `intent=${JSON.stringify(state.intent)}`}`);
              return { is_valid: ok };
            }
            case "increment_attempts":
              return { attempts: 1 };
            case "finalize": {
              const pickKeys = ["intent", "product", "sentiment", "confidence", "requested_info", "next_action", "summary", "review_status"];
              const out: Record<string, unknown> = {};
              for (const k of pickKeys) if (state[k] !== undefined && state[k] !== null) out[k] = state[k];
              return { final_output: out, status: state.review_status ? "reviewed" : "auto_approved" };
            }
            case "custom": {
              try {
                const f = new Function("state", `"use strict";\n${cfg.code ?? "return {};"}`);
                const r = f(JSON.parse(JSON.stringify(state)));
                return r ?? {};
              } catch (e) {
                throw new GraphRuntimeError({ type: "UserCodeError", message: `Custom function '${n.label}' threw: ${(e as Error).message}` });
              }
            }
          }
        },
      };
    }
    case "tool": {
      const cfg = n.config as ToolNodeConfig;
      return {
        ...base,
        fn: async (state, ctx) => {
          ctx.addLatency(TOOL_INFO[cfg.tool].latencyMs + Math.round(Math.random() * 40));
          ctx.log(`${cfg.tool}(${JSON.stringify(state.product ?? state.transcript_id ?? "")})`);
          return toolResult(cfg.tool, state);
        },
      };
    }
    case "human": {
      const cfg = n.config as HumanNodeConfig;
      return {
        ...base,
        fn: async (state, ctx) => {
          const prediction: Record<string, unknown> = {};
          for (const f of cfg.fields ?? []) prediction[f] = state[f];
          const decision = ctx.interrupt<HumanDecision>({
            question: cfg.question,
            prediction,
            confidence: state.confidence,
            fields: cfg.fields,
          });
          const update: GraphState = {
            review_status: decision.action === "approve" ? "approved" : decision.action === "reject" ? "rejected" : "corrected",
            reviewer_note: decision.note ?? null,
          };
          for (const [k, v] of Object.entries(decision.corrections ?? {})) update[k] = v;
          return update;
        },
      };
    }
    default:
      throw new Error(`cannot build node of kind ${n.kind}`);
  }
}

function extractJsonAsParsed(text: string) {
  const r = extractJson(text);
  return r.ok && r.value && typeof r.value === "object"
    ? { ok: true as const, value: r.value as Record<string, unknown>, steps: r.steps, error: undefined }
    : { ok: false as const, value: undefined, steps: r.steps, error: { type: "parse" as const, message: r.error ?? "invalid", issues: [] } };
}
