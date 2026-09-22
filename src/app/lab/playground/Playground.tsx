"use client";

import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { AlertTriangle, Download, Pause, Play, Plus, RotateCcw, Save, StepForward, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KindIcon } from "@/components/graph/FlowDiagram";
import { ErrorBox, HumanReviewPanel, NodeInspector, StateTimeline, TraceTable } from "@/components/graph/Inspectors";
import { useWorkflowRunner } from "@/components/graph/useWorkflowRunner";
import { TranscriptPicker } from "@/components/graph/WorkflowRunner";
import { CodeBlock } from "@/components/learn/CodeBlock";
import { ConfigPanel } from "@/components/playground/ConfigPanel";
import { nodeTypes, type WfRFNode } from "@/components/playground/nodes";
import { ChallengeTask, ExerciseTask } from "@/components/playground/TaskPanel";
import { Badge, Button, Input, Modal, Select, Tabs, Toggle } from "@/components/ui";
import { getChallenge } from "@/content/debugChallenges";
import { getExercise } from "@/content/exercises";
import { transcriptToText } from "@/lib/domain";
import type { Reducer, RunTrace } from "@/lib/engine/types";
import { findTranscript, lookupKnownTranscript } from "@/lib/sim/transcripts";
import { useHydrated } from "@/lib/store/hydration";
import { useProgress } from "@/lib/store/progress";
import { useWorkflows } from "@/lib/store/workflows";
import { cn, deepClone, download, fmtMs, fmtUsd, snakeCase } from "@/lib/utils";
import { generatePython } from "@/lib/workflows/codegen";
import { deriveSchema } from "@/lib/workflows/compile";
import { lintWorkflow } from "@/lib/workflows/lint";
import type { TaskId as TaskIdLike } from "@/lib/ai/types";
import type { FunctionId, ToolId, WfNode, WfNodeKind, WorkflowSpec } from "@/lib/workflows/spec";
import { edge, endNode, fnNode, getTemplate, humanNode, llmNode, routerNode, TEMPLATES, toolNode } from "@/lib/workflows/templates";

type PaletteItem = { kind: WfNodeKind; label: string; make: (id: string, x: number, y: number) => WfNode };

const PALETTE: { group: string; items: PaletteItem[] }[] = [
  {
    group: "LLM",
    items: (
      [
        ["classify_intent", "Classify intent"],
        ["extract_product", "Extract product"],
        ["sentiment", "Sentiment"],
        ["extract_details", "Extract details"],
        ["full_analysis", "Full analysis"],
        ["summarize", "Summarize"],
        ["custom", "Custom prompt"],
      ] as [TaskIdLike, string][]
    ).map(([task, label]) => ({
      kind: "llm" as const,
      label,
      make: (id, x, y) => {
        const n = llmNode(id, label, task, x, y);
        if (task === "custom") (n.config as { customPrompt?: string }).customPrompt = 'Return JSON {"intent": ..., "product": ...} for this call.\n\n{{transcript}}';
        return n;
      },
    })),
  },
  {
    group: "Function",
    items: (
      [
        ["clean_transcript", "Clean transcript"],
        ["redact_pii", "Redact PII"],
        ["compute_confidence", "Confidence check"],
        ["validate_output", "Validate output"],
        ["increment_attempts", "Count attempt"],
        ["finalize", "Final output"],
        ["custom", "Custom JS"],
      ] as [FunctionId, string][]
    ).map(([fn, label]) => ({ kind: "function" as const, label, make: (id, x, y) => fnNode(id, label, fn, x, y, fn === "custom" ? "return { note: 'turns: ' + state.transcript.split('\\n').length };" : undefined) })),
  },
  {
    group: "Router",
    items: [
      { kind: "router", label: "Confidence threshold", make: (id, x, y) => routerNode(id, "Low confidence?", { mode: "threshold", field: "confidence", op: "<", value: 0.7, branches: ["low", "high"] }, x, y) },
      { kind: "router", label: "By intent", make: (id, x, y) => routerNode(id, "Route by intent", { mode: "category", field: "intent", branches: ["interested", "not_interested", "unclear"] }, x, y) },
      { kind: "router", label: "Expression", make: (id, x, y) => routerNode(id, "Valid?", { mode: "expression", field: "", expression: "state.is_valid ? 'valid' : (state.attempts >= 2 ? 'give_up' : 'retry')", branches: ["valid", "retry", "give_up"] }, x, y) },
    ],
  },
  {
    group: "Human & tools",
    items: [
      { kind: "human", label: "Human review", make: (id, x, y) => humanNode(id, "Human review", x, y) },
      ...(
        [
          ["crm_lookup", "CRM lookup"],
          ["rate_lookup", "Rate lookup"],
          ["send_followup", "Send follow-up"],
        ] as [ToolId, string][]
      ).map(([tool, label]) => ({ kind: "tool" as const, label, make: (id: string, x: number, y: number) => toolNode(id, label, tool, x, y) })),
      { kind: "end", label: "END", make: (id, x, y) => endNode(x, y, id) },
    ],
  },
];

