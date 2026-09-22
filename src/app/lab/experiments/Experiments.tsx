"use client";

import { Play, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfusionMatrix, GroupedBarChart, HBarChart, Histogram } from "@/components/charts/Charts";
import { ModelSelect } from "@/components/ModelSelect";
import { JsonBlock } from "@/components/learn/JsonView";
import { Badge, Button, Callout, Card, CardHeader, Collapsible, EmptyState, Field, Modal, PageHeader, Pill, ProgressBar, Segmented, Select, Slider, Stat } from "@/components/ui";
import { isSimulated } from "@/config/models";
import { TASKS } from "@/lib/ai/tasks";
import { diffExperiments, estimateExperiment, runExperiment, type Experiment, type ExperimentTask } from "@/lib/eval/runner";
import { allDatasets, useDatasets } from "@/lib/store/datasets";
import { useExperiments } from "@/lib/store/experiments";
import { useHydrated } from "@/lib/store/hydration";
import { useProgress } from "@/lib/store/progress";
import { useSettings } from "@/lib/store/settings";
import { cn, fmtInt, fmtMs, fmtPct, fmtUsd } from "@/lib/utils";

function ExperimentDetail({ e }: { e: Experiment }) {
  const m = e.metrics;
  const [filter, setFilter] = useState<string>("failures");
  const rows = e.results.filter((r) => (filter === "all" ? true : filter === "failures" ? !r.correct : filter === "invalid" ? !r.valid : r.tags.includes(filter) && !r.correct));
  const failTags = [...new Set(e.results.filter((r) => !r.correct).flatMap((r) => r.tags))].slice(0, 10);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Accuracy" value={fmtPct(m.accuracy)} sub={`95% CI ${fmtPct(m.accuracyCI.low, 0)}–${fmtPct(m.accuracyCI.high, 0)}`} />
        <Stat label="Macro precision" value={m.macroPrecision.toFixed(3)} />
        <Stat label="Macro recall" value={m.macroRecall.toFixed(3)} />
        <Stat label="Macro F1" value={m.macroF1.toFixed(3)} />
        <Stat label="Invalid outputs" value={fmtPct(m.invalidRate)} tone={m.invalidRate > 0.02 ? "bad" : undefined} />
        <Stat label="Overconfident errors" value={fmtPct(m.overconfidentErrorRate, 0)} sub="wrong with conf ≥ 0.8" />
        <Stat label="Avg latency" value={fmtMs(m.latency.mean)} />
        <Stat label="P95 latency" value={fmtMs(m.latency.p95)} tone="warn" />
        <Stat label="Avg input tokens" value={fmtInt(m.avgInputTokens)} />
        <Stat label="Avg output tokens" value={fmtInt(m.avgOutputTokens)} sub="incl. reasoning" />
        <Stat label="Total cost" value={fmtUsd(m.totalCost, { precise: m.totalCost < 1 })} sub={`${fmtUsd(m.costPer1k)} / 1K calls`} />
        <Stat label="Errors / hallucination" value={fmtPct(1 - m.accuracy)} sub={`${m.providerErrorRate ? fmtPct(m.providerErrorRate) + " provider errors" : "no provider errors"}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Confusion matrix" subtitle="rows = expected, columns = predicted" />
          <div className="px-4 pb-4">
            <ConfusionMatrix labels={m.labels} predictedLabels={m.predictedLabels} matrix={m.matrix} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Per-class F1" />
          <div className="px-4 pb-4">
            <HBarChart
              max={1}
              format={(v) => v.toFixed(3)}
              data={m.perClass.map((c) => ({ label: c.label, sub: `n=${c.support}`, value: c.f1, tooltip: <span className="text-xs">P {c.precision.toFixed(2)} · R {c.recall.toFixed(2)}</span> }))}
            />
            <table className="mt-3 w-full text-xs">
              <thead className="text-ink-3">
                <tr className="border-b border-line">
                  <th className="py-1 text-left font-medium">class</th>
                  <th className="py-1 pl-3 text-right font-medium">precision</th>
                  <th className="py-1 pl-3 text-right font-medium">recall</th>
                  <th className="py-1 pl-3 text-right font-medium">F1</th>
                </tr>
              </thead>
              <tbody>
                {m.perClass.map((c) => (
                  <tr key={c.label} className="border-b border-line/60">
                    <td className="py-1 font-mono text-ink">{c.label}</td>
                    <td className="num py-1 pl-3 text-right font-mono">{c.precision.toFixed(3)}</td>
                    <td className="num py-1 pl-3 text-right font-mono">{c.recall.toFixed(3)}</td>
                    <td className="num py-1 pl-3 text-right font-mono font-semibold">{c.f1.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="Latency distribution" subtitle={`P50 ${fmtMs(m.latency.p50)} · P95 ${fmtMs(m.latency.p95)} · P99 ${fmtMs(m.latency.p99)}`} />
          <div className="px-4 pb-4">
            <Histogram values={e.results.map((r) => r.latencyMs)} format={(v) => fmtMs(v)} markers={[{ value: m.latency.p50, label: "P50" }, { value: m.latency.p95, label: "P95", color: "var(--bad)" }]} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Accuracy by slice (tag)" subtitle="lowest first — where to focus" />
          <div className="max-h-[300px] overflow-y-auto px-4 pb-4">
            <HBarChart max={1} format={(v) => fmtPct(v, 0)} data={m.byTag.slice(0, 14).map((t) => ({ label: t.tag, sub: `n=${t.n}`, value: t.accuracy, color: t.accuracy < 0.8 ? "var(--s8)" : "var(--s1)" }))} />
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Error analysis" subtitle="Read failures, group them, find the root cause" />
        <div className="flex flex-wrap gap-1.5 px-4">
          {["failures", "invalid", "all", ...failTags].map((f) => (
            <Pill key={f} active={filter === f} onClick={() => setFilter(f)}>
              {f}
            </Pill>
          ))}
        </div>
        <div className="max-h-[420px] overflow-auto p-4">
          <table className="w-full min-w-[680px] text-xs">
            <thead className="text-left text-[10.5px] uppercase tracking-wide text-ink-3">
              <tr className="border-b border-line">
                <th className="py-1">id</th>
                <th className="py-1">expected</th>
                <th className="py-1">predicted</th>
                <th className="py-1 text-right">conf.</th>
                <th className="py-1">tags</th>
                <th className="py-1">raw output / error</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 150).map((r) => (
                <tr key={r.exampleId} className="border-b border-line/60 align-top">
                  <td className="py-1.5 font-mono text-ink-3">{r.exampleId}</td>
                  <td className="py-1.5 font-mono">{r.expected}</td>
                  <td className={cn("py-1.5 font-mono", r.correct ? "text-good-ink" : "text-bad-ink")}>{r.predicted ?? "invalid"}</td>
                  <td className="num py-1.5 text-right font-mono">{r.confidence ?? "—"}</td>
                  <td className="py-1.5">
                    <span className="flex flex-wrap gap-1">
                      {r.tags.slice(0, 3).map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </span>
                  </td>
                  <td className="max-w-xs py-1.5 font-mono text-[11px] text-ink-2">
                    <span className="line-clamp-2 break-all">{r.error ?? r.raw}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="py-6 text-center text-sm text-ink-3">Nothing here.</div>}
        </div>
      </Card>
      <Collapsible title={<span className="text-sm">Prompt used ({e.config.promptVersion.toUpperCase()})</span>}>
        <JsonBlock value={`[system] ${e.prompt.system}\n\n[user] ${e.prompt.user}`} maxHeight={300} />
      </Collapsible>
    </div>
  );
}

function Compare({ exps }: { exps: Experiment[] }) {
  const [base, cand] = exps;
  const diff = diffExperiments(base, cand);
  const short = (e: Experiment) => e.name.length > 26 ? e.name.slice(0, 25) + "…" : e.name;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Quality" />
          <div className="px-4 pb-4">
            <GroupedBarChart
              groups={["accuracy", "macro F1", "valid outputs"]}
              series={exps.map((e) => ({ label: short(e), values: [e.metrics.accuracy, e.metrics.macroF1, 1 - e.metrics.invalidRate] }))}
              max={1}
              format={(v) => v.toFixed(2)}
            />
          </div>
        </Card>
        <Card className="overflow-x-auto">
          <CardHeader title="Cost & latency" />
          <table className="mx-4 mb-4 w-[calc(100%-2rem)] text-xs">
            <thead className="text-ink-3">
              <tr className="border-b border-line">
                <th className="py-1 text-left font-medium">experiment</th>
                <th className="py-1 pl-3 text-right font-medium">cost/1K</th>
                <th className="py-1 pl-3 text-right font-medium">P50</th>
                <th className="py-1 pl-3 text-right font-medium">P95</th>
                <th className="py-1 pl-3 text-right font-medium">in tok</th>
              </tr>
            </thead>
            <tbody>
              {exps.map((e) => (
                <tr key={e.id} className="border-b border-line/60">
                  <td className="py-1.5 text-ink">{short(e)}</td>
                  <td className="num py-1.5 text-right font-mono">{fmtUsd(e.metrics.costPer1k)}</td>
                  <td className="num py-1.5 text-right font-mono">{fmtMs(e.metrics.latency.p50)}</td>
                  <td className="num py-1.5 text-right font-mono">{fmtMs(e.metrics.latency.p95)}</td>
                  <td className="num py-1.5 text-right font-mono">{fmtInt(e.metrics.avgInputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card>
        <CardHeader title={`Regression check: ${short(base)} (baseline) → ${short(cand)} (candidate)`} subtitle={`${diff.common} shared examples`} />
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-4">
          <Stat label="Both right" value={diff.bothRight} />
          <Stat label="Fixed ✗→✓" value={diff.fixed.length} tone="good" />
          <Stat label="Regressed ✓→✗" value={diff.regressed.length} tone={diff.regressed.length ? "bad" : "good"} />
          <Stat label="Both wrong" value={diff.bothWrong} />
        </div>
        {diff.regressed.length > 0 && (
          <div className="px-4 pb-4">
            <div className="mb-1 text-xs font-semibold text-bad-ink">Regressed examples</div>
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {diff.regressed.map((r) => (
                <div key={r.exampleId} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-ink-3">{r.exampleId}</span>
                  <span className="font-mono">
                    {r.expected} → {r.predicted ?? "invalid"}
                  </span>
                  {r.tags.slice(0, 3).map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        {base.config.datasetId !== cand.config.datasetId && (
          <div className="px-4 pb-4">
            <Callout kind="warn">These experiments ran on different datasets — the comparison is not apples to apples.</Callout>
          </div>
        )}
      </Card>
    </div>
  );
}

export function Experiments({ initialDataset }: { initialDataset?: string }) {
  const hydrated = useHydrated((s) => s.hydrated);
  const userDs = useDatasets((s) => s.datasets);
  const datasets = useMemo(() => allDatasets(hydrated ? userDs : []), [hydrated, userDs]);
  const experiments = useExperiments((s) => s.experiments);
  const add = useExperiments((s) => s.add);
  const remove = useExperiments((s) => s.remove);
  const bump = useProgress((s) => s.bump);
  const settings = useSettings();
  const [dsId, setDsId] = useState(initialDataset ?? "builtin-benchmark");
  const [model, setModel] = useState("sim:swift-m");
  const [task, setTask] = useState<ExperimentTask>("classify_intent");
  const [versions, setVersions] = useState<string[]>(["v3"]);
  const [temperature, setTemperature] = useState(0);
  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null);
  const [confirm, setConfirm] = useState<{ cost: number; calls: number } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const ds = datasets.find((d) => d.id === dsId) ?? datasets[0];
  const live = !isSimulated(model);
  const examples = live ? ds.examples.slice(0, settings.maxLiveExamples) : ds.examples;
  const est = versions.reduce(
    (a, v) => {
      const e = estimateExperiment({ datasetId: ds.id, datasetName: ds.name, model, task, promptVersion: v, temperature, maxTokens: 512 }, examples);
      return { cost: a.cost + e.cost, calls: a.calls + e.calls };
    },
    { cost: 0, calls: 0 },
  );
  const taskVersions = TASKS[task].versions;

  const run = async () => {
    setConfirm(null);
    const ids: string[] = [];
    for (const v of versions) {
      setProgress({ label: `${v.toUpperCase()}`, pct: 0 });
      const exp = await runExperiment({ datasetId: ds.id, datasetName: ds.name, model, task, promptVersion: v, temperature, maxTokens: 512 }, examples, (d, n) =>
        setProgress({ label: v.toUpperCase(), pct: d / n }),
      );
      add(exp);
      bump("experiments", exp.name);
      ids.push(exp.id);
    }
    // select this batch in run order: the first version run is the baseline for the regression diff
    setSelected(ids.slice(0, 4));
    setProgress(null);
  };
  const start = () => {
    // every live batch is confirmed with its estimated cost; simulated runs are free and instant
    if (live) setConfirm(est);
    else run();
  };

  const sel = selected.map((id) => experiments.find((e) => e.id === id)).filter(Boolean) as Experiment[];

  return (
    <div>
      <PageHeader eyebrow="Experiments" title="Evaluation experiments & prompt regression testing">
        Run a dataset through a model and one or more prompt versions. Every run is saved (in this browser) with its full per-example results so you can compare versions and find exactly
        what changed.
      </PageHeader>
      <Card className="mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Dataset">
            <Select value={ds.id} onChange={setDsId} options={datasets.map((d) => ({ value: d.id, label: `${d.name} (${d.examples.length})` }))} />
          </Field>
          <Field label="Model">
            <ModelSelect value={model} onChange={setModel} />
          </Field>
          <Field label="Task">
            <Segmented
              size="sm"
              value={task}
              onChange={(t) => {
                setTask(t);
                setVersions([TASKS[t].defaultVersion]);
              }}
              options={[
                { id: "classify_intent", label: "Intent" },
                { id: "full_analysis", label: "Full analysis" },
              ]}
            />
          </Field>
          <Slider label="Temperature" value={temperature} onChange={setTemperature} min={0} max={1.2} step={0.1} format={(v) => v.toFixed(1)} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-2">Prompt versions:</span>
          {taskVersions.map((v) => (
            <Pill key={v.id} active={versions.includes(v.id)} onClick={() => setVersions(versions.includes(v.id) ? versions.filter((x) => x !== v.id) : [...versions, v.id])}>
              {v.label}
            </Pill>
          ))}
          <button className="text-xs text-accent" onClick={() => setVersions(taskVersions.map((v) => v.id))}>
            select all (prompt comparison)
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={start} disabled={!!progress || !versions.length} icon={<Play className="h-4 w-4" />}>
            Run {versions.length} experiment{versions.length > 1 ? "s" : ""}
          </Button>
          <span className="text-xs text-ink-3">
            {est.calls} calls · est. {fmtUsd(est.cost, { precise: true })} {live ? "(real money)" : "(simulated pricing — free)"}
            {live && ds.examples.length > examples.length && ` · capped to ${examples.length} examples in live mode`}
          </span>
          {progress && (
            <span className="flex min-w-[200px] items-center gap-2 text-xs text-ink-2">
              {progress.label} <ProgressBar value={progress.pct} className="w-40" />
            </span>
          )}
        </div>
      </Card>

      {!hydrated ? null : experiments.length === 0 ? (
        <EmptyState title="No experiments yet" action={<Button onClick={start}>Run your first experiment</Button>}>
          Start with the benchmark, Swift-M and all four prompt versions to see prompt regression in action.
        </EmptyState>
      ) : (
        <>
          <Card className="mb-5 overflow-x-auto">
            <table className="w-full min-w-[860px] text-xs">
              <thead className="bg-surface-2 text-left text-[10.5px] uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-3 py-2" />
                  <th className="px-3 py-2">Experiment</th>
                  <th className="px-3 py-2">Dataset</th>
                  <th className="px-3 py-2 text-right">Acc.</th>
                  <th className="px-3 py-2 text-right">Macro F1</th>
                  <th className="px-3 py-2 text-right">Invalid</th>
                  <th className="px-3 py-2 text-right">P95</th>
                  <th className="px-3 py-2 text-right">Cost/1K</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {experiments.map((e) => {
                  const on = selected.includes(e.id);
                  return (
                    <tr key={e.id} className={cn("cursor-pointer hover:bg-surface-2", on && "bg-accent-soft")} onClick={() => setSelected(on ? selected.filter((x) => x !== e.id) : [...selected, e.id].slice(-4))}>
                      <td className="px-3 py-2">
                        <input type="checkbox" readOnly checked={on} className="accent-[var(--accent)]" />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-ink">{e.name}</div>
                        <div className="text-ink-3">
                          {new Date(e.createdAt).toLocaleString()} {!e.simulated && <Badge tone="warn">live</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-ink-2">{e.config.datasetName.split(" (")[0]}</td>
                      <td className="num px-3 py-2 text-right font-mono">{fmtPct(e.metrics.accuracy)}</td>
                      <td className="num px-3 py-2 text-right font-mono">{e.metrics.macroF1.toFixed(3)}</td>
                      <td className="num px-3 py-2 text-right font-mono">{fmtPct(e.metrics.invalidRate)}</td>
                      <td className="num px-3 py-2 text-right font-mono">{fmtMs(e.metrics.latency.p95)}</td>
                      <td className="num px-3 py-2 text-right font-mono">{fmtUsd(e.metrics.costPer1k)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          aria-label="Delete experiment"
                          className="rounded p-1 text-ink-3 hover:bg-bad-soft hover:text-bad-ink"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            remove(e.id);
                            setSelected(selected.filter((x) => x !== e.id));
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          {sel.length === 0 && <div className="text-sm text-ink-3">Select one experiment for its dashboard, or two to four to compare (the first selected is the baseline).</div>}
          {sel.length === 1 && <ExperimentDetail e={sel[0]} />}
          {sel.length >= 2 && <Compare exps={sel} />}
        </>
      )}
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Confirm live experiment"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={run}>
              Run {confirm?.calls} real API calls
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-sm text-ink-2">
          <p>
            This will make <strong className="text-ink">{confirm?.calls}</strong> real calls to <span className="font-mono">{model}</span>, estimated at{" "}
            <strong className="text-ink">{fmtUsd(confirm?.cost ?? 0, { precise: true })}</strong> (reasoning models may cost more than estimated).
          </p>
          <p>
            Your browser budget guard: {fmtUsd(settings.liveSpendUsd, { precise: true })} spent of {fmtUsd(settings.budgetUsd)}. Calls stop automatically when the budget is reached.
          </p>
        </div>
      </Modal>
    </div>
  );
}
