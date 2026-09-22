"use client";

import { FlaskConical, Sparkles } from "lucide-react";
import { useState } from "react";
import { HBarChart } from "@/components/charts/Charts";
import { JudgeLab } from "@/components/eval/JudgeLab";
import { MetricComparer } from "@/components/eval/MetricComparer";
import { ModelSelect } from "@/components/ModelSelect";
import { TranscriptPicker, TranscriptView } from "@/components/graph/WorkflowRunner";
import { Badge, Button, Callout, Card, Field, PageHeader, Select, Tabs, TextArea } from "@/components/ui";
import { invokeLLM } from "@/lib/ai/client";
import { parseStructured, schemaToTypeString } from "@/lib/ai/schema";
import { getPromptVersion, renderPrompt, TASKS } from "@/lib/ai/tasks";
import { INTENTS, transcriptToText } from "@/lib/domain";
import { DEFAULT_RUBRIC, runJudge, type JudgeResult } from "@/lib/eval/judge";
import { checkGroundedness, exactMatch, normalizedMatch, rougeL, semanticSimilarity, tokenF1 } from "@/lib/eval/similarity";
import { findTranscript } from "@/lib/sim/transcripts";
import { useProgress } from "@/lib/store/progress";
import { cn, freshSeed } from "@/lib/utils";

type Tab = "sandbox" | "metrics" | "judge";

