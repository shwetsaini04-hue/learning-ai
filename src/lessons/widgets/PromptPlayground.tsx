"use client";

import { Play, Repeat } from "lucide-react";
import { useMemo, useState } from "react";
import { ModelSelect } from "@/components/ModelSelect";
import { JsonBlock } from "@/components/learn/JsonView";
import { TranscriptPicker } from "@/components/graph/WorkflowRunner";
import { Badge, Button, Callout, Card, Field, Segmented, Slider, TextArea } from "@/components/ui";
import { getModel } from "@/config/models";
import { invokeLLM } from "@/lib/ai/client";
import { parseStructured } from "@/lib/ai/schema";
import { getPromptVersion, renderPrompt, TASKS } from "@/lib/ai/tasks";
import type { LLMResponse, TaskId } from "@/lib/ai/types";
import { transcriptToText } from "@/lib/domain";
import { findTranscript } from "@/lib/sim/transcripts";
import { useProgress } from "@/lib/store/progress";
import { cn, estimateTokens, fmtMs, fmtUsd, freshSeed } from "@/lib/utils";

interface Result {
  res?: LLMResponse;
  error?: string;
  parsed: ReturnType<typeof parseStructured> | null;
}

/**
 * Prompt → LLM → Output, with everything visible: rendered prompt, tokens,
 * raw text, parse result, latency and cost.
 */
