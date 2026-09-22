"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MemoryCheckpointer } from "@/lib/engine/checkpointer";
import type { EngineEvent, GraphState, InterruptInfo, NodeSpan, RouteDecision, RunTrace } from "@/lib/engine/types";
import { END, START } from "@/lib/engine/types";
import { useSettings } from "@/lib/store/settings";
import { clamp, sleep, uid } from "@/lib/utils";
import type { WorkflowSpec } from "@/lib/workflows/spec";
import { runWorkflow } from "@/lib/workflows/run";
import type { NodeStatus } from "./FlowDiagram";

export interface TimelineEntry {
  id: string;
  label: string;
  step: number;
  nodes: string[];
  state: GraphState;
  before: GraphState | null;
  changedKeys: string[];
  kind: "input" | "step" | "resume" | "interrupt" | "error";
}

const baseName = (n: string) => n.replace(/\[\d+\]$/, "");

export function traversedEdges(spec: WorkflowSpec, executed: string[], next: string[], routes: RouteDecision[]): string[] {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const startId = spec.nodes.find((n) => n.kind === "start")?.id;
  const nextSet = new Set(next.map(baseName));
  const out: string[] = [];
  const walkRouter = (routerId: string, results: string[], depth = 0): boolean => {
    if (depth > 6) return false;
    let hit = false;
    for (const e of spec.edges.filter((x) => x.source === routerId)) {
      const t = byId.get(e.target);
      if (!t) continue;
      if (t.kind === "router") {
        if (walkRouter(t.id, results, depth + 1)) {
          out.push(e.id);
          hit = true;
        }
      } else if ((t.kind === "end" && results.includes(END)) || results.includes(t.id)) {
        out.push(e.id);
        hit = true;
      }
    }
    return hit;
  };
  for (const src of executed.map(baseName)) {
    const engineName = src === startId ? START : src;
    for (const e of spec.edges.filter((x) => x.source === src)) {
      const t = byId.get(e.target);
      if (!t) continue;
      if (t.kind === "router") {
        const dec = routes.find((r) => r.source === engineName && r.routerId === t.id);
        if (dec) {
          out.push(e.id);
          walkRouter(t.id, dec.result);
        }
      } else if (t.kind === "end" || nextSet.has(t.id)) out.push(e.id);
    }
  }
  return out;
}

