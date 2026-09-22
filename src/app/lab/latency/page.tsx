import type { Metadata } from "next";
import { LatencySim } from "@/components/labs/LatencySim";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Latency Lab" };

export default function Page() {
  return (
    <div>
      <PageHeader eyebrow="Latency lab" title="Why workflow architecture changes latency">
        Every LLM call = network + time-to-first-token (reading the prompt, reasoning) + generation (output tokens ÷ speed). Sequential steps add up; parallel steps cost the slowest branch;
        one merged call saves round trips but generates a longer output. Latency is heavy-tailed, so compare P95, not averages.
      </PageHeader>
      <LatencySim />
      <div className="grid gap-3 md:grid-cols-3">
        {[
          ["Time to first token (TTFT)", "Grows with prompt length and reasoning. What users feel first in streaming UIs."],
          ["Generation time", "Output tokens ÷ tokens/sec. Short structured outputs are fast; long summaries aren't."],
          ["Network & queueing", "Per call overhead. Many small sequential calls pay it many times."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl border border-line bg-surface p-3">
            <div className="text-sm font-semibold text-ink">{t}</div>
            <div className="mt-1 text-xs text-ink-2">{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
