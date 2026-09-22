"use client";

import { Trash2 } from "lucide-react";
import { ModelSelect } from "@/components/ModelSelect";
import { Badge, Button, Callout, Field, Input, Segmented, Select, Slider, TextArea, Toggle } from "@/components/ui";
import { getModel } from "@/config/models";
import { getPromptVersion, getTask, TASK_OPTIONS, TASKS } from "@/lib/ai/tasks";
import type { TaskId } from "@/lib/ai/types";
import { snakeCase } from "@/lib/utils";
import { deriveSchema } from "@/lib/workflows/compile";
import {
  FUNCTION_INFO,
  KIND_INFO,
  TOOL_INFO,
  type FunctionId,
  type FunctionNodeConfig,
  type HumanNodeConfig,
  type LLMNodeConfig,
  type RouterConfig,
  type ToolId,
  type ToolNodeConfig,
  type WfNode,
  type WorkflowSpec,
} from "@/lib/workflows/spec";
import { routerBranches } from "./nodes";

function updateNode(spec: WorkflowSpec, id: string, patch: (n: WfNode) => WfNode): WorkflowSpec {
  return { ...spec, nodes: spec.nodes.map((n) => (n.id === id ? patch(n) : n)) };
}

export function renameNodeId(spec: WorkflowSpec, oldId: string, newId: string): WorkflowSpec {
  return {
    ...spec,
    nodes: spec.nodes.map((n) => (n.id === oldId ? { ...n, id: newId } : n)),
    edges: spec.edges.map((e) => ({
      ...e,
      id: `${e.source === oldId ? newId : e.source}->${e.target === oldId ? newId : e.target}${e.branch ? `:${e.branch}` : ""}`,
      source: e.source === oldId ? newId : e.source,
      target: e.target === oldId ? newId : e.target,
    })),
  };
}

