"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_SIM_MODEL, type Pricing } from "@/config/models";
import { setPricingOverrides } from "@/lib/ai/pricing";

export type Mode = "simulation" | "live";

export interface SettingsState {
  mode: Mode;
  defaultModel: string;
  pricingOverrides: Record<string, Partial<Pricing>>;
  labToken: string;
  /** animation speed multiplier for workflow runs */
  animationSpeed: number;
  /** stop live calls after this much estimated spend in this browser (USD) */
  budgetUsd: number;
  liveSpendUsd: number;
  liveCalls: number;
  /** ask for confirmation before a batch experiment estimated above this (USD) */
  confirmAboveUsd: number;
  /** max examples in a live dataset run */
  maxLiveExamples: number;
  setMode: (m: Mode) => void;
  setDefaultModel: (id: string) => void;
  setPricingOverride: (modelId: string, p: Partial<Pricing> | null) => void;
  setLabToken: (t: string) => void;
  setAnimationSpeed: (n: number) => void;
  setBudget: (n: number) => void;
  setConfirmAbove: (n: number) => void;
  setMaxLiveExamples: (n: number) => void;
  addLiveSpend: (usd: number) => void;
  resetSpend: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      mode: "simulation",
      defaultModel: DEFAULT_SIM_MODEL,
      pricingOverrides: {},
      labToken: "",
      animationSpeed: 1,
      budgetUsd: 2,
      liveSpendUsd: 0,
      liveCalls: 0,
      confirmAboveUsd: 0.05,
      maxLiveExamples: 40,
      setMode: (mode) => set({ mode }),
      setDefaultModel: (defaultModel) => set({ defaultModel }),
      setPricingOverride: (modelId, p) => {
        const next = { ...get().pricingOverrides };
        if (p === null) delete next[modelId];
        else next[modelId] = { ...(next[modelId] ?? {}), ...p };
        setPricingOverrides(next);
        set({ pricingOverrides: next });
      },
      setLabToken: (labToken) => set({ labToken }),
      setAnimationSpeed: (animationSpeed) => set({ animationSpeed }),
      setBudget: (budgetUsd) => set({ budgetUsd }),
      setConfirmAbove: (confirmAboveUsd) => set({ confirmAboveUsd }),
      setMaxLiveExamples: (maxLiveExamples) => set({ maxLiveExamples }),
      addLiveSpend: (usd) => set({ liveSpendUsd: get().liveSpendUsd + usd, liveCalls: get().liveCalls + 1 }),
      resetSpend: () => set({ liveSpendUsd: 0, liveCalls: 0 }),
    }),
    {
      name: "ael-settings-v1",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state) setPricingOverrides(state.pricingOverrides);
      },
    },
  ),
);
