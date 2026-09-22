"use client";

import { Download, KeyRound, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PricingTable } from "@/components/labs/PricingTable";
import { Badge, Button, Callout, Card, CardHeader, Field, Input, PageHeader, Segmented, Slider } from "@/components/ui";
import { fetchServerConfig, type ServerConfig } from "@/lib/ai/client";
import { exportAllData, importAllData, STORAGE_KEYS, useHydrated } from "@/lib/store/hydration";
import { useSettings } from "@/lib/store/settings";
import { download, fmtUsd } from "@/lib/utils";

export function Settings() {
  const hydrated = useHydrated((s) => s.hydrated);
  const s = useSettings();
  const [cfg, setCfg] = useState<ServerConfig | null | undefined>(undefined);
  const [tokenDraft, setToken] = useState<string | null>(null);
  const token = tokenDraft ?? (hydrated ? s.labToken : "");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fetchServerConfig(true).then(setCfg);
  }, []);

  const liveAvailable = !!cfg?.liveEnabled;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Settings" title="Settings & your data">
        Everything you do here is stored in <strong>this browser only</strong> (localStorage): progress, datasets, experiments, saved workflows and settings. No account, no database.
      </PageHeader>

      <Card>
        <CardHeader title="Execution mode" subtitle="Where model calls go" />
        <div className="flex flex-col gap-3 px-4 pb-4">
          <Segmented
            value={hydrated ? s.mode : "simulation"}
            onChange={(m) => s.setMode(m)}
            options={[
              { id: "simulation", label: "Simulation (free, deterministic)" },
              { id: "live", label: "Live (real API calls)" },
            ]}
          />
          {hydrated && s.mode === "simulation" && (
            <Callout kind="info">
              Simulated models (Atlas-L, Swift-M, Pico-S, Sage-R) model realistic behaviour — accuracy vs difficulty, format failures, calibration, latency tails, token costs — without any API key.
              Every lab and lesson works in this mode.
            </Callout>
          )}
          {hydrated && s.mode === "live" && (
            <Callout kind={liveAvailable ? "warn" : "danger"} title={liveAvailable ? "Live mode: real calls cost real money" : "Live mode isn't available on this deployment"}>
              {liveAvailable ? (
                <>Live models appear in every model picker. Calls go through this site&apos;s server (<code>/api/llm</code>), which holds the API keys; your browser never sees them.</>
              ) : (
                <>
                  The server has no provider keys configured (or <code>LIVE_LLM_ENABLED=false</code>). Add <code>ANTHROPIC_API_KEY</code> and/or <code>OPENAI_API_KEY</code> to the server environment (see
                  README), then reload.
                </>
              )}
            </Callout>
          )}
          <div className="grid gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-lg border border-line p-2.5">
              <div className="text-ink-3">Server live mode</div>
              <div className="mt-0.5 font-semibold text-ink">{cfg === undefined ? "checking…" : cfg === null ? "unreachable" : cfg.liveEnabled ? "enabled" : "disabled"}</div>
            </div>
            {(["anthropic", "openai", "compatible"] as const).map((p) => (
              <div key={p} className="rounded-lg border border-line p-2.5">
                <div className="text-ink-3">{p === "compatible" ? "OpenAI-compatible" : p === "anthropic" ? "Anthropic" : "OpenAI"}</div>
                <div className="mt-0.5">{cfg?.providers[p] ? <Badge tone="good">key configured</Badge> : <Badge>not configured</Badge>}</div>
              </div>
            ))}
          </div>
          {cfg && (
            <div className="text-xs text-ink-3">
              Server limits: max input {cfg.limits.maxInputChars.toLocaleString()} chars · max output {cfg.limits.maxOutputTokens} tokens · {cfg.limits.ratePerMinute} requests/min per IP ·{" "}
              {cfg.limits.dailyRequests} requests/day per instance.
            </div>
          )}
          <Button size="sm" variant="ghost" className="self-start" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => fetchServerConfig(true).then(setCfg)}>
            Re-check server
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Access & cost guards (live mode)" icon={<KeyRound className="h-4 w-4 text-ink-3" />} />
        <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
          <Field label="Lab access token" hint={cfg?.requiresToken ? <Badge tone="warn">required by this server</Badge> : "optional"}>
            <div className="flex gap-2">
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Set by LAB_ACCESS_TOKEN on the server" autoComplete="off" />
              <Button onClick={() => s.setLabToken(token)}>Save</Button>
            </div>
          </Field>
          <div className="text-xs text-ink-3">
            If you deploy this lab publicly with API keys, set <code>LAB_ACCESS_TOKEN</code> so strangers can&apos;t spend your credits. The token is sent as a header to your own server only.
          </div>
          <Slider label="Browser spend budget (stops live calls when reached)" value={hydrated ? s.budgetUsd : 2} onChange={s.setBudget} min={0.1} max={50} step={0.1} format={(v) => `$${v.toFixed(2)}`} />
          <div className="flex items-end gap-3">
            <div className="text-sm">
              <div className="text-xs text-ink-3">Estimated live spend so far</div>
              <div className="font-mono text-lg font-semibold text-ink">{hydrated ? fmtUsd(s.liveSpendUsd, { precise: true }) : "—"}</div>
              <div className="text-xs text-ink-3">{hydrated ? s.liveCalls : 0} calls</div>
            </div>
            <Button size="sm" variant="ghost" onClick={s.resetSpend}>
              Reset counter
            </Button>
          </div>
          <Slider label="Max examples per live experiment" value={hydrated ? s.maxLiveExamples : 40} onChange={s.setMaxLiveExamples} min={5} max={200} step={5} format={(v) => String(v)} />
          <Slider label="Workflow animation speed" value={hydrated ? s.animationSpeed : 1} onChange={s.setAnimationSpeed} min={0.25} max={4} step={0.25} format={(v) => `${v}×`} />
        </div>
      </Card>

      <PricingTable />

      <Card>
        <CardHeader title="Your data" subtitle={`Stored under: ${STORAGE_KEYS.join(", ")}`} />
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          <Button icon={<Download className="h-4 w-4" />} onClick={() => download(`ai-engineering-lab-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportAllData(), null, 2))}>
            Export everything
          </Button>
          <Button icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
            Import backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              f.text().then((t) => {
                try {
                  const data = JSON.parse(t);
                  if (data.app !== "ai-engineering-lab") throw new Error("Not a backup from this app");
                  importAllData(data);
                  location.reload();
                } catch (err) {
                  alert((err as Error).message);
                }
              });
            }}
          />
          <Button
            variant="danger"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => {
              if (confirm("Delete ALL progress, datasets, experiments, workflows and settings stored in this browser? Export a backup first if you want to keep them.")) {
                STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
                location.reload();
              }
            }}
          >
            Reset everything
          </Button>
        </div>
      </Card>
    </div>
  );
}