export function ConfigPanel({
  spec,
  nodeId,
  edgeId,
  onChange,
  onDeleteNode,
  onDeleteEdge,
}: {
  spec: WorkflowSpec;
  nodeId: string | null;
  edgeId: string | null;
  onChange: (s: WorkflowSpec) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
}) {
  const schemaKeys = Object.keys(deriveSchema(spec));
  if (edgeId) {
    const e = spec.edges.find((x) => x.id === edgeId);
    if (!e) return null;
    const src = spec.nodes.find((n) => n.id === e.source);
    const tgt = spec.nodes.find((n) => n.id === e.target);
    return (
      <div className="flex flex-col gap-3 text-sm">
        <div className="font-semibold text-ink">Edge</div>
        <div className="font-mono text-xs text-ink-2">
          {src?.label} → {tgt?.label}
        </div>
        {src?.kind === "router" ? (
          <Field label="Branch (which router outcome takes this edge)">
            <Select
              value={e.branch ?? ""}
              onChange={(b) =>
                onChange({ ...spec, edges: spec.edges.map((x) => (x.id === e.id ? { ...x, branch: b, id: `${x.source}->${x.target}:${b}` } : x)) })
              }
              options={routerBranches(src).map((b) => ({ value: b, label: b }))}
            />
          </Field>
        ) : (
          <div className="text-xs text-ink-3">A static edge: always fires after “{src?.label}” finishes. In Python: builder.add_edge(…)</div>
        )}
        <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onDeleteEdge(e.id)} className="self-start">
          Delete edge
        </Button>
      </div>
    );
  }
  const n = spec.nodes.find((x) => x.id === nodeId);
  if (!n)
    return (
      <div className="flex flex-col gap-2 text-sm text-ink-3">
        <div>Select a node or edge to configure it.</div>
        <ul className="list-disc pl-5 text-xs">
          <li>Add nodes from the palette (left).</li>
          <li>Drag from a node&apos;s bottom handle to another node&apos;s top handle to connect.</li>
          <li>Routers have one bottom handle per branch.</li>
          <li>Select + Backspace/Delete removes nodes and edges.</li>
        </ul>
      </div>
    );

  const set = (patch: Partial<WfNode>) => onChange(updateNode(spec, n.id, (x) => ({ ...x, ...patch })));
  const setCfg = <T,>(patch: Partial<T>) => onChange(updateNode(spec, n.id, (x) => ({ ...x, config: { ...(x.config as object), ...patch } as WfNode["config"] })));

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Badge tone={n.kind === "llm" ? "llm" : n.kind === "function" ? "fn" : n.kind === "router" ? "router" : n.kind === "human" ? "human" : n.kind === "tool" ? "tool" : "neutral"}>{KIND_INFO[n.kind].label}</Badge>
        {n.kind !== "start" && (
          <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onDeleteNode(n.id)}>
            Delete
          </Button>
        )}
      </div>
      <div className="text-xs text-ink-3">{KIND_INFO[n.kind].description}</div>
      {n.kind !== "start" && n.kind !== "end" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Label">
            <Input value={n.label} onChange={(e) => set({ label: e.target.value })} />
          </Field>
          <Field label="Node name (Python)">
            <Input
              defaultValue={n.id}
              key={n.id}
              onBlur={(e) => {
                const v = snakeCase(e.target.value) || n.id;
                if (v !== n.id && !spec.nodes.some((x) => x.id === v)) onChange(renameNodeId(spec, n.id, v));
                else e.target.value = n.id;
              }}
              className="font-mono text-xs"
            />
          </Field>
        </div>
      )}

      {n.kind === "llm" && <LLMConfig n={n} setCfg={setCfg} schemaKeys={schemaKeys} />}

      {n.kind === "function" && (
        <>
          <Field label="Function">
            <Select
              value={(n.config as FunctionNodeConfig).fn}
              onChange={(v) => setCfg<FunctionNodeConfig>({ fn: v as FunctionId, code: v === "custom" ? (n.config as FunctionNodeConfig).code ?? "return { note: 'hello from ' + state.transcript.length };" : undefined })}
              options={(Object.keys(FUNCTION_INFO) as FunctionId[]).map((f) => ({ value: f, label: FUNCTION_INFO[f].label }))}
            />
          </Field>
          <div className="text-xs text-ink-3">{FUNCTION_INFO[(n.config as FunctionNodeConfig).fn].description}</div>
          {(n.config as FunctionNodeConfig).fn === "custom" && (
            <Field label="JavaScript body (gets `state`, must return a dict)">
              <TextArea rows={6} className="font-mono text-xs" value={(n.config as FunctionNodeConfig).code ?? ""} onChange={(e) => setCfg<FunctionNodeConfig>({ code: e.target.value })} spellCheck={false} />
            </Field>
          )}
        </>
      )}

      {n.kind === "tool" && (
        <Field label="Tool">
          <Select value={(n.config as ToolNodeConfig).tool} onChange={(v) => setCfg<ToolNodeConfig>({ tool: v as ToolId })} options={(Object.keys(TOOL_INFO) as ToolId[]).map((t) => ({ value: t, label: TOOL_INFO[t].label }))} />
        </Field>
      )}

      {n.kind === "human" && (
        <>
          <Field label="Question for the reviewer">
            <Input value={(n.config as HumanNodeConfig).question} onChange={(e) => setCfg<HumanNodeConfig>({ question: e.target.value })} />
          </Field>
          <Field label="Fields the reviewer can correct (comma-separated)">
            <Input
              value={(n.config as HumanNodeConfig).fields.join(", ")}
              onChange={(e) => setCfg<HumanNodeConfig>({ fields: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
          {!spec.checkpointer && <Callout kind="warn">interrupt() needs a checkpointer — turn on Persistence in the toolbar.</Callout>}
        </>
      )}

      {n.kind === "router" && <RouterConfigEditor n={n} setCfg={setCfg} schemaKeys={schemaKeys} spec={spec} onChange={onChange} />}

      {n.kind !== "start" && n.kind !== "end" && n.kind !== "router" && (
        <Toggle checked={!!n.defer} onChange={(v) => set({ defer: v })} label={<span className="text-xs">defer=True (wait for all pending branches before running)</span>} />
      )}
    </div>
  );
}

function LLMConfig({ n, setCfg, schemaKeys }: { n: WfNode; setCfg: <T>(p: Partial<T>) => void; schemaKeys: string[] }) {
  const c = n.config as LLMNodeConfig;
  const task = getTask(c.task);
  const pv = getPromptVersion(c.task, c.promptVersion);
  const info = getModel(c.model);
  const customizing = c.customPrompt !== undefined;
  return (
    <>
      <Field label="Task">
        <Select
          value={c.task}
          onChange={(v) => {
            const t = v as TaskId;
            setCfg<LLMNodeConfig>({ task: t, promptVersion: t === "custom" ? "custom" : TASKS[t as Exclude<TaskId, "custom">].defaultVersion, customPrompt: t === "custom" ? "Analyze this call and return JSON.\n\n{{transcript}}" : undefined, customSystem: undefined, outputs: undefined });
          }}
          options={[...TASK_OPTIONS.map((t) => ({ value: t, label: TASKS[t].label })), { value: "custom", label: "Custom prompt" }]}
        />
      </Field>
      {task && (
        <Field label="Prompt version">
          <Segmented
            size="sm"
            value={customizing ? "edit" : c.promptVersion}
            onChange={(v) => (v === "edit" ? setCfg<LLMNodeConfig>({ customPrompt: pv?.user ?? "", customSystem: pv?.system }) : setCfg<LLMNodeConfig>({ promptVersion: v, customPrompt: undefined, customSystem: undefined }))}
            options={[...task.versions.map((v) => ({ id: v.id, label: v.id.toUpperCase(), title: v.summary })), { id: "edit", label: "✎" }]}
          />
        </Field>
      )}
      {task && !customizing && <div className="text-xs text-ink-3">{pv?.summary}</div>}
      {(customizing || !task) && (
        <>
          <Field label="System prompt">
            <TextArea rows={2} className="text-xs" value={c.customSystem ?? ""} onChange={(e) => setCfg<LLMNodeConfig>({ customSystem: e.target.value })} />
          </Field>
          <Field label="User prompt ({{transcript}} is replaced)">
            <TextArea rows={7} className="font-mono text-xs" value={c.customPrompt ?? ""} onChange={(e) => setCfg<LLMNodeConfig>({ customPrompt: e.target.value })} />
          </Field>
        </>
      )}
      <Field label="Model">
        <ModelSelect value={c.model} onChange={(v) => setCfg<LLMNodeConfig>({ model: v })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Slider label={info?.supportsTemperature === false ? "Temperature (fixed)" : "Temperature"} value={c.temperature} onChange={(v) => setCfg<LLMNodeConfig>({ temperature: v })} min={0} max={1.5} step={0.1} format={(v) => v.toFixed(1)} />
        <Slider label="Max tokens" value={c.maxTokens} onChange={(v) => setCfg<LLMNodeConfig>({ maxTokens: v })} min={16} max={4096} step={16} format={(v) => String(v)} />
      </div>
      <Field label="On invalid output">
        <Segmented
          size="sm"
          value={c.onParseError}
          onChange={(v) => setCfg<LLMNodeConfig>({ onParseError: v as "raise" | "store" })}
          options={[
            { id: "raise", label: "raise (node fails)" },
            { id: "store", label: `store in ${n.id}_error` },
          ]}
        />
      </Field>
      <Slider label="RetryPolicy max_attempts" value={c.retries} onChange={(v) => setCfg<LLMNodeConfig>({ retries: v })} min={1} max={5} step={1} format={(v) => (v === 1 ? "off" : String(v))} />
      <Field label="Read transcript from">
        <Select value={c.inputKey ?? ""} onChange={(v) => setCfg<LLMNodeConfig>({ inputKey: v || undefined })} options={[{ value: "", label: "auto (cleaned_transcript → transcript)" }, ...schemaKeys.map((k) => ({ value: k, label: k }))]} />
      </Field>
      {task && (
        <div>
          <div className="mb-1 text-xs font-medium text-ink-2">Output fields → state keys</div>
          <div className="flex flex-col gap-1.5">
            {Object.entries(task.outputs).map(([field, key]) => (
              <div key={field} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
                <span className="font-mono text-ink-2">{field}</span>
                <span className="text-ink-3">→</span>
                <Input
                  className="h-7 font-mono text-xs"
                  value={c.outputs?.[field] ?? key}
                  onChange={(e) => setCfg<LLMNodeConfig>({ outputs: { ...(c.outputs ?? {}), [field]: snakeCase(e.target.value) || key } })}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function RouterConfigEditor({ n, setCfg, schemaKeys, spec, onChange }: { n: WfNode; setCfg: <T>(p: Partial<T>) => void; schemaKeys: string[]; spec: WorkflowSpec; onChange: (s: WorkflowSpec) => void }) {
  const c = n.config as RouterConfig;
  const setBranches = (branches: string[]) => {
    // drop edges for branches that no longer exist
    const keep = new Set([...branches, ...(c.defaultBranch ? [c.defaultBranch] : [])]);
    onChange({
      ...spec,
      nodes: spec.nodes.map((x) => (x.id === n.id ? { ...x, config: { ...c, branches } } : x)),
      edges: spec.edges.filter((e) => e.source !== n.id || (e.branch && keep.has(e.branch))),
    });
  };
  return (
    <>
      <Field label="Routing mode">
        <Segmented
          size="sm"
          value={c.mode}
          onChange={(m) =>
            setCfg<RouterConfig>(
              m === "threshold"
                ? { mode: "threshold", field: c.field || "confidence", op: "<", value: 0.7, branches: ["low", "high"], defaultBranch: undefined }
                : m === "category"
                  ? { mode: "category", field: c.field || "intent", branches: ["interested", "not_interested", "unclear"] }
                  : { mode: "expression", expression: c.expression ?? "state.is_valid ? 'valid' : 'retry'", branches: ["valid", "retry"] },
            )
          }
          options={[
            { id: "threshold", label: "threshold" },
            { id: "category", label: "category" },
            { id: "expression", label: "expression" },
          ]}
        />
      </Field>
      {c.mode !== "expression" && (
        <Field label="State key to read">
          <Select value={c.field} onChange={(v) => setCfg<RouterConfig>({ field: v })} options={[...new Set([...schemaKeys, c.field])].map((k) => ({ value: k, label: schemaKeys.includes(k) ? k : `${k} (not written by any node!)` }))} />
        </Field>
      )}
      {c.mode === "threshold" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Operator">
              <Select value={c.op ?? "<"} onChange={(v) => setCfg<RouterConfig>({ op: v as RouterConfig["op"] })} options={["<", "<=", ">", ">=", "==", "!="].map((o) => ({ value: o, label: o }))} />
            </Field>
            <Field label="Value">
              <Input value={String(c.value ?? "")} onChange={(e) => setCfg<RouterConfig>({ value: e.target.value !== "" && !isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Branch if TRUE">
              <Input value={c.branches[0]} onChange={(e) => setBranches([snakeCase(e.target.value) || "yes", c.branches[1]])} />
            </Field>
            <Field label="Branch if FALSE">
              <Input value={c.branches[1]} onChange={(e) => setBranches([c.branches[0], snakeCase(e.target.value) || "no"])} />
            </Field>
          </div>
        </>
      )}
      {c.mode === "category" && (
        <>
          <Field label="Branches (one per value, comma-separated)">
            <Input defaultValue={c.branches.join(", ")} key={c.branches.join(",")} onBlur={(e) => setBranches(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
          </Field>
          <Field label="Default branch (optional, when no value matches)">
            <Input value={c.defaultBranch ?? ""} onChange={(e) => setCfg<RouterConfig>({ defaultBranch: snakeCase(e.target.value) || undefined })} />
          </Field>
        </>
      )}
      {c.mode === "expression" && (
        <>
          <Field label="JS expression over `state` returning a branch name">
            <TextArea rows={3} className="font-mono text-xs" value={c.expression ?? ""} onChange={(e) => setCfg<RouterConfig>({ expression: e.target.value })} />
          </Field>
          <Field label="Possible branches (comma-separated)">
            <Input defaultValue={c.branches.join(", ")} key={c.branches.join(",")} onBlur={(e) => setBranches(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
          </Field>
        </>
      )}
      <div className="rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-ink-3">
        Drag from each labeled bottom handle to the node that branch should run. In Python this becomes <code className="font-mono">add_conditional_edges(prev_node, route_{n.id}, [...])</code>.
      </div>
    </>
  );
}
