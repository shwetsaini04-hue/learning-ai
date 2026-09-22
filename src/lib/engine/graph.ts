import { deepClone, uid } from "@/lib/utils";
import type {
  ChannelDef,
  Checkpoint,
  CommandResult,
  EngineEvent,
  GraphDefinition,
  GraphState,
  InterruptInfo,
  NodeContext,
  NodeErrorInfo,
  NodeSpan,
  RunOptions,
  RunTrace,
  StateSchema,
} from "./types";
import { END, START } from "./types";

/**
 * A teaching-sized re-implementation of LangGraph's execution model (Pregel):
 *
 *   1. Nodes that are "triggered" run together in a SUPER-STEP (in parallel).
 *   2. Each node reads a snapshot of state and returns a PARTIAL update.
 *   3. After the step, all updates are applied through each key's REDUCER.
 *   4. Edges (static + conditional) decide which nodes run in the next step.
 *   5. With a checkpointer, state is saved after every step (persistence,
 *      human-in-the-loop, time travel all build on this).
 *
 * It mirrors the real semantics closely enough that the Python you export
 * from the playground behaves the same way — but it is NOT the real library.
 */

export class GraphRuntimeError extends Error {
  constructor(public info: NodeErrorInfo) {
    super(info.message);
  }
}

export class GraphInterrupt extends Error {
  constructor(
    public payload: unknown,
    public node: string,
  ) {
    super("GraphInterrupt");
  }
}

export interface SendTask {
  __send: true;
  node: string;
  arg: GraphState;
}

/** LangGraph `Send(node, arg)`: run `node` with a custom input (map-reduce). */
export function Send(node: string, arg: GraphState): SendTask {
  return { __send: true, node, arg };
}

interface Task {
  node: string;
  arg?: GraphState;
  index?: number;
}

function isCommand(v: unknown): v is CommandResult {
  return !!v && typeof v === "object" && (v as CommandResult).__command === true;
}

function isSend(v: unknown): v is SendTask {
  return !!v && typeof v === "object" && (v as SendTask).__send === true;
}

export function defaultFor(ch: ChannelDef): unknown {
  if (ch.default !== undefined) return deepClone(ch.default);
  switch (ch.reducer) {
    case "append":
      return [];
    case "add":
      return 0;
    case "merge":
      return {};
    default:
      return null;
  }
}

export function initState(schema: StateSchema): GraphState {
  const s: GraphState = {};
  for (const [k, ch] of Object.entries(schema)) s[k] = defaultFor(ch);
  return s;
}

export function applyWrites(
  schema: StateSchema,
  state: GraphState,
  writes: { node: string; update: Partial<GraphState> | null | undefined }[],
): { state: GraphState; changedKeys: string[] } {
  const next = deepClone(state);
  const byKey = new Map<string, { node: string; value: unknown }[]>();
  for (const w of writes) {
    if (!w.update) continue;
    for (const [k, v] of Object.entries(w.update)) {
      if (v === undefined) continue;
      const list = byKey.get(k) ?? [];
      list.push({ node: w.node, value: v });
      byKey.set(k, list);
    }
  }
  const changed: string[] = [];
  byKey.forEach((list, key) => {
    const ch = schema[key] ?? { reducer: "overwrite" as const };
    if (ch.reducer === "overwrite" && list.length > 1) {
      throw new GraphRuntimeError({
        type: "InvalidUpdateError",
        message: `At key '${key}': Can receive only one value per step. Use an Annotated key to handle multiple values.`,
        expected: `one write to '${key}' per super-step, or a reducer such as Annotated[list, operator.add]`,
        received: `${list.length} writes in the same step from: ${list.map((x) => x.node).join(", ")}`,
        hint: `Two parallel nodes updated '${key}'. Give the key a reducer (append/add/merge) or write to different keys.`,
      });
    }
    const before = JSON.stringify(next[key]);
    for (const { value } of list) {
      switch (ch.reducer) {
        case "append": {
          const cur = Array.isArray(next[key]) ? (next[key] as unknown[]) : [];
          next[key] = [...cur, ...(Array.isArray(value) ? value : [value])];
          break;
        }
        case "add":
          next[key] = (Number(next[key]) || 0) + (Number(value) || 0);
          break;
        case "merge":
          next[key] = { ...((next[key] as object) ?? {}), ...((value as object) ?? {}) };
          break;
        default:
          next[key] = value;
      }
    }
    if (JSON.stringify(next[key]) !== before) changed.push(key);
  });
  return { state: next, changedKeys: changed };
}

