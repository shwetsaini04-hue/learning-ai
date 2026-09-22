import { deriveSchema, nodeWrites } from "./compile";
import type { RouterConfig, WorkflowSpec } from "./spec";

export interface LintIssue {
  level: "error" | "warning" | "info";
  nodeId?: string;
  message: string;
}

/** Static checks on a visual workflow — the things a reviewer would catch. */
export function lintWorkflow(spec: WorkflowSpec): LintIssue[] {
  const issues: LintIssue[] = [];
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const starts = spec.nodes.filter((n) => n.kind === "start");
  const ends = spec.nodes.filter((n) => n.kind === "end");
  if (starts.length !== 1) issues.push({ level: "error", message: `Exactly one START node is required (found ${starts.length}).` });
  if (!ends.length) issues.push({ level: "warning", message: "No END node. Runs stop when nothing else is scheduled, but an explicit END is clearer." });

  const out = (id: string) => spec.edges.filter((e) => e.source === id);
  const inc = (id: string) => spec.edges.filter((e) => e.target === id);

  for (const n of spec.nodes) {
    if (n.kind === "start" && !out(n.id).length) issues.push({ level: "error", nodeId: n.id, message: "START is not connected: the graph has no entrypoint." });
    if (n.kind !== "start" && n.kind !== "end" && !out(n.id).length)
      issues.push({ level: "warning", nodeId: n.id, message: `"${n.label}" has no outgoing edge — the run silently stops here. Connect it to END or another node.` });
    if (n.kind !== "start" && !inc(n.id).length) issues.push({ level: "warning", nodeId: n.id, message: `"${n.label}" has no incoming edge — it can never run.` });
    if (n.kind === "router") {
      const cfg = n.config as RouterConfig;
      const connected = new Set(out(n.id).map((e) => e.branch));
      for (const b of cfg.branches) if (!connected.has(b)) issues.push({ level: "error", nodeId: n.id, message: `Router "${n.label}" has no edge for branch "${b}".` });
      if (cfg.mode === "category" && cfg.defaultBranch && !connected.has(cfg.defaultBranch))
        issues.push({ level: "error", nodeId: n.id, message: `Router "${n.label}" default branch "${cfg.defaultBranch}" is not connected.` });
      if (out(n.id).some((e) => !e.branch)) issues.push({ level: "error", nodeId: n.id, message: `Router "${n.label}" has an edge without a branch label.` });
    }
    if (n.kind === "human" && !spec.checkpointer)
      issues.push({ level: "warning", nodeId: n.id, message: `"${n.label}" calls interrupt(), which requires a checkpointer. Turn persistence on.` });
  }

  // reachability from START
  const reach = new Set<string>();
  const stack = starts.map((s) => s.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    out(id).forEach((e) => stack.push(e.target));
  }
  for (const n of spec.nodes) if (!reach.has(n.id) && n.kind !== "start" && inc(n.id).length)
    issues.push({ level: "warning", nodeId: n.id, message: `"${n.label}" is unreachable from START.` });

  // routers reading keys nobody writes
  const schema = deriveSchema(spec);
  for (const n of spec.nodes.filter((x) => x.kind === "router")) {
    const cfg = n.config as RouterConfig;
    if (cfg.mode !== "expression" && cfg.field && !(cfg.field in schema))
      issues.push({ level: "error", nodeId: n.id, message: `Router "${n.label}" reads "${cfg.field}", but no node writes that key.` });
  }

  // cycles: warn if a cycle contains no router (cannot exit)
  const adj = new Map<string, string[]>();
  spec.edges.forEach((e) => adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]));
  const onPath = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];
  const dfs = (id: string, path: string[]) => {
    if (onPath.has(id)) {
      cycles.push(path.slice(path.indexOf(id)));
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    onPath.add(id);
    (adj.get(id) ?? []).forEach((t) => dfs(t, [...path, t]));
    onPath.delete(id);
  };
  starts.forEach((s) => dfs(s.id, [s.id]));
  for (const c of cycles) {
    const hasRouter = c.some((id) => byId.get(id)?.kind === "router");
    if (!hasRouter) issues.push({ level: "error", message: `Cycle ${c.map((id) => byId.get(id)?.label ?? id).join(" → ")} has no router, so it can never exit (GraphRecursionError).` });
    else issues.push({ level: "info", message: `Loop detected: ${c.map((id) => byId.get(id)?.label ?? id).join(" → ")}. Make sure its exit condition is always eventually met.` });
  }

  // parallel writes to same overwrite key
  for (const n of spec.nodes) {
    const targets = out(n.id).map((e) => byId.get(e.target)).filter(Boolean);
    if (n.kind === "router" || targets.length < 2) continue;
    const writes = new Map<string, string[]>();
    for (const t of targets) {
      if (!t) continue;
      const w = deriveWrites(spec, t.id);
      for (const k of w) writes.set(k, [...(writes.get(k) ?? []), t.label]);
    }
    writes.forEach((labels, key) => {
      if (labels.length > 1 && (schema[key]?.reducer ?? "overwrite") === "overwrite")
        issues.push({ level: "error", nodeId: n.id, message: `Parallel branches ${labels.join(" & ")} both write "${key}" without a reducer → InvalidUpdateError at runtime.` });
    });
  }
  return issues;
}

function deriveWrites(spec: WorkflowSpec, id: string): string[] {
  const n = spec.nodes.find((x) => x.id === id);
  if (!n) return [];
  return nodeWrites(n);
}
