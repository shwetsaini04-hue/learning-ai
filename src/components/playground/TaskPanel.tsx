"use client";

import { Bug, Eye, Lightbulb, RotateCcw, ShieldCheck, Target } from "lucide-react";
import { useState } from "react";
import { CheckList } from "@/components/learn/Learn";
import { Code } from "@/components/learn/CodeBlock";
import { Badge, Button, Callout, Spinner } from "@/components/ui";
import type { DebugChallenge } from "@/content/debugChallenges";
import { CHECKERS, type CheckResult, type ExerciseDef } from "@/content/exercises";
import { useProgress } from "@/lib/store/progress";
import { cn } from "@/lib/utils";
import type { WorkflowSpec } from "@/lib/workflows/spec";

export function ExerciseTask({ ex, spec, onReset }: { ex: ExerciseDef; spec: WorkflowSpec; onReset: () => void }) {
  const [hints, setHints] = useState(0);
  const [sol, setSol] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const rec = useProgress((s) => s.exercises[ex.id]);
  const { exerciseAttempt, exerciseHint, exerciseSolution, completeExercise } = useProgress.getState();
  const check = async () => {
    setBusy(true);
    exerciseAttempt(ex.id);
    try {
      const r = await CHECKERS[ex.id](spec);
      setResult(r);
      if (r.passed) completeExercise(ex.id);
    } catch (e) {
      setResult({ passed: false, checks: [{ label: `Checker error: ${(e as Error).message}`, ok: false }] });
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-accent" />
        <span className="font-semibold text-ink">{ex.title}</span>
        {rec?.status === "completed" && <Badge tone="good">✓ completed</Badge>}
      </div>
      <p className="text-ink-2">{ex.problem}</p>
      {ex.input && (
        <div className="text-xs text-ink-2">
          <strong className="text-ink">Input:</strong> {ex.input}
        </div>
      )}
      <div className="text-xs text-ink-2">
        <strong className="text-ink">Expected:</strong> {ex.expected}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={check} disabled={busy} icon={busy ? <Spinner /> : <ShieldCheck className="h-3.5 w-3.5" />}>
          Check my graph
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset} icon={<RotateCcw className="h-3.5 w-3.5" />}>
          Reset to starter
        </Button>
      </div>
      {result && <CheckList result={result} />}
      {hints > 0 &&
        ex.hints.slice(0, hints).map((h, i) => (
          <div key={i} className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-ink-2">
            <Lightbulb className="h-3.5 w-3.5 shrink-0 text-warn-ink" />
            {h}
          </div>
        ))}
      <div className="flex flex-wrap gap-2 border-t border-line pt-2">
        {hints < ex.hints.length && (
          <Button size="sm" variant="ghost" icon={<Lightbulb className="h-3.5 w-3.5" />} onClick={() => { setHints(hints + 1); exerciseHint(ex.id); }}>
            Hint ({ex.hints.length - hints} left)
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => { setSol(!sol); if (!sol) exerciseSolution(ex.id); }}>
          {sol ? "Hide solution" : "Reveal solution"}
        </Button>
      </div>
      {sol && (
        <div className="flex flex-col gap-2">
          <div className="overflow-hidden rounded-lg border border-line">
            <Code code={ex.solution} language="python" />
          </div>
          <Callout kind="info">{ex.explanation}</Callout>
        </div>
      )}
    </div>
  );
}

export function ChallengeTask({ c, spec, onReset }: { c: DebugChallenge; spec: WorkflowSpec; onReset: () => void }) {
  const [pick, setPick] = useState<number | null>(null);
  const [hint, setHint] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const rec = useProgress((s) => s.challenges[c.id]);
  const { challengeDiagnosed, challengeFixed } = useProgress.getState();
  const verify = async () => {
    setBusy(true);
    try {
      const r = await c.verify(spec);
      setResult(r);
      if (r.passed) challengeFixed(c.id);
    } catch (e) {
      setResult({ passed: false, checks: [{ label: `Verifier error: ${(e as Error).message}`, ok: false }] });
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-2">
        <Bug className="h-4 w-4 text-bad-ink" />
        <span className="font-semibold text-ink">{c.title}</span>
        <Badge>{c.category}</Badge>
        {rec?.fixed && <Badge tone="good">✓ fixed</Badge>}
      </div>
      <Callout kind="danger" title="Symptom">
        {c.symptom}
      </Callout>
      <div className="text-xs text-ink-2">
        <strong className="text-ink">1. Reproduce:</strong> run the graph on <span className="font-mono">{c.testTranscript}</span> and inspect the trace.
      </div>
      <div>
        <div className="mb-1.5 text-xs text-ink-2">
          <strong className="text-ink">2. Diagnose:</strong> {c.diagnosis.question}
        </div>
        <div className="flex flex-col gap-1.5">
          {c.diagnosis.options.map((o, i) => (
            <button
              key={i}
              onClick={() => {
                setPick(i);
                if (o.correct) challengeDiagnosed(c.id);
              }}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-left text-xs",
                pick === i ? (o.correct ? "border-good bg-good-soft" : "border-bad bg-bad-soft") : "border-line hover:border-line-strong",
              )}
            >
              {o.text}
              {pick === i && <span className="mt-0.5 block text-ink-2">{o.why}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="text-xs text-ink-2">
        <strong className="text-ink">3. Fix</strong> the graph in the canvas{" "}
        {!hint ? (
          <button className="text-accent underline" onClick={() => setHint(true)}>
            (show fix hint)
          </button>
        ) : (
          <span className="text-ink-2">— {c.fixHint}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={verify} disabled={busy} icon={busy ? <Spinner /> : <ShieldCheck className="h-3.5 w-3.5" />}>
          4. Verify fix
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset} icon={<RotateCcw className="h-3.5 w-3.5" />}>
          Reset broken version
        </Button>
      </div>
      {result && <CheckList result={result} />}
      {result?.passed && <Callout kind="success" title="Lesson">{c.lesson}</Callout>}
    </div>
  );
}
