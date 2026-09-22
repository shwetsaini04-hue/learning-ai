"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Experiment } from "@/lib/eval/runner";

interface ExperimentsState {
  experiments: Experiment[];
  add: (e: Experiment) => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  clear: () => void;
}

const MAX = 25;

export const useExperiments = create<ExperimentsState>()(
  persist(
    (set, get) => ({
      experiments: [],
      add: (e) => set({ experiments: [e, ...get().experiments].slice(0, MAX) }),
      remove: (id) => set({ experiments: get().experiments.filter((x) => x.id !== id) }),
      rename: (id, name) => set({ experiments: get().experiments.map((x) => (x.id === id ? { ...x, name } : x)) }),
      clear: () => set({ experiments: [] }),
    }),
    { name: "ael-experiments-v1", storage: createJSONStorage(() => localStorage), skipHydration: true },
  ),
);
