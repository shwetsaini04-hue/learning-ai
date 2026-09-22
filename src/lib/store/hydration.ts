"use client";

import { create } from "zustand";
import { useDatasets } from "./datasets";
import { useExperiments } from "./experiments";
import { useProgress } from "./progress";
import { useSettings } from "./settings";
import { useWorkflows } from "./workflows";

/**
 * All learner data lives in this browser's localStorage (no database, no account).
 * Stores are created with skipHydration so the server-rendered HTML and the first
 * client render match; we rehydrate right after mount.
 */
export const useHydrated = create<{ hydrated: boolean }>(() => ({ hydrated: false }));

let started = false;
export function hydrateAll() {
  if (started) return;
  started = true;
  Promise.all([
    useSettings.persist.rehydrate(),
    useProgress.persist.rehydrate(),
    useDatasets.persist.rehydrate(),
    useExperiments.persist.rehydrate(),
    useWorkflows.persist.rehydrate(),
  ])
    .catch(() => {})
    .finally(() => useHydrated.setState({ hydrated: true }));
}

export const STORAGE_KEYS = ["ael-settings-v1", "ael-progress-v1", "ael-datasets-v1", "ael-experiments-v1", "ael-workflows-v2"];

export function exportAllData() {
  const data: Record<string, unknown> = { exportedAt: new Date().toISOString(), app: "ai-engineering-lab", version: 1 };
  for (const k of STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(k);
      data[k] = raw ? JSON.parse(raw) : null;
    } catch {
      data[k] = null;
    }
  }
  return data;
}

export function importAllData(data: Record<string, unknown>) {
  for (const k of STORAGE_KEYS) {
    if (data[k]) localStorage.setItem(k, JSON.stringify(data[k]));
  }
}
