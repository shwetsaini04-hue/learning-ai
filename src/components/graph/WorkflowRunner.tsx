"use client";

import { Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { CodeBlock } from "@/components/learn/CodeBlock";
import { JsonBlock } from "@/components/learn/JsonView";
import { Badge, Button, Select, Tabs, TextArea, Toggle } from "@/components/ui";
import { transcriptToText } from "@/lib/domain";
import type { RunTrace } from "@/lib/engine/types";
import { TRANSCRIPTS, findTranscript, lookupKnownTranscript } from "@/lib/sim/transcripts";
import { useProgress } from "@/lib/store/progress";
import { cn, fmtMs, fmtUsd } from "@/lib/utils";
import { generatePython } from "@/lib/workflows/codegen";
import type { WorkflowSpec } from "@/lib/workflows/spec";
import { FlowDiagram, StatusLegend } from "./FlowDiagram";
import { ErrorBox, HumanReviewPanel, NodeInspector, StateTimeline, TraceTable, specNode } from "./Inspectors";
import { useWorkflowRunner } from "./useWorkflowRunner";

export function TranscriptPicker({
  value,
  onChange,
  customText,
  onCustomText,
  allowCustom = true,
  ids,
}: {
  value: string;
  onChange: (id: string) => void;
  customText?: string;
  onCustomText?: (t: string) => void;
  allowCustom?: boolean;
  ids?: string[];
}) {
  const list = ids ? TRANSCRIPTS.filter((t) => ids.includes(t.id)) : TRANSCRIPTS;
  return (
    <div className="flex flex-col gap-2">
      <Select
        value={value}
        onChange={onChange}
        options={[
          ...list.map((t) => ({ value: t.id, label: `${t.id} · ${t.title}${t.tags.includes("hard") ? " (hard)" : ""}` })),
          ...(allowCustom ? [{ value: "custom", label: "✎ Write your own transcript…" }] : []),
        ]}
      />
      {value === "custom" && onCustomText && (
        <TextArea
          rows={6}
          value={customText}
          onChange={(e) => onCustomText(e.target.value)}
          placeholder={"Agent: Hello, how can I help?\nCustomer: I want to know about car loans…"}
          className="font-mono text-xs"
        />
      )}
    </div>
  );
}

export function TranscriptView({ id, text, className, showNote = true }: { id?: string; text?: string; className?: string; showNote?: boolean }) {
  const t = id ? findTranscript(id) : undefined;
  const lines = t ? t.turns : (text ?? "").split("\n").map((l) => ({ speaker: /^agent/i.test(l) ? "Agent" : "Customer", text: l.replace(/^(agent|customer)\s*:\s*/i, "") }));
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-lg border border-line bg-surface-2 p-3 text-[13px]", className)}>
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2">
          <span className={cn("w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wide", l.speaker === "Agent" ? "text-ink-3" : "text-accent")}>{l.speaker}</span>
          <span className="text-ink">{l.text}</span>
        </div>
      ))}
      {showNote && t?.note && <div className="mt-1 border-t border-line pt-2 text-xs text-ink-3">Why it&apos;s interesting: {t.note}</div>}
    </div>
  );
}

type Panel = "inspect" | "state" | "trace" | "python" | "output";

type RunnerProps = Parameters<typeof WorkflowRunnerInner>[0];

/** Remounts (and so fully resets) whenever a different workflow is passed in. */
export function WorkflowRunner(props: RunnerProps) {
  return <WorkflowRunnerInner key={props.spec.id} {...props} />;
}

