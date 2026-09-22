"use client";

import { AlertTriangle, CheckCircle2, Hand, PauseCircle, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { JsonBlock, StateDiffView } from "@/components/learn/JsonView";
import { Badge, Button, Callout, Input, Select, Tabs } from "@/components/ui";
import { INTENTS, PRODUCTS, SENTIMENTS } from "@/lib/domain";
import type { InterruptInfo, NodeSpan, RouteDecision } from "@/lib/engine/types";
import { getPromptVersion, getTask } from "@/lib/ai/tasks";
import { schemaToTypeString } from "@/lib/ai/schema";
import { describeRouter, type HumanDecision } from "@/lib/workflows/compile";
import type { FunctionNodeConfig, HumanNodeConfig, LLMNodeConfig, RouterConfig, ToolNodeConfig, WfNode, WorkflowSpec } from "@/lib/workflows/spec";
import { FUNCTION_INFO, KIND_INFO, TOOL_INFO } from "@/lib/workflows/spec";
import { cn, fmtMs, fmtUsd } from "@/lib/utils";
import { KindIcon } from "./FlowDiagram";
import type { TimelineEntry } from "./useWorkflowRunner";

// ---------------------------------------------------------------- State timeline
export function StateTimeline({ timeline, hideKeys = ["transcript", "cleaned_transcript"], compact }: { timeline: TimelineEntry[]; hideKeys?: string[]; compact?: boolean }) {
  const [sel, setSel] = useState<number | null>(null);
  const idx = sel === null ? timeline.length - 1 : Math.min(sel, timeline.length - 1);
  const cur = timeline[idx];
  const [showLong, setShowLong] = useState(false);
  if (!timeline.length) return <div className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-3">Run the workflow to watch the state change step by step.</div>;
  return (
    <div className={cn("grid gap-3", compact ? "" : "md:grid-cols-[220px_1fr]")}>
      <div className={cn("flex gap-1 overflow-x-auto", compact ? "flex-row" : "md:flex-col")}>
        {timeline.map((t, i) => (
          <button
            key={t.id}
            onClick={() => setSel(i)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
              i === idx ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:border-line-strong",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                t.kind === "error" ? "bg-bad" : t.kind === "interrupt" ? "bg-n-human" : t.kind === "input" ? "bg-ink-3" : "bg-accent",
              )}
            />
            <span className="max-w-[180px] truncate">{t.label}</span>
            {t.changedKeys.length > 0 && t.kind === "step" && <span className="ml-auto text-[10px] text-good-ink">+{t.changedKeys.length}</span>}
          </button>
        ))}
      </div>
      {cur && (
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-ink-3">
              {cur.kind === "step" ? (
                <>
                  State after <strong className="text-ink">{cur.nodes.join(", ")}</strong> ·{" "}
                  {cur.changedKeys.length ? (
                    <>
                      updated: <span className="font-mono text-good-ink">{cur.changedKeys.join(", ")}</span>
                    </>
                  ) : (
                    "no keys changed"
                  )}
                </>
              ) : (
                cur.label
              )}
            </div>
            <button onClick={() => setShowLong(!showLong)} className="text-xs text-accent">
              {showLong ? "hide transcript keys" : "show transcript keys"}
            </button>
          </div>
          <StateDiffView state={cur.state} before={cur.before} hideKeys={showLong ? [] : hideKeys} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- node config summary
export function NodeConfigSummary({ node }: { node: WfNode }) {
  const kind = KIND_INFO[node.kind];
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="text-ink-2">{kind.description}</div>
      {node.kind === "llm" &&
        (() => {
          const cfg = node.config as LLMNodeConfig;
          const t = getTask(cfg.task);
          const pv = getPromptVersion(cfg.task, cfg.promptVersion);
          return (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="llm">{t?.label ?? cfg.task}</Badge>
                <Badge>{pv?.label ?? "custom prompt"}</Badge>
                <Badge>{cfg.model.replace("sim:", "")}</Badge>
                <Badge>T={cfg.temperature}</Badge>
                <Badge>max {cfg.maxTokens} tok</Badge>
                {cfg.onParseError === "store" && <Badge tone="warn">stores parse errors</Badge>}
                {cfg.retries > 1 && <Badge tone="accent">retry ×{cfg.retries}</Badge>}
              </div>
              {t && (
                <div className="text-xs text-ink-3">
                  Writes <span className="font-mono text-ink-2">{Object.values(t.outputs).join(", ")}</span> · expects{" "}
                  <span className="font-mono text-ink-2">{schemaToTypeString(t.schema, " ").replace(/\n/g, " ")}</span>
                </div>
              )}
            </>
          );
        })()}
      {node.kind === "function" && (
        <div className="text-xs text-ink-3">
          {FUNCTION_INFO[(node.config as FunctionNodeConfig).fn].description} Writes{" "}
          <span className="font-mono text-ink-2">{FUNCTION_INFO[(node.config as FunctionNodeConfig).fn].writes.join(", ") || "(custom)"}</span>
        </div>
      )}
      {node.kind === "router" && (
        <div className="text-xs text-ink-3">
          Routing function: <code className="font-mono text-ink-2">{describeRouter(node.config as RouterConfig)}</code>
        </div>
      )}
      {node.kind === "tool" && <div className="text-xs text-ink-3">{TOOL_INFO[(node.config as ToolNodeConfig).tool].description}</div>}
      {node.kind === "human" && <div className="text-xs text-ink-3">Asks: “{(node.config as HumanNodeConfig).question}” · reviewer can edit: {(node.config as HumanNodeConfig).fields.join(", ")}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- span inspector
type SpanTab = "input" | "prompt" | "output" | "parsed" | "update" | "after" | "logs";

export function SpanInspector({ span }: { span: NodeSpan }) {
  const call = span.llmCalls[0];
  const tabs: { id: SpanTab; label: string }[] = [
    { id: "input", label: "Input" },
    ...(call
      ? ([
          { id: "prompt", label: "Prompt" },
          { id: "output", label: "LLM output" },
          { id: "parsed", label: "Parsed" },
        ] as { id: SpanTab; label: string }[])
      : []),
    { id: "update", label: "Update" },
    { id: "after", label: "State after" },
    ...(span.logs.length ? ([{ id: "logs", label: "Logs" }] as { id: SpanTab; label: string }[]) : []),
  ];
  const [tab, setTab] = useState<SpanTab>(call ? "prompt" : "update");
  const t = tabs.find((x) => x.id === tab) ? tab : tabs[0].id;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge tone={span.kind === "llm" ? "llm" : span.kind === "human" ? "human" : span.kind === "tool" ? "tool" : "fn"}>{span.kind}</Badge>
        <Badge>step {span.step}</Badge>
        {span.attempt > 1 && <Badge tone="warn">attempt {span.attempt}</Badge>}
        <Badge tone={span.status === "success" ? "good" : span.status === "error" ? "bad" : "warn"}>{span.status}</Badge>
        <Badge>{fmtMs(span.simDurationMs)}</Badge>
        {call && (
          <>
            <Badge>
              {call.inputTokens} in / {call.outputTokens} out{call.reasoningTokens ? ` / ${call.reasoningTokens} reasoning` : ""} tok
            </Badge>
            <Badge>{fmtUsd(call.costUsd, { precise: true })}</Badge>
            <Badge tone={call.simulated ? "neutral" : "warn"}>{call.simulated ? "simulated" : "live"} · {call.model.replace("sim:", "")}</Badge>
          </>
        )}
      </div>
      {span.error && <ErrorBox error={span.error} />}
      <Tabs tabs={tabs} value={t} onChange={setTab} size="sm" />
      <div className="min-h-[120px]">
        {t === "input" && <StateDiffView state={span.stateBefore} hideKeys={[]} maxValue={400} />}
        {t === "prompt" && call && (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">System</div>
            <JsonBlock value={call.system} />
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">User {call.promptVersion ? `(${call.promptVersion.toUpperCase()})` : ""}</div>
            <JsonBlock value={call.prompt} maxHeight={320} />
            <div className="text-[11px] text-ink-3">
              temperature={call.temperature} · max_tokens={call.maxTokens}
            </div>
          </div>
        )}
        {t === "output" && call && (
          <div className="flex flex-col gap-2">
            <JsonBlock value={call.rawOutput || "(empty string)"} maxHeight={320} />
            <div className="flex flex-wrap gap-3 text-[11px] text-ink-3">
              <span>stop_reason: <span className={cn("font-mono", call.stopReason === "max_tokens" ? "text-bad-ink" : "text-ink-2")}>{call.stopReason ?? "—"}</span></span>
              <span>latency {fmtMs(call.latencyMs)} (TTFT {fmtMs(call.ttftMs)})</span>
            </div>
          </div>
        )}
        {t === "parsed" && call && (
          <div className="flex flex-col gap-2">
            {call.parsed ? <JsonBlock value={call.parsed} /> : <Callout kind="danger" title="Parsing failed">{call.parseError?.message}</Callout>}
            {call.parseSteps && (
              <ol className="list-decimal pl-5 text-xs text-ink-2">
                {call.parseSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
          </div>
        )}
        {t === "update" && (span.update ? <JsonBlock value={span.update} /> : <div className="text-sm text-ink-3">{span.status === "interrupted" ? "Paused before returning an update." : "No update returned."}</div>)}
        {t === "after" && (span.stateAfter ? <StateDiffView state={span.stateAfter} before={span.stateBefore} hideKeys={["transcript", "cleaned_transcript"]} /> : <div className="text-sm text-ink-3">State wasn&apos;t updated (the step failed or paused).</div>)}
        {t === "logs" && (
          <ul className="flex flex-col gap-1 font-mono text-xs text-ink-2">
            {span.logs.map((l, i) => (
              <li key={i}>› {l}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: { type: string; message: string; node?: string; expected?: string; received?: string; hint?: string } }) {
  return (
    <div className="rounded-lg border border-bad/40 bg-bad-soft p-3 text-sm">
      <div className="flex items-center gap-2 font-semibold text-bad-ink">
        <XCircle className="h-4 w-4" />
        {error.type}
        {error.node && <span className="font-normal text-ink-2">in node “{error.node}”</span>}
      </div>
      <div className="mt-1 text-ink">{error.message}</div>
      {(error.expected || error.received) && (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {error.expected && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase text-ink-3">Expected</div>
              <pre className="overflow-auto rounded-md bg-surface px-2 py-1.5 font-mono text-[11.5px] text-ink">{error.expected}</pre>
            </div>
          )}
          {error.received && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase text-ink-3">Received</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface px-2 py-1.5 font-mono text-[11.5px] text-ink">{error.received}</pre>
            </div>
          )}
        </div>
      )}
      {error.hint && <div className="mt-2 text-xs text-ink-2">💡 {error.hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- node inspector (select node on diagram)
export function NodeInspector({ node, spans }: { node: WfNode; spans: NodeSpan[] }) {
  const mine = spans.filter((s) => s.node.replace(/\[\d+\]$/, "") === node.id);
  const [i, setI] = useState(mine.length - 1);
  const idx = Math.max(0, Math.min(i < 0 ? mine.length - 1 : i, mine.length - 1));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <KindIcon kind={node.kind} className="text-ink-2" />
        <span className="text-sm font-semibold text-ink">{node.label}</span>
        <code className="font-mono text-[11px] text-ink-3">{node.id}</code>
      </div>
      <NodeConfigSummary node={node} />
      {mine.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-ink-3">Executions:</span>
          {mine.map((s, k) => (
            <button key={s.id} onClick={() => setI(k)} className={cn("rounded-md border px-2 py-0.5", k === idx ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2")}>
              #{k + 1} · step {s.step}
            </button>
          ))}
        </div>
      )}
      {mine.length ? <SpanInspector key={mine[idx].id} span={mine[idx]} /> : node.kind === "router" ? null : <div className="rounded-lg border border-dashed border-line-strong p-4 text-center text-xs text-ink-3">This node hasn&apos;t run yet in this session.</div>}
    </div>
  );
}

// ---------------------------------------------------------------- trace table + waterfall
export function TraceTable({ spans, routes, onSelect, selectedId }: { spans: NodeSpan[]; routes: RouteDecision[]; onSelect?: (span: NodeSpan) => void; selectedId?: string }) {
  const total = spans.reduce((m, s) => Math.max(m, s.simStartMs + s.simDurationMs), 0) || 1;
  const byStep = useMemo(() => {
    const m = new Map<number, NodeSpan[]>();
    spans.forEach((s) => m.set(s.step, [...(m.get(s.step) ?? []), s]));
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [spans]);
  if (!spans.length) return <div className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-3">No trace yet. Run the workflow.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="text-[10.5px] uppercase tracking-wide text-ink-3">
          <tr className="border-b border-line">
            <th className="py-1.5 pr-2 font-medium">#</th>
            <th className="py-1.5 pr-2 font-medium">Node</th>
            <th className="py-1.5 pr-2 font-medium">Status</th>
            <th className="w-[34%] py-1.5 pr-2 font-medium">Timeline (simulated)</th>
            <th className="py-1.5 pr-2 text-right font-medium">Time</th>
            <th className="py-1.5 pr-2 text-right font-medium">Tokens</th>
            <th className="py-1.5 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {byStep.map(([step, list]) => (
            <StepRows key={step} step={step} list={list} total={total} routes={routes.filter((r) => r.step === step)} onSelect={onSelect} selectedId={selectedId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StepRows({ step, list, total, routes, onSelect, selectedId }: { step: number; list: NodeSpan[]; total: number; routes: RouteDecision[]; onSelect?: (s: NodeSpan) => void; selectedId?: string }) {
  return (
    <>
      {list.map((s, i) => {
        const tokens = s.llmCalls.reduce((a, c) => a + c.inputTokens + c.outputTokens + c.reasoningTokens, 0);
        const cost = s.llmCalls.reduce((a, c) => a + c.costUsd, 0);
        return (
          <tr
            key={s.id}
            onClick={() => onSelect?.(s)}
            className={cn("cursor-pointer border-b border-line/60 hover:bg-surface-2", selectedId === s.id && "bg-accent-soft")}
          >
            <td className="py-1.5 pr-2 font-mono text-ink-3">{i === 0 ? step : ""}</td>
            <td className="py-1.5 pr-2">
              <span className="flex items-center gap-1.5 font-medium text-ink">
                <KindIcon kind={s.kind} className="text-ink-3" />
                {s.label}
                {s.attempt > 1 && <span className="text-warn-ink">(retry {s.attempt})</span>}
              </span>
            </td>
            <td className="py-1.5 pr-2">
              {s.status === "success" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-good-ink" />
              ) : s.status === "error" ? (
                <AlertTriangle className="h-3.5 w-3.5 text-bad-ink" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5 text-n-human" />
              )}
            </td>
            <td className="py-1.5 pr-2">
              <div className="relative h-3 w-full rounded-sm bg-surface-2">
                <div
                  className={cn("absolute top-0 h-3 rounded-sm", s.status === "error" ? "bg-bad" : s.kind === "llm" ? "bg-n-llm" : s.kind === "tool" ? "bg-n-tool" : s.kind === "human" ? "bg-n-human" : "bg-n-fn")}
                  style={{ left: `${(s.simStartMs / total) * 100}%`, width: `${Math.max(0.8, (s.simDurationMs / total) * 100)}%` }}
                  title={`${fmtMs(s.simStartMs)} → ${fmtMs(s.simStartMs + s.simDurationMs)}`}
                />
              </div>
            </td>
            <td className="num py-1.5 pr-2 text-right font-mono text-ink-2">{fmtMs(s.simDurationMs)}</td>
            <td className="num py-1.5 pr-2 text-right font-mono text-ink-2">{tokens || "—"}</td>
            <td className="num py-1.5 text-right font-mono text-ink-2">{cost ? fmtUsd(cost, { precise: true }) : "—"}</td>
          </tr>
        );
      })}
      {routes.map((r, i) => (
        <tr key={`r${i}`} className="border-b border-line/60">
          <td />
          <td colSpan={6} className="py-1 pr-2 text-[11px] text-ink-3">
            ↳ route after <span className="font-mono text-ink-2">{r.source === "__start__" ? "START" : r.source}</span>: <span className="font-mono text-n-router">{r.explanation}</span>
          </td>
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- human review
export function HumanReviewPanel({ info, onResume, busy }: { info: InterruptInfo; onResume: (d: HumanDecision) => void; busy?: boolean }) {
  const payload = (info.payload ?? {}) as { question?: string; prediction?: Record<string, unknown>; confidence?: number; fields?: string[] };
  const fields = payload.fields ?? Object.keys(payload.prediction ?? {});
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f, String(payload.prediction?.[f] ?? "")])));
  const [note, setNote] = useState("");
  const optionsFor = (f: string): readonly string[] | null => (f === "intent" ? INTENTS : f === "product" ? PRODUCTS : f === "sentiment" ? SENTIMENTS : null);
  const changed = fields.filter((f) => values[f] !== String(payload.prediction?.[f] ?? ""));
  return (
    <div className="fade-in rounded-xl border-2 border-n-human/60 bg-surface p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
        <Hand className="h-4 w-4 text-n-human" />
        Graph paused at “{info.node}” — waiting for a human
      </div>
      <div className="mb-3 text-xs text-ink-3">
        interrupt() saved a checkpoint and stopped the run. Your answer is sent back with <code className="font-mono">Command(resume=…)</code>; the node then re-runs and interrupt() returns your answer.
      </div>
      <div className="mb-3 text-sm text-ink-2">
        {payload.question} {typeof payload.confidence === "number" && <Badge tone="warn">model confidence {payload.confidence}</Badge>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) => {
          const opts = optionsFor(f);
          return (
            <label key={f} className="text-xs font-medium text-ink-2">
              {f} <span className="font-normal text-ink-3">(model: {String(payload.prediction?.[f])})</span>
              {opts ? (
                <Select className="mt-1" value={values[f]} onChange={(v) => setValues((cur) => ({ ...cur, [f]: v }))} options={opts.map((o) => ({ value: o, label: o }))} />
              ) : (
                <Input className="mt-1" value={values[f]} onChange={(e) => setValues((cur) => ({ ...cur, [f]: e.target.value }))} />
              )}
            </label>
          );
        })}
      </div>
      <Input className="mt-2" placeholder="Reviewer note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={() => onResume(changed.length ? { action: "correct", corrections: Object.fromEntries(changed.map((f) => [f, values[f]])), note } : { action: "approve", note })}>
          {changed.length ? `Resume with correction (${changed.join(", ")})` : "Approve & resume"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => onResume({ action: "reject", note: note || "rejected by reviewer" })}>
          Reject & resume
        </Button>
      </div>
    </div>
  );
}

export function specNode(spec: WorkflowSpec, id: string | null | undefined) {
  return id ? spec.nodes.find((n) => n.id === id) : undefined;
}