export function PromptPlayground({ task = "classify_intent", defaultVersion = "v1", allowEdit = true, showRepeat = true }: { task?: Exclude<TaskId, "custom">; defaultVersion?: string; allowEdit?: boolean; showRepeat?: boolean }) {
  const def = TASKS[task as Exclude<TaskId, "custom" | "judge">] ?? TASKS.classify_intent;
  const [version, setVersion] = useState(defaultVersion);
  const [tid, setTid] = useState("t01");
  const [custom, setCustom] = useState("Agent: Hello, FinServe Bank.\nCustomer: I need a car loan for a used car, what documents are required?");
  const [model, setModel] = useState("sim:swift-m");
  const [temperature, setTemperature] = useState(0);
  const [maxTokens, setMaxTokens] = useState(512);
  const [editing, setEditing] = useState(false);
  const pv = getPromptVersion(task, version)!;
  const [customUser, setCustomUser] = useState(pv.user);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const bump = useProgress((s) => s.bump);

  const transcript = tid === "custom" ? custom : transcriptToText(findTranscript(tid)!);
  const userTemplate = editing ? customUser : pv.user;
  const rendered = useMemo(() => renderPrompt(userTemplate.includes("{{transcript}}") ? userTemplate : userTemplate + "\n\n{{transcript}}", { transcript }), [userTemplate, transcript]);
  const info = getModel(model);

  const runOnce = async (runIndex: number): Promise<Result> => {
    try {
      const res = await invokeLLM({
        model,
        system: pv.system,
        prompt: rendered,
        temperature,
        maxTokens,
        task,
        promptVersion: editing ? "custom" : version,
        sim: { transcript, transcriptId: tid === "custom" ? undefined : tid, runIndex },
      });
      return { res, parsed: parseStructured(res.text, def.schema) };
    } catch (e) {
      return { error: (e as Error).message, parsed: null };
    }
  };

  const run = async (n: number) => {
    setBusy(true);
    const base = freshSeed();
    const out: Result[] = [];
    for (let i = 0; i < n; i++) out.push(await runOnce(base + i));
    setResults(out);
    setBusy(false);
    bump("prompt_runs");
  };

  const last = results[0];
  const labels = results.map((r) => (r.parsed?.ok ? String(r.parsed.value?.[Object.keys(def.schema)[0]]) : "invalid"));
  const dist = labels.reduce<Record<string, number>>((a, l) => ((a[l] = (a[l] ?? 0) + 1), a), {});

  return (
    <Card className="my-6 overflow-hidden">
      <div className="border-b border-line bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink">Prompt playground · {def.label}</div>
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Field label="Transcript">
            <TranscriptPicker value={tid} onChange={setTid} customText={custom} onCustomText={setCustom} />
          </Field>
          <Field label="Prompt version">
            <Segmented
              size="sm"
              value={editing ? "custom" : version}
              onChange={(v) => {
                if (v === "custom") {
                  setCustomUser(pv.user);
                  setEditing(true);
                } else {
                  setEditing(false);
                  setVersion(v);
                }
              }}
              options={[...def.versions.map((v) => ({ id: v.id, label: v.id.toUpperCase(), title: v.label })), ...(allowEdit ? [{ id: "custom", label: "✎ edit" }] : [])]}
            />
          </Field>
          <div className="text-xs text-ink-3">{editing ? "Editing your own prompt — keep {{transcript}} where the call should go." : pv.summary}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Model">
              <ModelSelect value={model} onChange={setModel} />
            </Field>
            <Field label="Max output tokens">
              <Slider value={maxTokens} onChange={setMaxTokens} min={16} max={1024} step={16} format={(v) => String(v)} />
            </Field>
          </div>
          <Slider
            label={info?.supportsTemperature === false ? "Temperature (not supported by this model — fixed)" : "Temperature"}
            value={temperature}
            onChange={setTemperature}
            min={0}
            max={1.5}
            step={0.1}
            format={(v) => v.toFixed(1)}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => run(1)} disabled={busy} icon={<Play className="h-4 w-4" />}>
              Send to model
            </Button>
            {showRepeat && (
              <Button onClick={() => run(8)} disabled={busy} icon={<Repeat className="h-4 w-4" />}>
                Run 8×
              </Button>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wide text-ink-3">Prompt sent</span>
            <span className="text-ink-3">
              ≈ {estimateTokens(pv.system) + estimateTokens(rendered)} input tokens
            </span>
          </div>
          {editing ? (
            <TextArea rows={9} value={customUser} onChange={(e) => setCustomUser(e.target.value)} className="font-mono text-xs" />
          ) : (
            <JsonBlock value={`[system] ${pv.system}\n\n[user] ${rendered}`} maxHeight={220} />
          )}
          {last && (
            <div className="fade-in flex flex-col gap-2">
              {last.error ? (
                <Callout kind="danger" title="Call failed">
                  {last.error}
                </Callout>
              ) : (
                last.res && (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold uppercase tracking-wide text-ink-3">Raw model output</span>
                      <span className="flex gap-1.5">
                        <Badge>{fmtMs(last.res.latencyMs)}</Badge>
                        <Badge>
                          {last.res.inputTokens}→{last.res.outputTokens}
                          {last.res.reasoningTokens ? `+${last.res.reasoningTokens}r` : ""} tok
                        </Badge>
                        <Badge>{fmtUsd(last.res.costUsd, { precise: true })}</Badge>
                      </span>
                    </div>
                    <JsonBlock value={last.res.text || "(empty)"} maxHeight={140} />
                    {last.parsed?.ok ? (
                      <Callout kind="success" title="Parsed & valid">
                        <code className="font-mono text-xs">{JSON.stringify(last.parsed.value)}</code>
                      </Callout>
                    ) : (
                      <Callout kind="danger" title="Your code can't use this output">
                        {last.parsed?.error?.message}
                      </Callout>
                    )}
                  </>
                )
              )}
              {results.length > 1 && (
                <div className="rounded-lg border border-line p-2.5">
                  <div className="mb-1.5 text-xs font-semibold text-ink">Same prompt, {results.length} runs:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(dist).map(([l, c]) => (
                      <Badge key={l} tone={l === "invalid" ? "bad" : "accent"}>
                        {l} × {c}
                      </Badge>
                    ))}
                  </div>
                  <div className={cn("mt-1.5 text-xs", Object.keys(dist).length > 1 ? "text-warn-ink" : "text-ink-3")}>
                    {Object.keys(dist).length > 1 ? "Different answers for identical input — that's what evaluation has to account for." : "Consistent across runs."}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
