"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { WorkflowSpec } from "@/lib/workflows/spec";
import { uid } from "@/lib/utils";

interface SavedWorkflow {
  id: string;
  name: string;
  spec: WorkflowSpec;
  updatedAt: number;
}

interface WorkflowsState {
  /** drafts per context: "free", "ex:<id>", "dbg:<id>", "capstone" */
  drafts: Record<string, WorkflowSpec>;
  saved: SavedWorkflow[];
  setDraft: (key: string, spec: WorkflowSpec) => void;
  clearDraft: (key: string) => void;
  save: (name: string, spec: WorkflowSpec) => string;
  remove: (id: string) => void;
}

export const useWorkflows = create<WorkflowsState>()(
  persist(
    (set, get) => ({
      drafts: {},
      saved: [],
      setDraft: (key, spec) => set({ drafts: { ...get().drafts, [key]: spec } }),
      clearDraft: (key) => {
        const d = { ...get().drafts };
        delete d[key];
        set({ drafts: d });
      },
      save: (name, spec) => {
        const id = uid("wf");
        set({ saved: [{ id, name, spec: { ...spec, name }, updatedAt: Date.now() }, ...get().saved].slice(0, 20) });
        return id;
      },
      remove: (id) => set({ saved: get().saved.filter((s) => s.id !== id) }),
    }),
    { name: "ael-workflows-v2", storage: createJSONStorage(() => localStorage), skipHydration: true },
  ),
);