export function useWorkflowRunner(spec: WorkflowSpec, options: { animate?: boolean } = {}) {
  const animate = options.animate ?? true;
  const speed = useSettings((s) => s.animationSpeed);
  const [status, setStatus] = useState<Record<string, NodeStatus>>({});
  const [activeEdges, setActiveEdges] = useState<Set<string>>(new Set());
  const [visitedEdges, setVisitedEdges] = useState<Set<string>>(new Set());
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [spans, setSpans] = useState<NodeSpan[]>([]);
  const [routes, setRoutes] = useState<RouteDecision[]>([]);
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [running, setRunning] = useState(false);
  const [interrupt, setInterrupt] = useState<InterruptInfo | null>(null);
  const [stepMode, setStepMode] = useState(false);
  const [waiting, setWaiting] = useState<{ step: number; nodes: string[] } | null>(null);
  const [runCount, setRunCount] = useState(0);

  const cpr = useRef(new MemoryCheckpointer());
  const threadId = useRef(uid("thread"));
  const gateResolve = useRef<(() => void) | null>(null);
  const abort = useRef({ aborted: false });
  const stepModeRef = useRef(stepMode);
  const speedRef = useRef(speed);
  const specRef = useRef(spec);
  useEffect(() => {
    stepModeRef.current = stepMode;
  }, [stepMode]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    specRef.current = spec;
  }, [spec]);

  const clearVisuals = useCallback(() => {
    setStatus({});
    setActiveEdges(new Set());
    setVisitedEdges(new Set());
    setTimeline([]);
    setSpans([]);
    setRoutes([]);
    setTrace(null);
    setInterrupt(null);
    setWaiting(null);
  }, []);

  const reset = useCallback(() => {
    abort.current.aborted = true;
    gateResolve.current?.();
    cpr.current = new MemoryCheckpointer();
    threadId.current = uid("thread");
    clearVisuals();
    setRunning(false);
  }, [clearVisuals]);

  const execute = useCallback(
    async (input: GraphState | null, mode: { resume?: { value: unknown }; fromCheckpointId?: string; label?: string } = {}) => {
      const sp = specRef.current;
      abort.current = { aborted: false };
      setRunning(true);
      setInterrupt(null);
      let prevState: GraphState | null = null;
      let stepRoutes: RouteDecision[] = [];
      let firstStep = true;
      const startId = sp.nodes.find((n) => n.kind === "start")?.id;
      const onEvent = (e: EngineEvent) => {
        switch (e.type) {
          case "step_start": {
            if (firstStep) {
              firstStep = false;
              if (!mode.resume && !mode.fromCheckpointId) {
                setTimeline((t) => [...t, { id: uid("tl"), label: "Input (after START)", step: -1, nodes: [], state: e.state, before: null, changedKeys: Object.keys(e.state).filter((k) => e.state[k] !== null), kind: "input" }]);
                if (startId) {
                  const tr = traversedEdges(sp, [startId], e.nodes, stepRoutes);
                  setActiveEdges(new Set(tr));
                  setVisitedEdges((v) => new Set([...v, ...tr]));
                  setStatus((s) => ({ ...s, [startId]: "done" }));
                }
              } else if (mode.resume) {
                setTimeline((t) => [...t, { id: uid("tl"), label: `Resumed with Command(resume=…)`, step: e.step, nodes: e.nodes, state: e.state, before: null, changedKeys: [], kind: "resume" }]);
              }
              stepRoutes = [];
            }
            prevState = e.state;
            setStatus((s) => {
              const next = { ...s };
              e.nodes.forEach((n) => (next[baseName(n)] = "running"));
              return next;
            });
            break;
          }
          case "node_end": {
            const st: NodeStatus = e.span.status === "error" ? "error" : e.span.status === "interrupted" ? "interrupted" : "done";
            setStatus((s) => ({ ...s, [baseName(e.node)]: st }));
            break;
          }
          case "route":
            stepRoutes.push(e.decision);
            setRoutes((r) => [...r, e.decision]);
            break;
          case "step_end": {
            const executedNodes = [...new Set(stepNodesFromState(e))];
            const tr = traversedEdges(sp, executedNodes, e.next, stepRoutes);
            stepRoutes = [];
            setActiveEdges(new Set(tr));
            setVisitedEdges((v) => new Set([...v, ...tr]));
            setTimeline((t) => [
              ...t,
              { id: uid("tl"), label: `Step ${e.step}: ${executedNodes.join(", ")}`, step: e.step, nodes: executedNodes, state: e.state, before: prevState, changedKeys: e.changedKeys, kind: "step" },
            ]);
            setStatus((s) => {
              const next = { ...s };
              e.next.forEach((n) => {
                if (next[baseName(n)] !== "running") next[baseName(n)] = "queued";
              });
              if (!e.next.length) sp.nodes.filter((n) => n.kind === "end").forEach((n) => (next[n.id] = "done"));
              return next;
            });
            break;
          }
          case "interrupt":
            setInterrupt(e.info);
            break;
          case "run_end": {
            const t = e.trace;
            setTrace(t);
            setSpans((s) => [...s, ...t.spans]);
            if (t.status === "success") {
              setStatus((s) => {
                const next = { ...s };
                sp.nodes.filter((n) => n.kind === "end").forEach((n) => (next[n.id] = "done"));
                return next;
              });
            }
            if (t.status === "error" && t.error) {
              setTimeline((tl) => [
                ...tl,
                { id: uid("tl"), label: `Error: ${t.error!.type}`, step: t.error!.step ?? -1, nodes: t.error!.node ? [t.error!.node] : [], state: t.finalState, before: null, changedKeys: [], kind: "error" },
              ]);
            }
            if (t.status === "interrupted" && t.interrupt) {
              setTimeline((tl) => [
                ...tl,
                { id: uid("tl"), label: `Paused at ${t.interrupt!.node} (interrupt)`, step: -1, nodes: [t.interrupt!.node], state: t.finalState, before: null, changedKeys: [], kind: "interrupt" },
              ]);
            }
            setActiveEdges(new Set());
            break;
          }
        }
      };
      // executed nodes for a step = the ones marked running in this step; we track via a closure
      let currentStepNodes: string[] = [];
      const stepNodesFromState = (e: Extract<EngineEvent, { type: "step_end" }>) => {
        void e;
        return currentStepNodes;
      };
      const wrapped = (e: EngineEvent) => {
        if (e.type === "step_start") currentStepNodes = e.nodes.map(baseName);
        onEvent(e);
      };
      const result = await runWorkflow(sp, input, {
        onEvent: wrapped,
        checkpointer: sp.checkpointer ? cpr.current : null,
        threadId: threadId.current,
        resume: mode.resume,
        fromCheckpointId: mode.fromCheckpointId,
        recursionLimit: sp.recursionLimit ?? 25,
        signal: abort.current,
        pace: animate ? (ms) => sleep(clamp(ms * 0.45, 140, 1100) / Math.max(0.1, speedRef.current)) : undefined,
        gate: (step, nodes) => {
          if (!stepModeRef.current) return Promise.resolve();
          setWaiting({ step, nodes });
          return new Promise<void>((res) => {
            gateResolve.current = () => {
              gateResolve.current = null;
              setWaiting(null);
              res();
            };
          });
        },
      });
      setRunning(false);
      setRunCount((c) => c + 1);
      return result;
    },
    [animate],
  );

  const run = useCallback(
    async (input: GraphState) => {
      abort.current.aborted = true;
      gateResolve.current?.();
      cpr.current = new MemoryCheckpointer();
      threadId.current = uid("thread");
      clearVisuals();
      await sleep(0);
      return execute(input);
    },
    [clearVisuals, execute],
  );

  const resume = useCallback((value: unknown) => execute(null, { resume: { value } }), [execute]);

  const replayFrom = useCallback(
    (checkpointId: string, update?: GraphState) => {
      setStatus({});
      setActiveEdges(new Set());
      setVisitedEdges(new Set());
      return execute(update ?? null, { fromCheckpointId: checkpointId });
    },
    [execute],
  );

  const nextStep = useCallback(() => gateResolve.current?.(), []);
  const cancel = useCallback(() => {
    abort.current.aborted = true;
    gateResolve.current?.();
  }, []);

  return {
    status,
    activeEdges,
    visitedEdges,
    timeline,
    spans,
    routes,
    trace,
    running,
    interrupt,
    stepMode,
    setStepMode,
    waiting,
    run,
    resume,
    replayFrom,
    nextStep,
    cancel,
    reset,
    runCount,
    getCheckpointer: useCallback(() => cpr.current, []),
    getThreadId: useCallback(() => threadId.current, []),
  };
}

export type WorkflowRunnerState = ReturnType<typeof useWorkflowRunner>;
