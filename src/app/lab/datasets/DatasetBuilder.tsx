"use client";

import { ChartColumn, Copy, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { HBarChart } from "@/components/charts/Charts";
import { Badge, Button, Callout, Card, EmptyState, Field, Input, Modal, PageHeader, Pill, Select, TextArea } from "@/components/ui";
import { INTENTS, PRODUCTS, SENTIMENTS, type Intent, type Product, type Sentiment } from "@/lib/domain";
import { allDatasets, useDatasets, type Dataset, type DatasetExample } from "@/lib/store/datasets";
import { useHydrated } from "@/lib/store/hydration";
import { cn, download } from "@/lib/utils";

const HARD_TAGS = ["sarcasm", "mixed-signals", "hinglish", "noisy-asr", "callback", "third-party", "trust", "price-sensitive", "multi-product"];

function lastCustomerLine(input: string) {
  const lines = input.split("\n").filter((l) => /^customer\s*:/i.test(l));
  return (lines[lines.length - 1] ?? input.split("\n")[0] ?? "").replace(/^customer\s*:\s*/i, "");
}

function toCsv(d: Dataset) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [["id", "input", "intent", "product", "sentiment", "tags", "source"].join(",")];
  d.examples.forEach((e) => rows.push([e.id, esc(e.input), e.expected.intent, e.expected.product ?? "", e.expected.sentiment ?? "", esc(e.tags.join("|")), e.source].join(",")));
  return rows.join("\n");
}

interface Draft {
  id?: string;
  input: string;
  intent: Intent;
  product: Product;
  sentiment: Sentiment;
  tags: string;
  notes: string;
}

const EMPTY: Draft = { input: "Agent: Hello, how can I help?\nCustomer: ", intent: "interested", product: "personal_loan", sentiment: "neutral", tags: "", notes: "" };