function Sandbox() {
  const [tid, setTid] = useState("t01");
  const t = findTranscript(tid)!;
  const [expectedLabel, setExpectedLabel] = useState<string>(t.labels.intent);
  const [expectedText, setExpectedText] = useState("Customer is interested in a personal loan and wants the rate details by email.");
  const [output, setOutput] = useState('{"intent": "interested", "confidence": 0.88}');
  const [outputText, setOutputText] = useState("The customer wants to know more about getting a personal loan. The agent confirmed a rate of 10.25%.");
  const [genModel, setGenModel] = useState("sim:pico-s");
  const [judgeModel, setJudgeModel] = useState("sim:atlas-l");
  const [judge, setJudge] = useState<JudgeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const bump = useProgress((s) => s.bump);

  const pickTranscript = (id: string) => {
    setTid(id);
    setExpectedLabel(findTranscript(id)!.labels.intent);
    setJudge(null);
  };

  const generate = async () => {
    setBusy(true);
    const text = transcriptToText(t);
    const pv = getPromptVersion("classify_intent", "v2")!;
    const s = getPromptVersion("summarize", "v1")!;
    try {
      const a = await invokeLLM({ model: genModel, system: pv.system, prompt: renderPrompt(pv.user, { transcript: text }), temperature: 0, maxTokens: 256, task: "classify_intent", promptVersion: "v2", sim: { transcript: text, transcriptId: tid } });
      const b = await invokeLLM({ model: genModel, system: s.system, prompt: renderPrompt(s.user, { transcript: text }), temperature: 0.7, maxTokens: 300, task: "summarize", promptVersion: "v1", sim: { transcript: text, transcriptId: tid, runIndex: freshSeed(1000) } });
      setOutput(a.text);
      const ps = parseStructured(b.text, TASKS.summarize.schema);
      setOutputText(ps.ok ? String(ps.value!.summary) : b.text);
      setJudge(null);
    } catch (e) {
      setOutput(`Error: ${(e as Error).message}`);
    }
    setBusy(false);
  };

  const parsed = parseStructured(output, TASKS.classify_intent.schema);
  const predLabel = parsed.ok ? String(parsed.value!.intent) : parsed.value?.intent ? String(parsed.value.intent) : "";
  const ground = checkGroundedness(outputText, transcriptToText(t));
  const sem = semanticSimilarity(expectedText, outputText);
  const tf = tokenF1(expectedText, outputText);

  const runAll = async () => {
    setBusy(true);
    setJudge(await runJudge(judgeModel, { question: "Summarize what the customer wants.", reference: expectedText, answer: outputText, context: transcriptToText(t) }, { ...DEFAULT_RUBRIC, penalizeUnsupported: true }));
    bump("judge_runs", "eval sandbox");
    setBusy(false);
  };

  const rows: { method: string; target: string; score: string; ok: boolean | null; note: string }[] = [
    { method: "Schema validity", target: "label JSON", score: parsed.ok ? "valid" : "invalid", ok: parsed.ok, note: parsed.ok ? "parses and matches the schema" : parsed.error?.message ?? "" },
    { method: "Exact match", target: "label", score: String(exactMatch(expectedLabel, predLabel)), ok: exactMatch(expectedLabel, predLabel) === 1, note: `expected "${expectedLabel}", got "${predLabel || "—"}"` },
    { method: "Normalized match", target: "label", score: String(normalizedMatch(expectedLabel, predLabel)), ok: normalizedMatch(expectedLabel, predLabel) === 1, note: "case / punctuation / synonym tolerant" },
    { method: "Token F1", target: "summary", score: tf.f1.toFixed(2), ok: null, note: `${tf.common.length} shared content words` },
    { method: "ROUGE-L", target: "summary", score: rougeL(expectedText, outputText).toFixed(2), ok: null, note: "longest common subsequence" },
    { method: "Semantic similarity", target: "summary", score: sem.score.toFixed(2), ok: sem.score > 0.6, note: sem.stance.expected && sem.stance.actual && sem.stance.expected !== sem.stance.actual ? "stance differs!" : "meaning-level" },
    {
      method: "Groundedness",
      target: "summary",
      score: `${ground.filter((g) => g.supported).length}/${ground.length} claims`,
      ok: ground.every((g) => g.supported),
      note: ground.filter((g) => !g.supported).map((g) => g.reason).join("; ") || "all claims supported",
    },
    ...(judge ? [{ method: "LLM-as-a-judge", target: "summary", score: judge.score !== null ? `${judge.score}/5` : "invalid", ok: judge.score !== null ? judge.score >= 4 : false, note: judge.reasoning }] : []),
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
      <Card className="flex flex-col gap-3 p-4">
        <Field label="Input (call transcript)">
          <TranscriptPicker value={tid} onChange={pickTranscript} allowCustom={false} />
        </Field>
        <TranscriptView id={tid} showNote={false} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected label">
            <Select value={expectedLabel} onChange={setExpectedLabel} options={INTENTS.map((i) => ({ value: i, label: i }))} />
          </Field>
          <Field label="Generate outputs with">
            <ModelSelect value={genModel} onChange={setGenModel} />
          </Field>
        </div>
        <Field label="Expected summary (reference)">
          <TextArea rows={2} value={expectedText} onChange={(e) => setExpectedText(e.target.value)} />
        </Field>
        <Field label="Model output: label JSON" hint={<code className="font-mono">{schemaToTypeString(TASKS.classify_intent.schema, "").replace(/\n/g, " ")}</code>}>
          <TextArea rows={2} value={output} onChange={(e) => setOutput(e.target.value)} className="font-mono text-xs" />
        </Field>
        <Field label="Model output: summary">
          <TextArea rows={3} value={outputText} onChange={(e) => setOutputText(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={generate} disabled={busy} icon={<Sparkles className="h-4 w-4" />}>
            Generate with model
          </Button>
          <Field label="" className="min-w-[180px]">
            <ModelSelect value={judgeModel} onChange={setJudgeModel} />
          </Field>
          <Button variant="primary" onClick={runAll} disabled={busy} icon={<FlaskConical className="h-4 w-4" />}>
            Add LLM-judge score
          </Button>
        </div>
      </Card>
      <div className="flex flex-col gap-3">
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-ink-3">
              <tr>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">On</th>
                <th className="px-3 py-2">Score</th>
                <th className="hidden px-3 py-2 md:table-cell">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.method}>
                  <td className="px-3 py-2 font-medium text-ink">{r.method}</td>
                  <td className="px-3 py-2 text-xs text-ink-3">{r.target}</td>
                  <td className={cn("px-3 py-2 font-mono text-sm", r.ok === true && "text-good-ink", r.ok === false && "text-bad-ink")}>{r.score}</td>
                  <td className="hidden px-3 py-2 text-xs text-ink-2 md:table-cell">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Summary vs reference, by metric</div>
          <HBarChart
            max={1}
            format={(v) => v.toFixed(2)}
            data={[
              { label: "Token F1", value: tf.f1 },
              { label: "ROUGE-L", value: rougeL(expectedText, outputText) },
              { label: "Semantic", value: sem.score },
              { label: "Groundedness", value: ground.length ? ground.filter((g) => g.supported).length / ground.length : 1 },
              ...(judge?.score ? [{ label: "Judge (÷5)", value: judge.score / 5 }] : []),
            ]}
          />
        </Card>
        <Callout kind="info" title="How to read this">
          Methods disagree because they measure different things. A summary can be similar to the reference yet contain an invented rate (low groundedness), and a label can be semantically
          right but fail exact match on casing. Pick the method that matches the output type and the risk. <Badge>no single score tells the whole story</Badge>
        </Callout>
      </div>
    </div>
  );
}

export function EvalPlayground() {
  const [tab, setTab] = useState<Tab>("sandbox");
  return (
    <div>
      <PageHeader eyebrow="Evaluation Playground" title="One example, every evaluation method">
        Give an input, an expected output and a model output — then evaluate it with deterministic checks, similarity metrics, groundedness and an LLM judge, side by side.
      </PageHeader>
      <Tabs
        tabs={[
          { id: "sandbox", label: "Sandbox" },
          { id: "metrics", label: "Exact vs semantic" },
          { id: "judge", label: "LLM-as-a-judge" },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-4"
      />
      {tab === "sandbox" && <Sandbox />}
      {tab === "metrics" && <MetricComparer />}
      {tab === "judge" && <JudgeLab />}
    </div>
  );
}
