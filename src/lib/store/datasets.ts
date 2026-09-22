"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { transcriptToText, type Intent, type Product, type Sentiment } from "@/lib/domain";
import { getBenchmark, TRANSCRIPTS } from "@/lib/sim/transcripts";
import { uid } from "@/lib/utils";

export interface DatasetExample {
  id: string;
  input: string;
  /** set when the example is an unmodified built-in transcript */
  transcriptId?: string;
  expected: { intent: Intent; product?: Product; sentiment?: Sentiment };
  tags: string[];
  notes?: string;
  source: "builtin" | "user" | "feedback";
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  examples: DatasetExample[];
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;
}

export function builtinDatasets(): Dataset[] {
  const hand: Dataset = {
    id: "builtin-handcrafted",
    name: "Handcrafted edge cases (30)",
    description: "Hand-written calls covering sarcasm, Hinglish, callbacks, noisy audio, contradictions and PII.",
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
    examples: TRANSCRIPTS.map((t) => ({
      id: t.id,
      input: transcriptToText(t),
      transcriptId: t.id,
      expected: { intent: t.labels.intent, product: t.labels.product, sentiment: t.labels.sentiment },
      tags: t.tags,
      notes: t.note,
      source: "builtin" as const,
    })),
  };
  const bench: Dataset = {
    id: "builtin-benchmark",
    name: "Benchmark (120 generated)",
    description: "Synthetic calls labeled by construction. Realistic class mix; use it for experiments and regression tests.",
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
    examples: getBenchmark().map((t) => ({
      id: t.id,
      input: transcriptToText(t),
      transcriptId: t.id,
      expected: { intent: t.labels.intent, product: t.labels.product, sentiment: t.labels.sentiment },
      tags: t.tags,
      source: "builtin" as const,
    })),
  };
  return [hand, bench];
}

interface DatasetsState {
  datasets: Dataset[];
  create: (name: string, description?: string, examples?: DatasetExample[]) => string;
  clone: (source: Dataset, name?: string) => string;
  rename: (id: string, name: string, description?: string) => void;
  remove: (id: string) => void;
  addExample: (datasetId: string, ex: Omit<DatasetExample, "id">) => void;
  updateExample: (datasetId: string, exId: string, patch: Partial<DatasetExample>) => void;
  removeExample: (datasetId: string, exId: string) => void;
  importDataset: (d: Dataset) => void;
  addFeedback: (ex: Omit<DatasetExample, "id" | "source">) => void;
}

export const FEEDBACK_DATASET_ID = "user-feedback";

export const useDatasets = create<DatasetsState>()(
  persist(
    (set, get) => ({
      datasets: [],
      create: (name, description = "", examples = []) => {
        const id = uid("ds");
        const now = Date.now();
        set({ datasets: [...get().datasets, { id, name, description, examples, createdAt: now, updatedAt: now }] });
        return id;
      },
      clone: (source, name) => {
        const id = uid("ds");
        const now = Date.now();
        const examples = source.examples.map((e) => ({ ...e, id: uid("ex"), source: e.source === "builtin" ? ("builtin" as const) : e.source }));
        set({ datasets: [...get().datasets, { id, name: name ?? `${source.name} (copy)`, description: source.description, examples, createdAt: now, updatedAt: now }] });
        return id;
      },
      rename: (id, name, description) =>
        set({ datasets: get().datasets.map((d) => (d.id === id ? { ...d, name, description: description ?? d.description, updatedAt: Date.now() } : d)) }),
      remove: (id) => set({ datasets: get().datasets.filter((d) => d.id !== id) }),
      addExample: (datasetId, ex) =>
        set({
          datasets: get().datasets.map((d) => (d.id === datasetId ? { ...d, examples: [...d.examples, { ...ex, id: uid("ex") }], updatedAt: Date.now() } : d)),
        }),
      updateExample: (datasetId, exId, patch) =>
        set({
          datasets: get().datasets.map((d) =>
            d.id === datasetId
              ? {
                  ...d,
                  updatedAt: Date.now(),
                  examples: d.examples.map((e) => {
                    if (e.id !== exId) return e;
                    const next = { ...e, ...patch };
                    // editing the text detaches it from the built-in oracle
                    if (patch.input !== undefined && patch.input !== e.input) next.transcriptId = undefined;
                    return next;
                  }),
                }
              : d,
          ),
        }),
      removeExample: (datasetId, exId) =>
        set({ datasets: get().datasets.map((d) => (d.id === datasetId ? { ...d, examples: d.examples.filter((e) => e.id !== exId), updatedAt: Date.now() } : d)) }),
      importDataset: (d) => set({ datasets: [...get().datasets.filter((x) => x.id !== d.id), { ...d, builtin: false, updatedAt: Date.now() }] }),
      addFeedback: (ex) => {
        const exists = get().datasets.find((d) => d.id === FEEDBACK_DATASET_ID);
        const example: DatasetExample = { ...ex, id: uid("ex"), source: "feedback" };
        if (exists) {
          set({ datasets: get().datasets.map((d) => (d.id === FEEDBACK_DATASET_ID ? { ...d, examples: [...d.examples, example], updatedAt: Date.now() } : d)) });
        } else {
          const now = Date.now();
          set({
            datasets: [
              ...get().datasets,
              {
                id: FEEDBACK_DATASET_ID,
                name: "Human feedback (from reviews)",
                description: "Examples corrected by a human reviewer in the Transcript Lab. Hard cases like these make the best regression tests.",
                examples: [example],
                createdAt: now,
                updatedAt: now,
              },
            ],
          });
        }
      },
    }),
    { name: "ael-datasets-v1", storage: createJSONStorage(() => localStorage), skipHydration: true },
  ),
);

export function allDatasets(user: Dataset[]): Dataset[] {
  return [...builtinDatasets(), ...user];
}