function WorkflowRunnerInner({
  spec,
  defaultTranscript = "t01",
  transcriptIds,
  allowCustom = true,
  panels = ["inspect", "state", "trace", "python"],
  defaultPanel,
  onRunComplete,
  counter = "playground_runs",
  header,
  diagramHeight = 520,
  showTranscript = true,
}: {
  spec: WorkflowSpec;
  defaultTranscript?: string;
  transcriptIds?: string[];
  allowCustom?: boolean;
  panels?: Panel[];
  defaultPanel?: Panel;
  onRunComplete?: (t: RunTrace) => void;
  counter?: string;
  header?: ReactNode;
  diagramHeight?: number;
  showTranscript?: boolean;
}) {
  const r = useWorkflowRunner(spec);
  const bump = useProgress((s) => s.bump);
  const [tid, setTid] = useState(defaultTranscript);
  const [custom, setCustom] = useState("Agent: Good morning, how can I help?\nCustomer: I saw your car loan ad. What's the interest rate for a 6 lakh loan? If it's under 10% I'd like to apply.");
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(defaultPanel ?? panels[0]);
  const [lastTrace, setLastTrace] = useState<RunTrace | null>(null);

  const input = useMemo(() => {
    if (tid === "custom") {
      const known = lookupKnownTranscript(custom);
      return { transcript: custom, transcript_id: known?.id ?? null };
    }
    const t = findTranscript(tid)!;
    return { transcript: transcriptToText(t), transcript_id: t.id };
  }, [tid, custom]);

  const go = async () => {
    setSelected(null);
    const t = await r.run(input);
    setLastTrace(t);
    bump(counter, `${spec.name} on ${tid}`);
    onRunComplete?.(t);
    if (t.status === "error" && t.error?.node) {
      setSelected(t.error.node);
      if (panels.includes("inspect")) setPanel("inspect");
    }
  };

  const doResume = async (value: unknown) => {
    const t = await r.resume(value);
    setLastTrace(t);
    bump("human_reviews", `${spec.name}`);
    onRunComplete?.(t);
  };

  const node = specNode(spec, selected);
  const status = lastTrace?.status;
  const finalOutput = r.trace?.finalState?.final_output;
  const totals = useMemo(() => {
    const calls = r.spans.flatMap((s) => s.llmCalls);
    const simLatency = r.spans.reduce((m, s) => Math.max(m, s.simStartMs + s.simDurationMs), 0);
    return { calls: calls.length, tokens: calls.reduce((a, c) => a + c.inputTokens + c.outputTokens + c.reasoningTokens, 0), cost: calls.reduce((a, c) => a + c.costUsd, 0), simLatency };
  }, [r.spans]);

  const tabs = panels.map((p) => ({
    id: p,
    label: { inspect: "Node inspector", state: "State", trace: "Trace / debug", python: "LangGraph code", output: "Final output" }[p],
  }));

  return (
    <div className="flex flex-col gap-3">
      {header}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* left: input + diagram */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <div className="mb-1 text-xs font-medium text-ink-2">Input transcript</div>
                <TranscriptPicker value={tid} onChange={setTid} customText={custom} onCustomText={setCustom} allowCustom={allowCustom} ids={transcriptIds} />
              </div>
              <div className="flex gap-1.5">
                <Button variant="primary" onClick={go} disabled={r.running && !r.waiting} icon={<Play className="h-4 w-4" />}>
                  {r.running ? "Running…" : "Run"}
                </Button>
                {r.stepMode && r.waiting && (
                  <Button onClick={r.nextStep} icon={<StepForward className="h-4 w-4" />}>
                    Next step
                  </Button>
                )}
                <Button variant="ghost" onClick={() => { r.reset(); setLastTrace(null); setSelected(null); }} icon={<RotateCcw className="h-4 w-4" />} aria-label="Reset" />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Toggle checked={r.stepMode} onChange={r.setStepMode} label={<span className="text-xs">Step-by-step (pause before each super-step)</span>} />
              {spec.checkpointer && <Badge tone="accent">checkpointer on · thread persisted</Badge>}
            </div>
            {showTranscript && tid !== "custom" && (
              <details className="text-xs">
                <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Show transcript</summary>
                <TranscriptView id={tid} className="mt-2" />
              </details>
            )}
          </div>
          {r.waiting && (
            <div className="flex items-center gap-2 rounded-lg border border-accent/50 bg-accent-soft px-3 py-2 text-sm text-ink">
              <Pause className="h-4 w-4 text-accent" />
              Paused before super-step {r.waiting.step}: <span className="font-mono text-xs">{r.waiting.nodes.join(", ")}</span> will run next.
            </div>
          )}
          <FlowDiagram
            spec={spec}
            status={r.status}
            activeEdges={r.activeEdges}
            visitedEdges={r.visitedEdges}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              if (panels.includes("inspect")) setPanel("inspect");
            }}
            maxHeight={diagramHeight}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusLegend />
            <span className="text-[11px] text-ink-3">Click a node to inspect it.</span>
          </div>
        </div>

        {/* right: panels */}
        <div className="flex min-w-0 flex-col gap-3">
          {r.interrupt && !r.running && <HumanReviewPanel info={r.interrupt} onResume={doResume} busy={r.running} />}
          {lastTrace?.status === "error" && lastTrace.error && <ErrorBox error={lastTrace.error} />}
          {(status || r.spans.length > 0) && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat label="Status" value={r.running ? "running" : status ?? "—"} tone={status === "success" ? "good" : status === "error" ? "bad" : status === "interrupted" ? "warn" : undefined} />
              <MiniStat label="Latency (sim)" value={fmtMs(totals.simLatency)} />
              <MiniStat label="LLM calls · tokens" value={`${totals.calls} · ${totals.tokens}`} />
              <MiniStat label="Cost" value={fmtUsd(totals.cost, { precise: true })} />
            </div>
          )}
          <div className="rounded-xl border border-line bg-surface">
            <Tabs tabs={tabs} value={panel} onChange={setPanel} className="px-2" />
            <div className="p-3">
              {panel === "inspect" &&
                (node ? (
                  <NodeInspector key={node.id + r.runCount} node={node} spans={r.spans} />
                ) : (
                  <div className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-3">
                    Click any node in the diagram to see its <strong className="text-ink-2">input → prompt → LLM output → parsed output → updated state</strong>.
                  </div>
                ))}
              {panel === "state" && <StateTimeline timeline={r.timeline} />}
              {panel === "trace" && <TraceTable spans={r.spans} routes={r.routes} onSelect={(s) => { setSelected(s.node.replace(/\[\d+\]$/, "")); setPanel("inspect"); }} />}
              {panel === "python" && <CodeBlock tabs={[{ label: "graph.py", code: generatePython(spec), language: "python" }]} verified maxHeight={520} />}
              {panel === "output" && (finalOutput ? <JsonBlock value={finalOutput} /> : <div className="text-sm text-ink-3">No final output yet.</div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MiniStat({ label, value, tone }: { label: string; value: ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className={cn("truncate font-mono text-sm font-semibold text-ink", tone === "good" && "text-good-ink", tone === "bad" && "text-bad-ink", tone === "warn" && "text-warn-ink")}>{value}</div>
    </div>
  );
}
