import { getModel, isSimulated } from "@/config/models";
import type { FieldSchema, ObjectSchema } from "@/lib/ai/schema";
import { getPromptVersion, getTask } from "@/lib/ai/tasks";
import { deriveSchema } from "./compile";
import type { FunctionNodeConfig, HumanNodeConfig, LLMNodeConfig, RouterConfig, ToolNodeConfig, WfNode, WorkflowSpec } from "./spec";

/**
 * Visual workflow -> real LangGraph (Python) source.
 * API surface verified against docs.langchain.com on 2026-09-22 (langgraph 1.2.x):
 *   StateGraph, START, END, add_node(..., retry_policy=RetryPolicy(...), defer=True),
 *   add_conditional_edges(source, fn, [destinations]), compile(checkpointer=InMemorySaver()),
 *   interrupt(...) + Command(resume=...), init_chat_model("provider:model").
 */

export const CODEGEN_VERIFIED = "2026-09-22";

const PY_KEYWORDS = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));

export function pyName(id: string) {
  let s = id.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^\d/.test(s)) s = `n_${s}`;
  if (PY_KEYWORDS.has(s)) s = `${s}_node`;
  return s;
}

function pyStr(s: string) {
  return JSON.stringify(s);
}

function tripleQuoted(s: string) {
  return `"""${s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"')}"""`;
}

function fieldToPy(f: FieldSchema): string {
  switch (f.type) {
    case "enum":
      return `Literal[${f.values.map(pyStr).join(", ")}]`;
    case "number":
      return f.min !== undefined || f.max !== undefined ? `float = Field(${[f.min !== undefined ? `ge=${f.min}` : "", f.max !== undefined ? `le=${f.max}` : ""].filter(Boolean).join(", ")})` : "float";
    case "boolean":
      return "bool";
    case "string[]":
      return f.values ? `list[Literal[${f.values.map(pyStr).join(", ")}]]` : "list[str]";
    default:
      return "str";
  }
}

function schemaClass(name: string, schema: ObjectSchema) {
  const lines = Object.entries(schema).map(([k, f]) => {
    const t = fieldToPy(f);
    return t.includes("=") ? `    ${k}: ${t}` : `    ${k}: ${t}`;
  });
  return `class ${name}(BaseModel):\n${lines.join("\n")}`;
}

function modelString(id: string) {
  if (isSimulated(id)) return { str: "openai:gpt-5.4-mini", note: `# NOTE: '${id}' is a simulated model in the lab — swap in the real model you want.` };
  const m = getModel(id);
  const provider = m?.provider === "anthropic" ? "anthropic" : "openai";
  return { str: `${provider}:${id}`, note: "" };
}

/** JS ternary / boolean expression -> Python (best effort, for simple router expressions). */
export function jsExprToPy(expr: string): string {
  const e = expr.trim();
  const stripParens = (s: string) => {
    let t = s.trim();
    while (t.startsWith("(") && t.endsWith(")")) {
      let depth = 0;
      let wraps = true;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === "(") depth++;
        else if (t[i] === ")") depth--;
        if (depth === 0 && i < t.length - 1) {
          wraps = false;
          break;
        }
      }
      if (!wraps) break;
      t = t.slice(1, -1).trim();
    }
    return t;
  };
  const conv = (s: string): string => {
    const t = stripParens(s);
    let depth = 0;
    let q = -1;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "?" && depth === 0) {
        q = i;
        break;
      }
    }
    if (q === -1) return atom(t);
    let colon = -1;
    depth = 0;
    let nested = 0;
    for (let i = q + 1; i < t.length; i++) {
      const c = t[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "?" && depth === 0) nested++;
      else if (c === ":" && depth === 0) {
        if (nested === 0) {
          colon = i;
          break;
        }
        nested--;
      }
    }
    if (colon === -1) return atom(t);
    return `(${conv(t.slice(q + 1, colon))} if ${conv(t.slice(0, q))} else ${conv(t.slice(colon + 1))})`;
  };
  const atom = (s: string) =>
    s
      .replace(/state\.(\w+)/g, 'state["$1"]')
      .replace(/===/g, "==")
      .replace(/!==/g, "!=")
      .replace(/&&/g, " and ")
      .replace(/\|\|/g, " or ")
      .replace(/!(?!=)/g, "not ")
      .replace(/\btrue\b/g, "True")
      .replace(/\bfalse\b/g, "False")
      .replace(/\bnull\b|\bundefined\b/g, "None")
      .replace(/'/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  return conv(e);
}