/** small random offset so stacked new nodes don't overlap exactly */
function jitter(range: number) {
  return (Math.random() - 0.5) * range;
}

function uniqueId(spec: WorkflowSpec, base: string) {
  const id = snakeCase(base) || "node";
  if (!spec.nodes.some((n) => n.id === id)) return id;
  let i = 2;
  while (spec.nodes.some((n) => n.id === `${id}_${i}`)) i++;
  return `${id}_${i}`;
}

type Tab = "task" | "node" | "state" | "trace" | "code" | "issues";

function PlaygroundInner({ template, exerciseId, challengeId }: { template?: string; exerciseId?: string; challengeId?: string }) {
  const router = useRouter();
  const rf = useReactFlow();
  const ex = exerciseId ? getExercise(exerciseId) : undefined;
  const ch = challengeId ? getChallenge(challengeId) : undefined;
  const ctxKey = ex ? `ex:${ex.id}` : ch ? `dbg:${ch.id}` : "free";
  const starter = useCallback((): WorkflowSpec => {
    if (ex) return { ...getTemplate(ex.starterTemplate ?? "blank"), id: `ex-${ex.id}`, name: `Exercise: ${ex.title}` };
    if (ch) return deepClone(ch.spec);
    return getTemplate(template ?? "hitl");
  }, [ex, ch, template]);

  const hydrated = useHydrated((s) => s.hydrated);
  const setDraft = useWorkflows((s) => s.setDraft);
  const saved = useWorkflows((s) => s.saved);
  const saveWf = useWorkflows((s) => s.save);
  const bump = useProgress((s) => s.bump);
  // spec = your edits in this session ?? your saved draft for this context ?? the starter
  const starterSpec = useMemo(() => starter(), [starter]);
  const draft = useWorkflows((s) => s.drafts[ctxKey]);
  const [localSpec, setLocalSpec] = useState<WorkflowSpec | null>(null);
  const spec: WorkflowSpec = localSpec ?? (hydrated && !(template && !ex && !ch) ? draft : undefined) ?? starterSpec;
  const setSpec = useCallback(
    (u: WorkflowSpec | ((s: WorkflowSpec) => WorkflowSpec)) =>
      setLocalSpec((prev) => {
        const base = prev ?? (useHydrated.getState().hydrated ? useWorkflows.getState().drafts[ctxKey] : undefined) ?? starterSpec;
        return typeof u === "function" ? u(base) : u;
      }),
    [ctxKey, starterSpec],
  );
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(ex || ch ? "task" : "node");
  const [tid, setTid] = useState(ch?.testTranscript ?? "t01");
  const [custom, setCustom] = useState("Agent: Hello, FinServe Bank.\nCustomer: I'd like a credit card with airport lounge access. What's the annual fee?");
  const [lastTrace, setLastTrace] = useState<RunTrace | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});

  // ?template=… : store it as the free-play draft, then drop the query param
  useEffect(() => {
    if (!hydrated || !template || ex || ch) return;
    setDraft("free", getTemplate(template));
    router.replace("/lab/playground");
  }, [hydrated, template, ex, ch, setDraft, router]);

  // autosave your edits (debounced) as the draft for this context
  useEffect(() => {
    if (!localSpec) return;
    const t = setTimeout(() => setDraft(ctxKey, localSpec), 400);
    return () => clearTimeout(t);
  }, [localSpec, ctxKey, setDraft]);

  const r = useWorkflowRunner(spec);
  const issues = useMemo(() => lintWorkflow(spec), [spec]);
  const errorNodes = useMemo(() => new Set(issues.filter((i) => i.level === "error" && i.nodeId).map((i) => i.nodeId!)), [issues]);
  const schema = useMemo(() => deriveSchema(spec), [spec]);

  // React Flow nodes are derived from the spec; only measured sizes live separately
  const rfNodes: WfRFNode[] = useMemo(
    () =>
      spec.nodes.map((n) => ({
        id: n.id,
        type: "wf" as const,
        position: { x: n.x, y: n.y },
        data: { node: n, status: r.status[n.id] ?? "idle", issue: errorNodes.has(n.id) },
        selected: selNode === n.id,
        deletable: n.kind !== "start",
        measured: measured[n.id],
      })),
    [spec, r.status, errorNodes, selNode, measured],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      spec.edges.map((e) => {
        const src = spec.nodes.find((n) => n.id === e.source);
        const visited = r.visitedEdges.has(e.id);
        const active = r.activeEdges.has(e.id);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: src?.kind === "router" ? e.branch ?? null : null,
          label: e.branch,
          animated: active,
          selected: selEdge === e.id,
          style: { stroke: visited || active ? "var(--accent)" : "var(--axis)", strokeWidth: visited || active ? 2.2 : 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: visited || active ? "var(--accent)" : "var(--axis)", width: 16, height: 16 },
        };
      }),
    [spec, r.visitedEdges, r.activeEdges, selEdge],
  );

  const removeNode = useCallback((id: string) => {
    setSpec((s) => ({ ...s, nodes: s.nodes.filter((n) => n.id !== id || n.kind === "start"), edges: s.edges.filter((e) => e.source !== id && e.target !== id) }));
    setSelNode(null);
  }, [setSpec]);
  const removeEdge = useCallback((id: string) => {
    setSpec((s) => ({ ...s, edges: s.edges.filter((e) => e.id !== id) }));
    setSelEdge(null);
  }, [setSpec]);

  const onNodesChange = useCallback(
    (changes: NodeChange<WfRFNode>[]) => {
      const dims = changes.filter((c) => c.type === "dimensions" && c.dimensions) as Extract<NodeChange<WfRFNode>, { type: "dimensions" }>[];
      if (dims.length) setMeasured((m) => ({ ...m, ...Object.fromEntries(dims.map((d) => [d.id, d.dimensions!])) }));
      const moves = changes.filter((c) => c.type === "position" && c.position) as Extract<NodeChange<WfRFNode>, { type: "position" }>[];
      if (moves.length)
        setSpec((s) => ({ ...s, nodes: s.nodes.map((n) => {
          const m = moves.find((c) => c.id === n.id);
          return m?.position ? { ...n, x: Math.round(m.position.x), y: Math.round(m.position.y) } : n;
        }) }));
      for (const c of changes) {
        if (c.type === "remove") removeNode(c.id);
        if (c.type === "select" && c.selected) {
          setSelNode(c.id);
          setSelEdge(null);
          setTab((t) => (t === "task" || t === "trace" ? t : "node"));
        }
      }
    },
    [removeNode, setSpec],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === "remove") removeEdge(c.id);
        if (c.type === "select" && c.selected) {
          setSelEdge(c.id);
          setSelNode(null);
          setTab("node");
        }
      }
    },
    [removeEdge],
  );

  const onConnect = useCallback((conn: Connection) => {
    setSpec((s) => {
      const src = s.nodes.find((n) => n.id === conn.source);
      const tgt = s.nodes.find((n) => n.id === conn.target);
      if (!src || !tgt || tgt.kind === "start" || src.kind === "end" || src.id === tgt.id) return s;
      let branch: string | undefined;
      if (src.kind === "router") {
        const cfg = src.config as { branches: string[]; defaultBranch?: string };
        const all = [...cfg.branches, ...(cfg.defaultBranch ? [cfg.defaultBranch] : [])];
        branch = conn.sourceHandle ?? all.find((b) => !s.edges.some((e) => e.source === src.id && e.branch === b)) ?? all[0];
      }
      const e = edge(src.id, tgt.id, branch);
      if (s.edges.some((x) => x.id === e.id)) return s;
      const edges = src.kind === "router" ? s.edges.filter((x) => !(x.source === src.id && x.branch === branch)) : s.edges;
      return { ...s, edges: [...edges, e] };
    });
  }, [setSpec]);

  const addNode = (item: PaletteItem) => {
    const el = document.getElementById("pg-canvas");
    const rect = el?.getBoundingClientRect();
    const pos = rect ? rf.screenToFlowPosition({ x: rect.left + rect.width / 2 - 84 + jitter(60), y: rect.top + rect.height / 3 + jitter(60) }) : { x: 200, y: 200 };
    const id = uniqueId(spec, item.kind === "end" ? "end" : item.label);
    const n = item.make(id, Math.round(pos.x), Math.round(pos.y));
    setSpec((s) => ({ ...s, nodes: [...s.nodes, n] }));
    setSelNode(id);
    setTab("node");
  };

  const input = useMemo(() => {
    if (tid === "custom") return { transcript: custom, transcript_id: lookupKnownTranscript(custom)?.id ?? null };
    const t = findTranscript(tid)!;
    return { transcript: transcriptToText(t), transcript_id: t.id };
  }, [tid, custom]);

  const run = async () => {
    const t = await r.run(input);
    setLastTrace(t);
    bump("playground_runs", `${spec.name} on ${tid}`);
    if (t.status === "error" && t.error?.node) {
      setSelNode(t.error.node);
      setTab("node");
    }
  };
  const resume = async (v: unknown) => {
    const t = await r.resume(v);
    setLastTrace(t);
    bump("human_reviews", spec.name);
  };

  const loadTemplate = (id: string) => {
    const t = getTemplate(id);
    setSpec(t);
    r.reset();
    setLastTrace(null);
    setSelNode(null);
    setTimeout(() => rf.fitView({ padding: 0.2 }), 50);
  };

  const importJson = (file: File) => {
    file.text().then((txt) => {
      try {
        const s = JSON.parse(txt) as WorkflowSpec;
        if (!Array.isArray(s.nodes) || !Array.isArray(s.edges)) throw new Error("not a workflow");
        setSpec(s);
        r.reset();
        setTimeout(() => rf.fitView({ padding: 0.2 }), 50);
      } catch (e) {
        alert(`Could not import: ${(e as Error).message}`);
      }
    });
  };

  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  const totals = useMemo(() => {
    const calls = r.spans.flatMap((s) => s.llmCalls);
    return { calls: calls.length, cost: calls.reduce((a, c) => a + c.costUsd, 0), latency: r.spans.reduce((m, s) => Math.max(m, s.simStartMs + s.simDurationMs), 0) };
  }, [r.spans]);

  const tabs: { id: Tab; label: React.ReactNode }[] = [
    ...(ex || ch ? [{ id: "task" as Tab, label: ex ? "Exercise" : "Challenge" }] : []),
    { id: "node", label: "Configure" },
    { id: "state", label: "State" },
    { id: "trace", label: "Trace" },
    { id: "code", label: "Python" },
    { id: "issues", label: <span className="flex items-center gap-1">Issues {errors + warnings > 0 && <Badge tone={errors ? "bad" : "warn"}>{errors + warnings}</Badge>}</span> },
  ];

  const selectedSpecNode = selNode ? spec.nodes.find((n) => n.id === selNode) : undefined;

  return (
    <div className="flex h-auto flex-col lg:h-[calc(100vh-3.5rem)]">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Input value={spec.name} onChange={(e) => setSpec({ ...spec, name: e.target.value })} className="h-8 w-56 text-sm font-semibold" aria-label="Workflow name" />
        {!ex && !ch && (
          <Select
            className="h-8 w-52 text-xs"
            value=""
            onChange={(v) => v && loadTemplate(v)}
            options={[{ value: "", label: "Load template…" }, ...Object.values(TEMPLATES).filter((t) => !t.id.startsWith("ex_")).map((t) => ({ value: t.id, label: t.name }))]}
          />
        )}
        {ex && <Badge tone="accent">Exercise mode</Badge>}
        {ch && <Badge tone="bad">Debug challenge</Badge>}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={<Save className="h-3.5 w-3.5" />} onClick={() => { setSaveName(spec.name); setSaveOpen(true); }}>
            Save
          </Button>
          {saved.length > 0 && (
            <Select
              className="h-8 w-40 text-xs"
              value=""
              onChange={(id) => {
                const w = saved.find((s) => s.id === id);
                if (w) {
                  setSpec(deepClone(w.spec));
                  r.reset();
                  setTimeout(() => rf.fitView({ padding: 0.2 }), 50);
                }
              }}
              options={[{ value: "", label: "Open saved…" }, ...saved.map((s) => ({ value: s.id, label: s.name }))]}
            />
          )}
          <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={() => download(`${snakeCase(spec.name) || "workflow"}.py`, generatePython(spec), "text/x-python")}>
            .py
          </Button>
          <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={() => download(`${snakeCase(spec.name) || "workflow"}.json`, JSON.stringify(spec, null, 2))}>
            JSON
          </Button>
          <Button size="sm" variant="ghost" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>
            Import
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </div>
        <div className="flex-1" />
        <Toggle checked={!!spec.checkpointer} onChange={(v) => setSpec({ ...spec, checkpointer: v })} label={<span className="text-xs">Persistence (checkpointer)</span>} />
        <label className="flex items-center gap-1.5 text-xs text-ink-2">
          recursion_limit
          <Input type="number" min={2} max={200} value={spec.recursionLimit ?? 25} onChange={(e) => setSpec({ ...spec, recursionLimit: Math.max(2, Math.min(200, Number(e.target.value) || 25)) })} className="h-8 w-16 text-xs" />
        </label>
        <button onClick={() => setTab("issues")} className="flex items-center gap-1 text-xs">
          {errors ? <Badge tone="bad">{errors} error{errors > 1 ? "s" : ""}</Badge> : warnings ? <Badge tone="warn">{warnings} warning{warnings > 1 ? "s" : ""}</Badge> : <Badge tone="good">graph valid</Badge>}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[190px_minmax(0,1fr)_440px]">
        {/* palette */}
        <div className="flex gap-3 overflow-x-auto border-b border-line bg-surface p-2 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r">
          {PALETTE.map((g) => (
            <div key={g.group} className="shrink-0">
              <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">{g.group}</div>
              <div className="flex gap-1 lg:flex-col">
                {g.items.map((it) => (
                  <button
                    key={it.label}
                    onClick={() => addNode(it)}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-left text-xs text-ink-2 hover:border-line-strong hover:text-ink"
                    title={`Add ${it.label}`}
                  >
                    <Plus className="h-3 w-3 text-ink-3" />
                    <KindIcon kind={it.kind} className="text-ink-3" />
                    <span className="truncate">{it.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* canvas */}
        <div id="pg-canvas" className="relative h-[60vh] min-h-[420px] lg:h-auto">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={() => {
              setSelNode(null);
              setSelEdge(null);
            }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            deleteKeyCode={["Backspace", "Delete"]}
            minZoom={0.3}
          >
            <Background gap={20} size={1} color="var(--grid)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!hidden md:!block" nodeColor={() => "var(--surface-3)"} maskColor="color-mix(in srgb, var(--bg) 60%, transparent)" />
          </ReactFlow>
          {r.waiting && (
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-accent/50 bg-surface px-3 py-2 text-xs shadow">
              <Pause className="h-3.5 w-3.5 text-accent" /> next super-step {r.waiting.step}: <span className="font-mono">{r.waiting.nodes.join(", ")}</span>
            </div>
          )}
        </div>

        {/* right panel */}
        <div className="flex min-h-0 flex-col border-t border-line bg-surface lg:border-l lg:border-t-0">
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <TranscriptPicker value={tid} onChange={setTid} customText={custom} onCustomText={setCustom} />
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="primary" size="sm" onClick={run} disabled={r.running && !r.waiting} icon={<Play className="h-3.5 w-3.5" />}>
                {r.running ? "Running…" : "Run"}
              </Button>
              {r.stepMode && r.waiting && (
                <Button size="sm" onClick={r.nextStep} icon={<StepForward className="h-3.5 w-3.5" />}>
                  Next step
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { r.reset(); setLastTrace(null); }} icon={<RotateCcw className="h-3.5 w-3.5" />}>
                Reset
              </Button>
              <Toggle checked={r.stepMode} onChange={r.setStepMode} label={<span className="text-xs">step mode</span>} className="ml-auto" />
            </div>
            {(lastTrace || r.spans.length > 0) && (
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <Badge tone={lastTrace?.status === "success" ? "good" : lastTrace?.status === "error" ? "bad" : lastTrace?.status === "interrupted" ? "warn" : "neutral"}>{r.running ? "running" : lastTrace?.status ?? "—"}</Badge>
                <Badge>{fmtMs(totals.latency)}</Badge>
                <Badge>{totals.calls} LLM calls</Badge>
                <Badge>{fmtUsd(totals.cost, { precise: true })}</Badge>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {r.interrupt && !r.running && (
              <div className="p-3">
                <HumanReviewPanel info={r.interrupt} onResume={resume} />
              </div>
            )}
            {lastTrace?.status === "error" && lastTrace.error && (
              <div className="px-3 pt-3">
                <ErrorBox error={lastTrace.error} />
              </div>
            )}
            <Tabs tabs={tabs} value={tab} onChange={setTab} className="sticky top-0 z-10 bg-surface px-2" size="sm" />
            <div className="p-3">
              {tab === "task" && ex && <ExerciseTask ex={ex} spec={spec} onReset={() => { setSpec(starter()); r.reset(); setLastTrace(null); }} />}
              {tab === "task" && ch && <ChallengeTask c={ch} spec={spec} onReset={() => { setSpec(starter()); r.reset(); setLastTrace(null); }} />}
              {tab === "node" && (
                <div className="flex flex-col gap-4">
                  <ConfigPanel spec={spec} nodeId={selNode} edgeId={selEdge} onChange={setSpec} onDeleteNode={removeNode} onDeleteEdge={removeEdge} />
                  {selectedSpecNode && r.spans.some((s) => s.node.replace(/\[\d+\]$/, "") === selectedSpecNode.id) && (
                    <div className="border-t border-line pt-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Last run of this node</div>
                      <NodeInspector key={selectedSpecNode.id + r.runCount} node={selectedSpecNode} spans={r.spans} />
                    </div>
                  )}
                </div>
              )}
              {tab === "state" && (
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">State schema (derived from your nodes)</div>
                    <div className="flex flex-col gap-1">
                      {Object.entries(schema).map(([k, ch2]) => (
                        <div key={k} className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono text-ink">{k}</span>
                          <Select
                            className="h-7 w-44 text-xs"
                            value={ch2.reducer}
                            onChange={(v) => setSpec({ ...spec, reducers: { ...(spec.reducers ?? {}), [k]: v as Reducer } })}
                            options={[
                              { value: "overwrite", label: "overwrite (default)" },
                              { value: "append", label: "append (operator.add)" },
                              { value: "add", label: "add (sum)" },
                              { value: "merge", label: "merge dict" },
                            ]}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">State over time (last run)</div>
                    <StateTimeline timeline={r.timeline} compact />
                  </div>
                </div>
              )}
              {tab === "trace" && (
                <TraceTable
                  spans={r.spans}
                  routes={r.routes}
                  onSelect={(s) => {
                    setSelNode(s.node.replace(/\[\d+\]$/, ""));
                    setTab("node");
                  }}
                />
              )}
              {tab === "code" && <CodeBlock tabs={[{ label: `${snakeCase(spec.name) || "graph"}.py`, code: generatePython(spec) }]} verified maxHeight={640} />}
              {tab === "issues" && (
                <div className="flex flex-col gap-1.5">
                  {!issues.length && <div className="text-sm text-good-ink">No issues found.</div>}
                  {issues.map((i, k) => (
                    <button
                      key={k}
                      onClick={() => i.nodeId && (setSelNode(i.nodeId), setTab("node"))}
                      className={cn("flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs", i.level === "error" ? "border-bad/40 bg-bad-soft" : i.level === "warning" ? "border-warn/40 bg-warn-soft" : "border-line")}
                    >
                      <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", i.level === "error" ? "text-bad-ink" : i.level === "warning" ? "text-warn-ink" : "text-ink-3")} />
                      <span className="text-ink">{i.message}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save workflow"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                saveWf(saveName || spec.name, spec);
                setSpec({ ...spec, name: saveName || spec.name });
                setSaveOpen(false);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Workflow name" />
        <p className="mt-2 text-xs text-ink-3">Saved in this browser. Use JSON export to back it up or share it.</p>
      </Modal>
    </div>
  );
}

export function Playground(props: { template?: string; exerciseId?: string; challengeId?: string }) {
  return (
    <ReactFlowProvider>
      <PlaygroundInner {...props} />
    </ReactFlowProvider>
  );
}
