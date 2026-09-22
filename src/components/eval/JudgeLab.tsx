"use client";

import { Gavel, Repeat } from "lucide-react";
import { useState } from "react";
import { ModelSelect } from "@/components/ModelSelect";
import { JsonBlock } from "@/components/learn/JsonView";
import { Badge, Button, Callout, Card, Collapsible, Field, Input, Slider, Stat, TextArea, Toggle } from "@/components/ui";
import { transcriptToText } from "@/lib/domain";
import { DEFAULT_RUBRIC, JUDGE_QUESTION, JUDGE_REFERENCE, runJudge, type JudgeResult, type Rubric } from "@/lib/eval/judge";
import { findTranscript } from "@/lib/sim/transcripts";
import { useProgress } from "@/lib/store/progress";
import { fmtMs, fmtUsd, mean } from "@/lib/utils";

export function RubricEditor({ rubric, onChange }: { rubric: Rubric; onChange: (r: Rubric) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Rubric</div>
      {rubric.levels
        .map((l, i) => ({ l, i }))
        .reverse()
        .map(({ l, i }) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-14 shrink-0 font-mono text-xs text-ink-2">Score {i + 1}</span>
            <Input
              value={l}
              onChange={(e) => {
                const levels = [...rubric.levels];
                levels[i] = e.target.value;
                onChange({ ...rubric, levels });
              }}
              className="h-8 text-xs"
            />
          </div>
        ))}
      <Toggle checked={rubric.requireLabelMatch} onChange={(v) => onChange({ ...rubric, requireLabelMatch: v })} label={<span className="text-xs">Must state the correct label explicitly (else ≤ 2)</span>} />
      <Toggle checked={rubric.penalizeUnsupported} onChange={(v) => onChange({ ...rubric, penalizeUnsupported: v })} label={<span className="text-xs">Penalize claims not supported by the transcript</span>} />
      <Slider label="Strictness" value={rubric.strictness} onChange={(v) => onChange({ ...rubric, strictness: v })} min={0} max={1} step={0.1} format={(v) => v.toFixed(1)} />
    </div>
  );
}

export function JudgeLab() {
  const [question, setQuestion] = useState(JUDGE_QUESTION);
  const [reference, setReference] = useState(JUDGE_REFERENCE);
  const [answer, setAnswer] = useState("The customer appears interested but wants more information before deciding.");
  const [useContext, setUseContext] = useState(true);
  const [rubric, setRubric] = useState<Rubric>(DEFAULT_RUBRIC);
  const [model, setModel] = useState("sim:atlas-l");
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [repeat, setRepeat] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const bump = useProgress((s) => s.bump);
  const context = transcriptToText(findTranscript("t01")!);
  const input = { question, reference, answer, context: useContext ? context : undefined };

  const judge = async () => {
    setBusy(true);
    setRepeat([]);
    setResult(await runJudge(model, input, rubric));
    bump("judge_runs", `judge ${model}`);
    setBusy(false);
  };
  const judge5 = async () => {
    setBusy(true);
    const scores: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await runJudge(model, input, rubric, { runIndex: i + 1, temperature: 0.7 });
      if (r.score !== null) scores.push(r.score);
      if (i === 0) setResult(r);
    }
    setRepeat(scores);
    bump("judge_runs", `judge ×5 ${model}`);
    setBusy(false);
  };

  return (
    <Card className="my-6 p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Field label="Question">
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} />
          </Field>
          <Field label="Reference answer">
            <TextArea rows={2} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Model answer (to be graded)">
            <TextArea rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </Field>
          <Toggle checked={useContext} onChange={setUseContext} label={<span className="text-xs">Give the judge the transcript (t01) as context</span>} />
        </div>
        <div className="flex flex-col gap-3">
          <RubricEditor rubric={rubric} onChange={setRubric} />
          <Field label="Judge model">
            <ModelSelect value={model} onChange={setModel} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={judge} disabled={busy} icon={<Gavel className="h-4 w-4" />}>
              Run judge
            </Button>
            <Button onClick={judge5} disabled={busy} icon={<Repeat className="h-4 w-4" />}>
              Run 5× (judge consistency)
            </Button>
          </div>
        </div>
      </div>
      {result && (
        <div className="fade-in mt-4 flex flex-col gap-3 border-t border-line pt-4">
          {result.error ? (
            <Callout kind="danger" title="Judge call failed">
              {result.error}
            </Callout>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Score" value={result.score !== null ? `${result.score} / 5` : "invalid"} tone={result.score === null ? "bad" : result.score >= 4 ? "good" : result.score <= 2 ? "bad" : "warn"} />
                <Stat label="Judge model" value={result.model.replace("sim:", "")} sub={result.res?.simulated ? "simulated" : "live"} />
                <Stat label="Latency · cost" value={result.res ? fmtMs(result.res.latencyMs) : "—"} sub={result.res ? fmtUsd(result.res.costUsd, { precise: true }) : undefined} />
                <Stat
                  label="Confidence"
                  value={repeat.length ? `${Math.round((repeat.filter((s) => s === Math.round(mean(repeat))).length / repeat.length) * 100)}% agree` : "—"}
                  sub={repeat.length ? `scores: ${repeat.join(", ")}` : "run 5× to estimate"}
                />
              </div>
              <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
                <strong className="text-ink">Reasoning:</strong> {result.reasoning}
              </div>
              <Collapsible title={<span className="text-xs">Evaluation prompt that was sent</span>}>
                <JsonBlock value={`[system] ${result.system}\n\n[user] ${result.prompt}`} maxHeight={320} />
                <div className="mt-2 text-xs text-ink-3">Raw judge output:</div>
                <JsonBlock value={result.raw} />
              </Collapsible>
            </>
          )}
          <Callout kind="warn" title="The judge is a model too">
            It can be biased (longer answers, first position, its own style), inconsistent across runs, and wrong. Treat judge scores as a measurement instrument you must calibrate against
            human labels. <Badge tone="neutral">see the calibration exercise</Badge>
          </Callout>
        </div>
      )}
    </Card>
  );
}