/** What `builder.compile()` would reject. */
export function validateDefinition(def: GraphDefinition): NodeErrorInfo | null {
  const names = new Set(def.nodes.map((n) => n.name));
  const known = (n: string) => n === START || n === END || names.has(n);
  const hasEntry = def.edges.some((e) => e.source === START) || def.conditionalEdges.some((c) => c.source === START);
  if (!hasEntry)
    return {
      type: "ValueError",
      message: "Graph must have an entrypoint: add at least one edge from START to another node.",
      hint: "Connect the START node to your first node.",
    };
  for (const e of def.edges) {
    if (!known(e.source)) return { type: "ValueError", message: `Found edge starting at unknown node '${e.source}'` };
    if (!known(e.target)) return { type: "ValueError", message: `Found edge ending at unknown node '${e.target}'` };
    if (e.source === END) return { type: "ValueError", message: "END cannot be the start of an edge" };
  }
  for (const c of def.conditionalEdges) {
    if (!known(c.source)) return { type: "ValueError", message: `Conditional edge from unknown node '${c.source}'` };
    for (const t of c.targets) if (!known(t)) return { type: "ValueError", message: `Conditional edge from '${c.source}' can route to unknown node '${t}'` };
  }
  return null;
}

export async function runGraph(def: GraphDefinition, input: GraphState | null, opts: RunOptions): Promise<RunTrace> {
  const runId = uid("run");
  const recursionLimit = opts.recursionLimit ?? 25;
  const cpr = opts.checkpointer ?? null;
  const threadId = opts.threadId;
  const nodeMap = new Map(def.nodes.map((n) => [n.name, n]));
  const emit = (e: EngineEvent) => opts.onEvent?.(e);
  const trace: RunTrace = {
    runId,
    threadId,
    status: "running",
    input,
    spans: [],
    routes: [],
    steps: [],
    finalState: {},
    checkpoints: [],
    totals: { simLatencyMs: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, llmCalls: 0, steps: 0 },
  };
  emit({ type: "run_start", runId });

  let state: GraphState = initState(def.schema);
  let step = 0;
  let pending: Task[] = [];
  let parentId: string | undefined;
  let carried: { node: string; update: Partial<GraphState> | null; goto?: string[] }[] = [];
  let resume: { node: string; value: unknown } | null = null;
  const joinProgress = new Map<string, Set<string>>();

  const finish = () => {
    trace.finalState = state;
    for (const s of trace.spans)
      for (const c of s.llmCalls) {
        trace.totals.inputTokens += c.inputTokens;
        trace.totals.outputTokens += c.outputTokens;
        trace.totals.reasoningTokens += c.reasoningTokens;
        trace.totals.costUsd += c.costUsd;
        trace.totals.llmCalls += 1;
      }
    trace.totals.simLatencyMs = trace.steps.length ? trace.steps[trace.steps.length - 1].simEndMs : 0;
    trace.totals.steps = trace.steps.length;
    emit({ type: "run_end", trace });
    return trace;
  };

  const fail = (info: NodeErrorInfo, atStep?: number) => {
    trace.status = "error";
    trace.error = { ...info, step: atStep };
    return finish();
  };

  const saveCheckpoint = (cp: Omit<Checkpoint, "id" | "createdAt" | "threadId">) => {
    if (!cpr || !threadId) return;
    const saved = cpr.put({ ...cp, threadId, parentId });
    parentId = saved.id;
    trace.checkpoints.push(saved);
  };

  const invalid = validateDefinition(def);
  if (invalid) return fail(invalid);

  const nextFrom = (source: string, st: GraphState, atStep: number): Task[] => {
    const tasks: Task[] = def.edges.filter((e) => e.source === source).map((e) => ({ node: e.target }));
    for (const ce of def.conditionalEdges.filter((c) => c.source === source)) {
      let r: unknown;
      try {
        r = ce.route(st);
      } catch (err) {
        throw new GraphRuntimeError({
          type: "RoutingError",
          message: `Routing function after '${source}' raised: ${(err as Error).message}`,
          node: source,
          hint: "Routing functions must handle every possible state (including missing keys).",
        });
      }
      const arr = (Array.isArray(r) ? r : [r]) as (string | SendTask)[];
      const names = arr.map((x) => (isSend(x) ? `Send(${x.node})` : String(x)));
      const decision = {
        step: atStep,
        source,
        routerId: ce.routerId,
        label: ce.label,
        result: names,
        explanation: ce.explain ? ce.explain(st, names) : `→ ${names.join(", ")}`,
      };
      trace.routes.push(decision);
      emit({ type: "route", decision });
      arr.forEach((x, i) => {
        if (isSend(x)) tasks.push({ node: x.node, arg: x.arg, index: i });
        else if (typeof x === "string") tasks.push({ node: x });
      });
    }
    return tasks;
  };

  try {
    if (opts.resume || opts.fromCheckpointId) {
      if (!cpr || !threadId)
        return fail({
          type: "ValueError",
          message: "Resuming or replaying requires a checkpointer and a thread_id: config={'configurable': {'thread_id': ...}}",
        });
      const cp = opts.fromCheckpointId ? cpr.get(threadId, opts.fromCheckpointId) : cpr.latest(threadId);
      if (!cp) return fail({ type: "ValueError", message: `No checkpoint found for thread '${threadId}'` });
      state = deepClone(cp.values);
      step = cp.step < 0 ? 0 : cp.step;
      parentId = cp.id;
      pending = cp.next.map((n) => ({ node: n }));
      if (cp.step < 0) step = 0;
      if (opts.resume) {
        if (!cp.interrupt) return fail({ type: "InvalidResume", message: "This thread has no pending interrupt to resume." });
        resume = { node: cp.interrupt.node, value: opts.resume.value };
        carried = cp.pendingWrites ?? [];
      }
      if (input && opts.fromCheckpointId) {
        // graph.update_state(config, values): a new checkpoint that forks the thread's history
        state = applyWrites(def.schema, state, [{ node: "__fork__", update: input }]).state;
        saveCheckpoint({ step: cp.step, values: state, next: cp.next, source: "update", writers: ["update_state"] });
      }
    } else {
      if (input) state = applyWrites(def.schema, state, [{ node: START, update: input }]).state;
      pending = nextFrom(START, state, -1);
      saveCheckpoint({ step: -1, values: state, next: pending.map((t) => t.node).filter((n) => n !== END), source: "input", writers: ["__input__"] });
      step = 0;
    }
    pending = pending.filter((t) => t.node !== END);
    let simClock = 0;

    while (pending.length) {
      if (opts.signal?.aborted) throw new GraphRuntimeError({ type: "Cancelled", message: "Run cancelled." });
      if (step >= recursionLimit) {
        throw new GraphRuntimeError({
          type: "GraphRecursionError",
          message: `Recursion limit of ${recursionLimit} reached without hitting a stop condition. You can increase the limit by setting the \`recursion_limit\` config key.`,
          hint: "A cycle's exit condition is never met. Add an attempt counter to the state and route to END when it's exceeded.",
        });
      }
      for (const t of pending)
        if (!nodeMap.has(t.node))
          throw new GraphRuntimeError({ type: "ValueError", message: `Tried to run unknown node '${t.node}'`, hint: "A router returned a name that isn't a node in the graph." });

      let runnable = pending.filter((t) => !nodeMap.get(t.node)?.defer);
      let deferred = pending.filter((t) => nodeMap.get(t.node)?.defer);
      if (!runnable.length) {
        runnable = deferred;
        deferred = [];
      }
      const carriedNodes = new Set(carried.map((c) => c.node));
      const toRun = runnable.filter((t) => !carriedNodes.has(t.node));
      const stepNodes = runnable.map((t) => (t.index !== undefined ? `${t.node}[${t.index}]` : t.node));

      if (opts.gate) await opts.gate(step, stepNodes);
      emit({ type: "step_start", step, nodes: stepNodes, state: deepClone(state) });
      const stepStart = simClock;
      const snapshot = deepClone(state);
      const currentStep = step;
      const currentResume = resume;

      const results = await Promise.all(
        toRun.map(async (task) => {
          const nd = nodeMap.get(task.node)!;
          const maxAttempts = Math.max(1, nd.retry?.maxAttempts ?? 1);
          let offset = 0;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const input = task.arg ? deepClone(task.arg) : deepClone(snapshot);
            const span: NodeSpan = {
              id: uid("span"),
              node: task.index !== undefined ? `${task.node}[${task.index}]` : task.node,
              kind: nd.kind ?? "function",
              label: nd.label ?? task.node,
              step: currentStep,
              attempt,
              status: "success",
              stateBefore: input,
              update: null,
              stateAfter: null,
              llmCalls: [],
              logs: [],
              simStartMs: stepStart + offset,
              simDurationMs: 0,
            };
            let extra = 0;
            const ctx: NodeContext = {
              step: currentStep,
              node: task.node,
              llm: (req) => opts.llm(req),
              recordLLM: (rec) => {
                span.llmCalls.push(rec);
                extra += rec.latencyMs;
              },
              interrupt: <T,>(payload: unknown): T => {
                if (currentResume && currentResume.node === task.node) return currentResume.value as T;
                throw new GraphInterrupt(payload, task.node);
              },
              log: (m) => span.logs.push(m),
              addLatency: (ms) => {
                extra += ms;
              },
            };
            emit({ type: "node_start", step: currentStep, node: span.node });
            try {
              const out = await nd.fn(input, ctx);
              span.simDurationMs = Math.max(3, extra);
              if (opts.pace) await opts.pace(span.simDurationMs);
              let update: Partial<GraphState> | null = null;
              let goto: string[] | undefined;
              if (isCommand(out)) {
                update = out.update ?? null;
                goto = out.goto === undefined ? undefined : Array.isArray(out.goto) ? out.goto : [out.goto];
              } else if (out !== undefined && out !== null) {
                if (typeof out !== "object" || Array.isArray(out)) {
                  throw new GraphRuntimeError({
                    type: "InvalidUpdateError",
                    message: `Expected dict, got ${Array.isArray(out) ? "list" : typeof out}. Nodes must return a dict of state updates.`,
                    received: JSON.stringify(out).slice(0, 200),
                    expected: "{ key: value, ... }",
                  });
                }
                update = out as Partial<GraphState>;
              }
              span.update = update;
              span.goto = goto;
              trace.spans.push(span);
              emit({ type: "node_end", step: currentStep, node: span.node, span });
              return { node: task.node, span, update, goto, interrupt: undefined as InterruptInfo | undefined, error: undefined as NodeErrorInfo | undefined };
            } catch (err) {
              span.simDurationMs = Math.max(3, extra);
              if (opts.pace) await opts.pace(span.simDurationMs);
              if (err instanceof GraphInterrupt) {
                span.status = "interrupted";
                const info: InterruptInfo = { id: uid("intr"), node: task.node, payload: err.payload };
                trace.spans.push(span);
                emit({ type: "node_end", step: currentStep, node: span.node, span });
                return { node: task.node, span, update: null, goto: undefined, interrupt: info, error: undefined };
              }
              const info: NodeErrorInfo =
                err instanceof GraphRuntimeError ? { ...err.info, node: task.node } : { type: (err as Error)?.name || "Error", message: (err as Error)?.message ?? String(err), node: task.node };
              span.status = "error";
              span.error = info;
              trace.spans.push(span);
              emit({ type: "node_end", step: currentStep, node: span.node, span });
              if (attempt < maxAttempts) {
                span.logs.push(`RetryPolicy: attempt ${attempt}/${maxAttempts} failed (${info.type}); retrying with backoff`);
                offset += span.simDurationMs + 250 * attempt;
                continue;
              }
              return { node: task.node, span, update: null, goto: undefined, interrupt: undefined, error: info };
            }
          }
          throw new Error("unreachable");
        }),
      );

      const stepEnd = results.reduce((m, r) => Math.max(m, r.span.simStartMs + r.span.simDurationMs), stepStart);
      trace.steps.push({ step: currentStep, nodes: stepNodes, simStartMs: stepStart, simEndMs: stepEnd });
      simClock = stepEnd;

      const errored = results.find((r) => r.error);
      if (errored) throw new GraphRuntimeError(errored.error!);

      const interrupted = results.filter((r) => r.interrupt);
      if (interrupted.length) {
        const info = interrupted[0].interrupt!;
        if (!cpr || !threadId) {
          throw new GraphRuntimeError({
            type: "ValueError",
            message: "interrupt() requires a checkpointer. Compile with checkpointer=InMemorySaver() and invoke with a thread_id.",
            node: info.node,
            hint: "Turn on the checkpointer (persistence) for this run.",
          });
        }
        const completed = [...carried, ...results.filter((r) => !r.interrupt).map((r) => ({ node: r.node, update: r.update, goto: r.goto }))];
        saveCheckpoint({
          step: currentStep,
          values: state,
          next: [...runnable, ...deferred].map((t) => t.node),
          source: "interrupt",
          interrupt: info,
          pendingWrites: completed,
          writers: [],
        });
        trace.status = "interrupted";
        trace.interrupt = info;
        emit({ type: "interrupt", info });
        return finish();
      }

      const writes = [...carried, ...results.map((r) => ({ node: r.node, update: r.update, goto: r.goto }))];
      carried = [];
      resume = null;
      const applied = applyWrites(def.schema, state, writes);
      state = applied.state;
      for (const r of results) r.span.stateAfter = deepClone(state);

      const next: Task[] = [];
      const seen = new Set<string>();
      const add = (t: Task) => {
        if (t.node === END) return;
        if (t.arg) {
          next.push(t);
          return;
        }
        if (seen.has(t.node)) return;
        seen.add(t.node);
        next.push(t);
      };
      for (const w of writes) {
        w.goto?.forEach((g) => add({ node: g }));
        nextFrom(w.node, state, currentStep).forEach(add);
        for (const j of def.joinEdges ?? []) {
          if (!j.sources.includes(w.node)) continue;
          const s = joinProgress.get(j.target) ?? new Set<string>();
          s.add(w.node);
          if (j.sources.every((x) => s.has(x))) {
            add({ node: j.target });
            joinProgress.delete(j.target);
          } else joinProgress.set(j.target, s);
        }
      }
      deferred.forEach(add);
      pending = next;
      emit({ type: "step_end", step: currentStep, state: deepClone(state), next: pending.map((t) => t.node), changedKeys: applied.changedKeys });
      saveCheckpoint({ step: currentStep, values: state, next: pending.map((t) => t.node), source: "loop", writers: writes.map((w) => w.node) });
      step++;
    }
    trace.status = "success";
    return finish();
  } catch (err) {
    if (err instanceof GraphRuntimeError) return fail(err.info, step);
    return fail({ type: (err as Error)?.name || "Error", message: (err as Error)?.message ?? String(err) }, step);
  }
}

export { START, END };