export function generatePython(spec: WorkflowSpec): string {
  const schema = deriveSchema(spec);
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const real = spec.nodes.filter((n) => !["start", "end", "router"].includes(n.kind));
  const llmNodes = real.filter((n) => n.kind === "llm");
  const usesInterrupt = real.some((n) => n.kind === "human");
  const usesRetry = llmNodes.some((n) => (n.config as LLMNodeConfig).retries > 1);
  const usesRe = real.some((n) => n.kind === "function" && ["clean_transcript", "redact_pii"].includes((n.config as FunctionNodeConfig).fn));
  const target = (id: string) => {
    const n = byId.get(id);
    if (!n) return pyStr(id);
    if (n.kind === "end") return "END";
    if (n.kind === "start") return "START";
    return pyStr(pyName(n.id));
  };

  const out: string[] = [];
  out.push(`"""
${spec.name} — generated by AI Engineering Lab
Targets LangGraph 1.x (API verified against docs.langchain.com on ${CODEGEN_VERIFIED}).
Review before production use: prompts, models and tool stubs need your real implementations.

pip install -U langgraph langchain langchain-openai langchain-anthropic
"""`);
  const typingImports = ["Optional", "Literal"];
  out.push(`import operator${usesRe ? "\nimport re" : ""}
from typing import ${typingImports.join(", ")}
from typing_extensions import TypedDict, Annotated

from pydantic import BaseModel, Field
from langchain.chat_models import init_chat_model
from langgraph.graph import StateGraph, START, END${spec.checkpointer ? "\nfrom langgraph.checkpoint.memory import InMemorySaver" : ""}${
    usesInterrupt || usesRetry ? `\nfrom langgraph.types import ${[usesInterrupt ? "interrupt, Command" : "", usesRetry ? "RetryPolicy" : ""].filter(Boolean).join(", ")}` : ""
  }`);

  // ---- State
  out.push(`\n# ---------------------------------------------------------------- State\n# The state is the information flowing through the graph.\n# Keys with a reducer (Annotated[..., operator.add]) ACCUMULATE instead of being overwritten.`);
  const stateLines = Object.entries(schema).map(([k, ch]) => {
    if (ch.reducer === "add") return `    ${k}: Annotated[int, operator.add]`;
    if (ch.reducer === "append") return `    ${k}: Annotated[list, operator.add]`;
    if (ch.reducer === "merge") return `    ${k}: dict  # NOTE: merge reducer — define a custom reducer function`;
    const typ =
      k === "transcript" || k === "cleaned_transcript" || k === "summary" || k.endsWith("_error") || k === "status" || k === "review_status" || k === "reviewer_note" || k === "transcript_id"
        ? "Optional[str]"
        : k.includes("confidence")
          ? "Optional[float]"
          : k === "is_valid"
            ? "Optional[bool]"
            : k === "requested_info"
              ? "Optional[list[str]]"
              : k === "final_output" || k === "customer_profile" || k === "rate_info"
                ? "Optional[dict]"
                : "Optional[str]";
    return `    ${k}: ${typ}`;
  });
  out.push(`class State(TypedDict, total=False):\n${stateLines.join("\n")}`);

  // ---- Schemas
  const tasksUsed = [...new Set(llmNodes.map((n) => (n.config as LLMNodeConfig).task))];
  if (tasksUsed.length) {
    out.push(`\n# ---------------------------------------------------------------- Structured outputs`);
    for (const t of tasksUsed) {
      const def = getTask(t);
      if (!def) continue;
      out.push(schemaClass(className(t), def.schema));
    }
  }

  // ---- Models
  const models = new Map<string, string>();
  if (llmNodes.length) {
    out.push(`\n# ---------------------------------------------------------------- Models`);
    const seen = models;
    llmNodes.forEach((n) => {
      const cfg = n.config as LLMNodeConfig;
      const key = `${cfg.model}|${cfg.temperature}|${cfg.maxTokens}`;
      if (seen.has(key)) return;
      const varName = `llm_${seen.size + 1}`;
      seen.set(key, varName);
      const ms = modelString(cfg.model);
      const info = getModel(cfg.model);
      const args = [pyStr(ms.str)];
      if (info?.supportsTemperature !== false) args.push(`temperature=${cfg.temperature}`);
      args.push(`max_tokens=${cfg.maxTokens}`);
      if (ms.note) out.push(ms.note);
      out.push(`${varName} = init_chat_model(${args.join(", ")})`);
    });
  }

  // ---- Prompts + nodes
  out.push(`\n# ---------------------------------------------------------------- Nodes\n# Each node receives the current state and returns a PARTIAL update (a dict).`);
  for (const n of real) out.push(nodeToPy(n, models));

  // ---- Routers
  const routers = spec.nodes.filter((n) => n.kind === "router");
  if (routers.length) {
    out.push(`\n# ---------------------------------------------------------------- Routing functions\n# In LangGraph a "router" is not a node: it is a function passed to add_conditional_edges().`);
    for (const r of routers) out.push(routerToPy(r, spec, target));
  }

  // ---- Graph
  out.push(`\n# ---------------------------------------------------------------- Graph\nbuilder = StateGraph(State)`);
  for (const n of real) {
    const opts: string[] = [];
    if (n.kind === "llm" && (n.config as LLMNodeConfig).retries > 1) opts.push(`retry_policy=RetryPolicy(max_attempts=${(n.config as LLMNodeConfig).retries})`);
    if (n.defer) opts.push("defer=True");
    out.push(`builder.add_node(${pyStr(pyName(n.id))}, ${pyName(n.id)}${opts.length ? ", " + opts.join(", ") : ""})`);
  }
  out.push("");
  for (const e of spec.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t || s.kind === "router") continue;
    if (t.kind === "router") {
      const dests = routerDestinations(t.id, spec, target);
      out.push(`builder.add_conditional_edges(${target(s.id)}, route_${pyName(t.id)}, [${dests.join(", ")}])`);
    } else out.push(`builder.add_edge(${target(s.id)}, ${target(t.id)})`);
  }
  out.push(`\ngraph = builder.compile(${spec.checkpointer ? "checkpointer=InMemorySaver()" : ""})`);

  // ---- Usage
  out.push(`

# ---------------------------------------------------------------- Run it
if __name__ == "__main__":
    transcript = """Agent: Good morning. How can I help you?
Customer: I am calling regarding a personal loan.
Agent: Are you interested in applying?
Customer: Yes, but I want to compare the interest rates first."""
    config = {${spec.checkpointer ? '"configurable": {"thread_id": "call-001"}, ' : ""}"recursion_limit": ${spec.recursionLimit ?? 25}}
    result = graph.invoke({"transcript": transcript}, config)${
      usesInterrupt
        ? `
    if "__interrupt__" in result:  # paused at human review
        print("Waiting for review:", result["__interrupt__"][0].value)
        result = graph.invoke(Command(resume={"action": "approve"}), config)`
        : ""
    }
    print(result.get("final_output", result))
`);
  return out.join("\n");
}