export function DatasetBuilder() {
  const hydrated = useHydrated((s) => s.hydrated);
  const store = useDatasets();
  const datasets = useMemo(() => allDatasets(hydrated ? store.datasets : []), [hydrated, store.datasets]);
  const [selId, setSelId] = useState("builtin-handcrafted");
  const ds = datasets.find((d) => d.id === selId) ?? datasets[0];
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [label, setLabel] = useState<string>("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = ds.examples.filter(
    (e) => (!q || e.input.toLowerCase().includes(q.toLowerCase()) || e.id.includes(q)) && (!tag || e.tags.includes(tag)) && (label === "all" || e.expected.intent === label),
  );
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    ds.examples.forEach((e) => e.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [ds]);
  const dist = INTENTS.map((i) => ({ label: i, value: ds.examples.filter((e) => e.expected.intent === i).length }));
  const n = ds.examples.length;
  const warnings: string[] = [];
  if (n < 30) warnings.push(`Only ${n} examples — accuracy estimates will have wide error bars (±${n ? Math.round(98 / Math.sqrt(n)) : "∞"} points).`);
  const minShare = n ? Math.min(...dist.map((d) => d.value / n)) : 0;
  if (n && minShare < 0.15) warnings.push("One class is under 15% of the data — per-class recall for it will be noisy.");
  const hardCovered = HARD_TAGS.filter((t) => ds.examples.some((e) => e.tags.includes(t)));
  if (hardCovered.length < 4) warnings.push(`Covers only ${hardCovered.length} hard slices (${hardCovered.join(", ") || "none"}). Add sarcasm, callbacks, noisy audio, code-mixing…`);
  const dupes = n - new Set(ds.examples.map((e) => e.input.trim().toLowerCase())).size;
  if (dupes > 0) warnings.push(`${dupes} duplicate transcript(s).`);

  const editable = !ds.builtin;
  const saveDraft = () => {
    if (!draft) return;
    const ex: Omit<DatasetExample, "id"> = {
      input: draft.input,
      expected: { intent: draft.intent, product: draft.product, sentiment: draft.sentiment },
      tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
      notes: draft.notes || undefined,
      source: "user",
    };
    if (draft.id) store.updateExample(ds.id, draft.id, ex);
    else store.addExample(ds.id, ex);
    setDraft(null);
  };

  const importFile = (f: File) =>
    f.text().then((txt) => {
      try {
        const d = JSON.parse(txt) as Dataset;
        if (!d.id || !Array.isArray(d.examples)) throw new Error("Expected a dataset JSON exported from this lab");
        store.importDataset(d);
        setSelId(d.id);
      } catch (e) {
        alert((e as Error).message);
      }
    });

  return (
    <div>
      <PageHeader eyebrow="Evaluation datasets" title="Datasets: the exam your system takes after every change">
        Built-in sets are read-only; clone one to edit. Everything you create is stored in this browser — export JSON to back it up or put it in git.
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-2">
          {datasets.map((d) => (
            <button
              key={d.id}
              onClick={() => {
                setSelId(d.id);
                setTag(null);
              }}
              className={cn("rounded-xl border px-3 py-2 text-left", d.id === ds.id ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-ink">{d.name}</span>
                {d.builtin && <Badge>built-in</Badge>}
              </div>
              <div className="text-xs text-ink-3">{d.examples.length} examples</div>
            </button>
          ))}
          <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setNewOpen(true)}>
            New dataset
          </Button>
          <Button variant="ghost" size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>
            Import JSON
          </Button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-lg font-semibold text-ink">{ds.name}</div>
                <div className="text-sm text-ink-2">{ds.description}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ds.builtin ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Copy className="h-3.5 w-3.5" />}
                    onClick={() => {
                      const id = store.clone(ds, `${ds.name.replace(/ \(.*\)$/, "")} — my copy`);
                      setSelId(id);
                    }}
                  >
                    Clone to edit
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDraft({ ...EMPTY })}>
                    Add example
                  </Button>
                )}
                <Link href={`/lab/experiments?dataset=${ds.id}`}>
                  <Button size="sm" icon={<ChartColumn className="h-3.5 w-3.5" />}>
                    Run evaluation
                  </Button>
                </Link>
                <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={() => download(`${ds.id}.json`, JSON.stringify(ds, null, 2))}>
                  JSON
                </Button>
                <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={() => download(`${ds.id}.csv`, toCsv(ds), "text/csv")}>
                  CSV
                </Button>
                {editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => {
                      if (confirm(`Delete dataset "${ds.name}"? This cannot be undone.`)) {
                        store.remove(ds.id);
                        setSelId("builtin-handcrafted");
                      }
                    }}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Class balance (intent)</div>
                <HBarChart data={dist} format={(v) => `${v} · ${n ? Math.round((v / n) * 100) : 0}%`} />
              </div>
              <div className="flex flex-col gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Dataset health</div>
                {warnings.length ? (
                  warnings.map((w) => (
                    <Callout key={w} kind="warn">
                      {w}
                    </Callout>
                  ))
                ) : (
                  <Callout kind="success">Balanced, tagged, and covers the hard slices.</Callout>
                )}
              </div>
            </div>
          </Card>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="Search transcripts…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
              <Select className="w-44" value={label} onChange={setLabel} options={[{ value: "all", label: "All labels" }, ...INTENTS.map((i) => ({ value: i, label: i }))]} />
              <span className="text-xs text-ink-3">{filtered.length} shown</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tagCounts.slice(0, 16).map(([t, c]) => (
                <Pill key={t} active={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                  {t} · {c}
                </Pill>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="No examples match" action={editable ? <Button onClick={() => setDraft({ ...EMPTY })}>Add example</Button> : undefined}>
              {editable ? "Add your first labeled call." : "Try clearing the filters."}
            </EmptyState>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <tr>
                    <th className="px-3 py-2">Id</th>
                    <th className="px-3 py-2">Input (last customer turn)</th>
                    <th className="px-3 py-2">Expected</th>
                    <th className="px-3 py-2">Tags</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.slice(0, 200).map((e) => (
                    <tr key={e.id} className="align-top">
                      <td className="px-3 py-2 font-mono text-xs text-ink-3">{e.id}</td>
                      <td className="max-w-md px-3 py-2 text-ink-2">
                        <div className="line-clamp-2">“{lastCustomerLine(e.input)}”</div>
                        {e.source === "feedback" && <Badge tone="warn">from human review</Badge>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs text-ink">{e.expected.intent}</div>
                        <div className="font-mono text-[11px] text-ink-3">{e.expected.product}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {e.tags.slice(0, 4).map((t) => (
                            <Badge key={t}>{t}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {editable && (
                          <span className="flex justify-end gap-1">
                            <button
                              className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
                              aria-label="Edit"
                              onClick={() =>
                                setDraft({
                                  id: e.id,
                                  input: e.input,
                                  intent: e.expected.intent,
                                  product: e.expected.product ?? "none",
                                  sentiment: e.expected.sentiment ?? "neutral",
                                  tags: e.tags.join(", "),
                                  notes: e.notes ?? "",
                                })
                              }
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button className="rounded p-1 text-ink-3 hover:bg-bad-soft hover:text-bad-ink" aria-label="Delete" onClick={() => store.removeExample(ds.id, e.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > 200 && <div className="px-3 py-2 text-xs text-ink-3">Showing first 200.</div>}
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit example" : "Add example"}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveDraft} disabled={!draft?.input.trim()}>
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <div className="flex flex-col gap-3">
            <Field label="Transcript (one turn per line: “Agent: …” / “Customer: …”)">
              <TextArea rows={8} className="font-mono text-xs" value={draft.input} onChange={(e) => setDraft({ ...draft, input: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Expected intent">
                <Select value={draft.intent} onChange={(v) => setDraft({ ...draft, intent: v })} options={INTENTS.map((i) => ({ value: i, label: i }))} />
              </Field>
              <Field label="Expected product">
                <Select value={draft.product} onChange={(v) => setDraft({ ...draft, product: v })} options={PRODUCTS.map((i) => ({ value: i, label: i }))} />
              </Field>
              <Field label="Expected sentiment">
                <Select value={draft.sentiment} onChange={(v) => setDraft({ ...draft, sentiment: v })} options={SENTIMENTS.map((i) => ({ value: i, label: i }))} />
              </Field>
            </div>
            <Field label="Tags (comma-separated)" hint="e.g. sarcasm, hinglish, callback">
              <Input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
            </Field>
            <Field label="Notes (why is this example interesting?)">
              <Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </Field>
            {draft.id && <div className="text-xs text-ink-3">Editing the transcript text detaches it from the simulator&apos;s answer key: the simulated model will then “read” it like any new call.</div>}
          </div>
        )}
      </Modal>
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New dataset"
        footer={
          <Button
            variant="primary"
            disabled={!newName.trim()}
            onClick={() => {
              const id = store.create(newName.trim(), "My evaluation dataset");
              setSelId(id);
              setNewOpen(false);
              setNewName("");
            }}
          >
            Create
          </Button>
        }
      >
        <Input autoFocus placeholder="e.g. Hinglish calls — Q3" value={newName} onChange={(e) => setNewName(e.target.value)} />
      </Modal>
    </div>
  );
}
