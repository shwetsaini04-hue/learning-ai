"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Check, Pause } from "lucide-react";
import { getTask } from "@/lib/ai/tasks";
import { cn } from "@/lib/utils";
import type { FunctionNodeConfig, LLMNodeConfig, RouterConfig, ToolNodeConfig, WfNode } from "@/lib/workflows/spec";
import { FUNCTION_INFO, TOOL_INFO } from "@/lib/workflows/spec";
import { describeRouter } from "@/lib/workflows/compile";
import { KIND_COLOR, KindIcon, type NodeStatus } from "@/components/graph/FlowDiagram";

export type WfNodeData = { node: WfNode; status: NodeStatus; issue?: boolean };
export type WfRFNode = Node<WfNodeData, "wf">;

export function subtitle(n: WfNode): string {
  switch (n.kind) {
    case "llm": {
      const c = n.config as LLMNodeConfig;
      return `${getTask(c.task)?.label ?? "custom prompt"} · ${c.promptVersion?.toUpperCase?.() ?? ""} · ${c.model.replace("sim:", "")}`;
    }
    case "function":
      return FUNCTION_INFO[(n.config as FunctionNodeConfig).fn].label;
    case "tool":
      return TOOL_INFO[(n.config as ToolNodeConfig).tool].label;
    case "router":
      return describeRouter(n.config as RouterConfig);
    case "human":
      return "interrupt() → Command(resume)";
    default:
      return "";
  }
}

export function routerBranches(n: WfNode): string[] {
  const c = n.config as RouterConfig;
  const b = [...(c.branches ?? [])];
  if (c.mode === "category" && c.defaultBranch && !b.includes(c.defaultBranch)) b.push(c.defaultBranch);
  return b;
}

function StatusBadge({ status }: { status: NodeStatus }) {
  if (status === "done")
    return (
      <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-good text-white shadow">
        <Check className="h-3 w-3" />
      </span>
    );
  if (status === "error")
    return (
      <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-bad text-white shadow">
        <AlertTriangle className="h-3 w-3" />
      </span>
    );
  if (status === "interrupted")
    return (
      <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-n-human text-white shadow">
        <Pause className="h-3 w-3" />
      </span>
    );
  return null;
}

export function WfNodeView({ data, selected }: NodeProps<WfRFNode>) {
  const { node, status, issue } = data;
  if (node.kind === "start" || node.kind === "end") {
    return (
      <div
        className={cn(
          "relative flex h-[34px] w-[168px] items-center justify-center rounded-full border bg-surface-2 font-mono text-[11px] font-bold tracking-widest text-ink-2",
          selected ? "border-accent ring-2 ring-accent/30" : "border-line-strong",
          status === "done" && "bg-surface-3",
        )}
      >
        {node.kind === "start" ? "START" : "END"}
        {node.kind === "start" ? <Handle type="source" position={Position.Bottom} /> : <Handle type="target" position={Position.Top} />}
      </div>
    );
  }
  if (node.kind === "router") {
    const branches = routerBranches(node);
    return (
      <div
        className={cn(
          "relative w-[168px] rounded-xl border-2 border-dashed bg-surface px-3 pb-5 pt-2 text-center shadow-sm",
          selected ? "border-accent" : "border-n-router",
          status === "done" && "bg-warn-soft",
          issue && "ring-2 ring-bad/50",
        )}
      >
        <Handle type="target" position={Position.Top} />
        <div className="flex items-center justify-center gap-1.5 text-[12px] font-semibold text-ink">
          <KindIcon kind="router" className="text-n-router" />
          <span className="truncate">{node.label}</span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[9.5px] text-ink-3" title={subtitle(node)}>
          {subtitle(node)}
        </div>
        {branches.map((b, i) => {
          const left = `${((i + 1) / (branches.length + 1)) * 100}%`;
          return (
            <div key={b}>
              <Handle type="source" id={b} position={Position.Bottom} style={{ left }} />
              <span className="pointer-events-none absolute -bottom-[19px] -translate-x-1/2 rounded bg-surface px-1 font-mono text-[9px] text-n-router" style={{ left }}>
                {b}
              </span>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "relative w-[168px] rounded-[10px] border bg-surface px-3 py-2 shadow-sm transition-shadow",
        selected ? "border-accent ring-2 ring-accent/30" : "border-line-strong",
        status === "running" && "node-running border-accent",
        status === "error" && "border-bad bg-bad-soft",
        status === "done" && "bg-surface-2",
        status === "interrupted" && "border-n-human",
        status === "queued" && "border-dashed border-accent",
        issue && status === "idle" && "ring-2 ring-bad/40",
      )}
    >
      <Handle type="target" position={Position.Top} />
      <span className="absolute left-0 top-2 h-[calc(100%-16px)] w-1 rounded-r" style={{ background: KIND_COLOR[node.kind] }} />
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
        <KindIcon kind={node.kind} className="shrink-0 text-ink-3" />
        <span className="truncate">{node.label}</span>
      </div>
      <div className="mt-0.5 truncate text-[10px] text-ink-3" title={subtitle(node)}>
        {subtitle(node)}
      </div>
      {node.defer && <span className="absolute -left-2 -top-2 rounded bg-surface-3 px-1 font-mono text-[9px] text-ink-2">defer</span>}
      <StatusBadge status={status} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const nodeTypes = { wf: WfNodeView };