function className(task: string) {
  return task
    .split("_")
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("") + "Output";
}

function nodeToPy(n: WfNode, models: Map<string, string>): string {
  const fname = pyName(n.id);
  switch (n.kind) {
    case "llm": {
      const cfg = n.config as LLMNodeConfig;
      const def = getTask(cfg.task);
      const pv = getPromptVersion(cfg.task, cfg.promptVersion);
      const system = cfg.customSystem ?? pv?.system ?? "You are a helpful assistant.";
      const user = cfg.customPrompt ?? pv?.user ?? "{{transcript}}";
      const llmVar = models.get(`${cfg.model}|${cfg.temperature}|${cfg.maxTokens}`) ?? "llm_1";
      const P = `${fname.toUpperCase()}_PROMPT`;
      const S = `${fname.toUpperCase()}_SYSTEM`;
      const inputExpr = cfg.inputKey ? `state[${pyStr(cfg.inputKey)}]` : `state.get("cleaned_transcript") or state["transcript"]`;
      const outputs = def ? Object.entries(def.outputs).map(([field, key]) => [field, cfg.outputs?.[field] ?? key]) : [];
      const ret = outputs.map(([f, k]) => `${pyStr(k)}: result.${f}`).join(", ");
      const store = cfg.onParseError === "store";
      const lines = [
        `${S} = ${pyStr(system)}`,
        `${P} = ${tripleQuoted(user)}  # ${pv ? pv.label : "custom prompt"}`,
        "",
        `def ${fname}(state: State) -> dict:`,
        `    """${n.label}${def ? ` — ${def.description}` : ""}"""`,
        `    text = ${inputExpr}`,
        `    messages = [`,
        `        {"role": "system", "content": ${S}},`,
        `        {"role": "user", "content": ${P}.replace("{{transcript}}", text)},`,
        `    ]`,
      ];
      if (!def) {
        lines.push(`    response = ${llmVar}.invoke(messages)`, `    return {"llm_output": response.content}`);
      } else if (store) {
        lines.push(
          `    out = ${llmVar}.with_structured_output(${className(cfg.task)}, include_raw=True).invoke(messages)`,
          `    if out["parsing_error"] is not None:`,
          `        # don't crash the graph: store the error so a validate -> retry loop can react`,
          `        return {${pyStr(`${n.id}_error`)}: str(out["parsing_error"])}`,
          `    result = out["parsed"]`,
          `    return {${ret}, ${pyStr(`${n.id}_error`)}: None}`,
        );
      } else {
        lines.push(
          `    result = ${llmVar}.with_structured_output(${className(cfg.task)}).invoke(messages)`,
          `    return {${ret}}`,
        );
      }
      return lines.join("\n") + "\n";
    }
    case "function": {
      const cfg = n.config as FunctionNodeConfig;
      const body: Record<string, string> = {
        clean_transcript: `    text = state.get("cleaned_transcript") or state["transcript"]
    text = re.sub(r"\\b(umm+|uhh*|hmm+|erm)\\b[,.]?\\s*", "", text, flags=re.I)
    return {"cleaned_transcript": re.sub(r"[ \\t]+", " ", text).strip()}`,
        redact_pii: `    text = state.get("cleaned_transcript") or state["transcript"]
    text = re.sub(r"\\b[A-Z]{5}\\d{4}[A-Z]\\b", "[PAN]", text)
    text = re.sub(r"\\b[\\w.+-]+@[\\w-]+\\.[\\w.]+\\b", "[EMAIL]", text)
    text = re.sub(r"\\b(\\+91[- ]?)?\\d{5}[- ]?\\d{5}\\b", "[PHONE]", text)
    return {"cleaned_transcript": text}`,
        compute_confidence: `    scores = [state.get(k) for k in ("confidence", "product_confidence", "sentiment_confidence")]
    scores = [s for s in scores if s is not None]
    return {"confidence": min(scores) if scores else None}`,
        validate_output: `    errors = [v for k, v in state.items() if k.endswith("_error") and v]
    ok = state.get("intent") in ("interested", "not_interested", "unclear") and not errors
    return {"is_valid": ok}`,
        increment_attempts: `    return {"attempts": 1}  # reducer operator.add turns this into attempts += 1`,
        finalize: `    keys = ("intent", "product", "sentiment", "confidence", "requested_info", "next_action", "summary", "review_status")
    final = {k: state[k] for k in keys if state.get(k) is not None}
    return {"final_output": final, "status": "reviewed" if state.get("review_status") else "auto_approved"}`,
        custom: `    # Translated from the lab's JavaScript — review carefully:
${(cfg.code ?? "return {}").split("\n").map((l) => `    # ${l}`).join("\n")}
    raise NotImplementedError("port the custom function above to Python")`,
      };
      return `def ${fname}(state: State) -> dict:\n    """${n.label}"""\n${body[cfg.fn]}\n`;
    }
    case "tool": {
      const cfg = n.config as ToolNodeConfig;
      const body: Record<string, string> = {
        crm_lookup: `    # TODO: call your CRM API here
    return {"customer_profile": {"customer_id": "C12345", "segment": "salaried"}}`,
        rate_lookup: `    # TODO: call your pricing/rates service here
    return {"rate_info": {"product": state.get("product"), "rate": "10.75% - 16%"}}`,
        send_followup: `    # SIDE EFFECT: make this idempotent — on resume/replay a node can run again!
    return {"actions": [f"queued follow-up for {state.get('product')}"]}`,
      };
      return `def ${fname}(state: State) -> dict:\n    """${n.label}"""\n${body[cfg.tool]}\n`;
    }
    case "human": {
      const cfg = n.config as HumanNodeConfig;
      return `def ${fname}(state: State) -> dict:
    """${n.label} — pauses the graph until a human responds."""
    decision = interrupt({
        "question": ${pyStr(cfg.question)},
        "prediction": {${(cfg.fields ?? []).map((f) => `${pyStr(f)}: state.get(${pyStr(f)})`).join(", ")}},
        "confidence": state.get("confidence"),
    })
    # Code above this line runs AGAIN when the graph resumes — keep it side-effect free.
    status = {"approve": "approved", "reject": "rejected"}.get(decision["action"], "corrected")
    return {"review_status": status, "reviewer_note": decision.get("note"), **decision.get("corrections", {})}
`;
    }
  }
  return "";
}

function routerDestinations(routerId: string, spec: WorkflowSpec, target: (id: string) => string, seen = new Set<string>()): string[] {
  if (seen.has(routerId)) return [];
  seen.add(routerId);
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const dests = spec.edges
    .filter((e) => e.source === routerId)
    .flatMap((e) => (byId.get(e.target)?.kind === "router" ? routerDestinations(e.target, spec, target, seen) : [target(e.target)]));
  return [...new Set(dests)];
}

function routerToPy(r: WfNode, spec: WorkflowSpec, target: (id: string) => string): string {
  const cfg = r.config as RouterConfig;
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const dest = (branch: string) => {
    const e = spec.edges.find((x) => x.source === r.id && x.branch === branch);
    if (!e) return `None  # WARNING: branch "${branch}" is not connected`;
    const t = byId.get(e.target);
    if (t?.kind === "router") return `route_${pyName(t.id)}(state)`;
    return target(e.target);
  };
  const fname = `route_${pyName(r.id)}`;
  if (cfg.mode === "threshold") {
    const v = typeof cfg.value === "number" || !isNaN(Number(cfg.value)) ? String(cfg.value) : pyStr(String(cfg.value));
    return `def ${fname}(state: State) -> str:
    """${r.label}"""
    if state[${pyStr(cfg.field)}] ${cfg.op ?? "<"} ${v}:
        return ${dest(cfg.branches[0])}  # "${cfg.branches[0]}"
    return ${dest(cfg.branches[1])}  # "${cfg.branches[1]}"
`;
  }
  if (cfg.mode === "category") {
    const lines = cfg.branches.map((b) => `        ${pyStr(b)}: ${dest(b)},`);
    return `def ${fname}(state: State) -> str:
    """${r.label}"""
    routes = {
${lines.join("\n")}
    }
    return routes${cfg.defaultBranch ? `.get(state[${pyStr(cfg.field)}], ${dest(cfg.defaultBranch)})` : `[state[${pyStr(cfg.field)}]]`}
`;
  }
  const mapLines = cfg.branches.map((b) => `        ${pyStr(b)}: ${dest(b)},`);
  return `def ${fname}(state: State) -> str:
    """${r.label}"""
    branch = ${jsExprToPy(cfg.expression ?? "None")}
    return {
${mapLines.join("\n")}
    }[branch]
`;
}
