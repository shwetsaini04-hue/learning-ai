"use client";

import { RotateCcw } from "lucide-react";
import { LastVerified } from "@/components/learn/CodeBlock";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { ALL_MODELS, PRICING_LAST_VERIFIED, type Pricing } from "@/config/models";
import { getPricing } from "@/lib/ai/pricing";
import { useHydrated } from "@/lib/store/hydration";
import { useSettings } from "@/lib/store/settings";

/** Editable price table. Overrides are stored in this browser and used everywhere. */
export function PricingTable() {
  const overrides = useSettings((s) => s.pricingOverrides);
  const setOverride = useSettings((s) => s.setPricingOverride);
  const hydrated = useHydrated((s) => s.hydrated);
  const cell = (id: string, key: keyof Pricing) => {
    const v = getPricing(id)[key];
    const overridden = hydrated && overrides[id]?.[key] !== undefined;
    return (
      <input
        type="number"
        step="0.005"
        min={0}
        value={v ?? ""}
        onChange={(e) => setOverride(id, { [key]: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })}
        className={`h-7 w-20 rounded-md border bg-surface px-1.5 text-right font-mono text-xs text-ink outline-none focus:border-accent ${overridden ? "border-warn" : "border-line"}`}
        aria-label={`${id} ${key}`}
      />
    );
  };
  return (
    <Card className="overflow-x-auto">
      <CardHeader title="Model price table (USD per 1M tokens)" subtitle="Edit any price — changes apply across the whole lab and are saved in this browser." right={<LastVerified date={PRICING_LAST_VERIFIED} />} />
      <table className="mx-4 mb-4 w-[calc(100%-2rem)] min-w-[640px] text-xs">
        <thead className="text-left text-[10.5px] uppercase tracking-wide text-ink-3">
          <tr className="border-b border-line">
            <th className="py-1.5">Model</th>
            <th className="py-1.5">Provider</th>
            <th className="py-1.5 text-right">Input</th>
            <th className="py-1.5 text-right">Cached input</th>
            <th className="py-1.5 text-right">Output</th>
            <th className="py-1.5" />
          </tr>
        </thead>
        <tbody>
          {ALL_MODELS.map((m) => (
            <tr key={m.id} className="border-b border-line/60">
              <td className="py-1.5 pr-2">
                <div className="font-medium text-ink">{m.label}</div>
                <a href={m.source.startsWith("http") ? m.source : undefined} target="_blank" rel="noreferrer" className="text-[10.5px] text-ink-3 hover:text-accent">
                  {m.source.startsWith("http") ? "provider pricing page ↗" : m.source}
                </a>
              </td>
              <td className="py-1.5">
                <Badge tone={m.provider === "simulated" ? "neutral" : "accent"}>{m.provider}</Badge>
              </td>
              <td className="py-1.5 text-right">{cell(m.id, "inputPer1M")}</td>
              <td className="py-1.5 text-right">{cell(m.id, "cachedInputPer1M")}</td>
              <td className="py-1.5 text-right">{cell(m.id, "outputPer1M")}</td>
              <td className="py-1.5 text-right">
                {hydrated && overrides[m.id] && (
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3 w-3" />} onClick={() => setOverride(m.id, null)}>
                    reset
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
