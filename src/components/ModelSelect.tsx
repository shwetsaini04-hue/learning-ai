"use client";

import { useEffect, useState } from "react";
import { LIVE_MODELS, SIMULATED_MODELS, compatibleModelInfo } from "@/config/models";
import { fetchServerConfig, type ServerConfig } from "@/lib/ai/client";
import { useSettings } from "@/lib/store/settings";
import { Select } from "./ui";

export function useServerConfig() {
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  useEffect(() => {
    let alive = true;
    fetchServerConfig().then((c) => alive && setCfg(c));
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}

export function useAvailableModels() {
  const mode = useSettings((s) => s.mode);
  const cfg = useServerConfig();
  const live =
    mode === "live" && cfg?.liveEnabled
      ? [
          ...LIVE_MODELS.filter((m) => (m.provider === "anthropic" && cfg.providers.anthropic) || (m.provider === "openai" && cfg.providers.openai)),
          ...(cfg.providers.compatible ? cfg.compatibleModels.map(compatibleModelInfo) : []),
        ]
      : [];
  return { sim: SIMULATED_MODELS, live, mode, cfg };
}

export function ModelSelect({ value, onChange, className, allowLive = true }: { value: string; onChange: (id: string) => void; className?: string; allowLive?: boolean }) {
  const { sim, live, mode } = useAvailableModels();
  const options = [
    ...sim.map((m) => ({ value: m.id, label: m.label, group: "Simulated (free)" })),
    ...(allowLive ? live.map((m) => ({ value: m.id, label: m.label, group: "Live (real API — costs money)" })) : []),
  ];
  if (!options.some((o) => o.value === value)) options.push({ value, label: `${value} (unavailable in ${mode} mode)`, group: "Other" });
  return <Select className={className} value={value} onChange={onChange} options={options} />;
}
