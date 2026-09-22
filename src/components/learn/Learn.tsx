"use client";

import { ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, Eye, FlaskConical, HelpCircle, Lightbulb, Target, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Callout, Card, TextArea } from "@/components/ui";
import type { QuizQuestion } from "@/content/assessments";
import { getLesson, getModule, lessonNeighbors } from "@/content/curriculum";
import { getExercise, staticCodeCheck, type CheckResult } from "@/content/exercises";
import { findTerm } from "@/content/glossary";
import { useHydrated } from "@/lib/store/hydration";
import { useProgress } from "@/lib/store/progress";
import { cn } from "@/lib/utils";
import { CodeBlock, Code } from "./CodeBlock";

// ---------------------------------------------------------------- WhyCard
export function WhyCard({
  what,
  why,
  when,
  whenNot,
  how,
  real,
}: {
  what: ReactNode;
  why: ReactNode;
  when: ReactNode;
  whenNot: ReactNode;
  how?: ReactNode;
  real: ReactNode;
}) {
  const items: [string, ReactNode, string][] = [
    ["What is it?", what, "text-accent"],
    ["Why does it exist?", why, "text-accent"],
    ["When do I use it?", when, "text-good-ink"],
    ["When should I NOT use it?", whenNot, "text-bad-ink"],
    ...(how ? ([["How does it work?", how, "text-accent"]] as [string, ReactNode, string][]) : []),
    ["In a real application", real, "text-warn-ink"],
  ];
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
      {items.map(([title, body, color]) => (
        <div key={title} className="bg-surface px-4 py-3">
          <div className={cn("mb-1 text-[11px] font-semibold uppercase tracking-wider", color)}>{title}</div>
          <div className="text-sm leading-relaxed text-ink-2 [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-ink">{body}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Term (glossary tooltip)
export function Term({ children, t }: { children: ReactNode; t?: string }) {
  const name = t ?? (typeof children === "string" ? children : "");
  const entry = findTerm(name);
  const [open, setOpen] = useState(false);
  if (!entry) return <>{children}</>;
  return (
    <span className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="cursor-help border-b border-dotted border-accent text-ink decoration-0"
        aria-expanded={open}
      >
        {children}
      </button>
      {open && (
        <span className="fade-in absolute left-0 top-full z-40 mt-1.5 block w-72 rounded-lg border border-line bg-surface p-3 text-left text-xs leading-relaxed shadow-xl">
          <span className="mb-1 block text-sm font-semibold text-ink">{entry.term}</span>
          <span className="block text-ink-2">{entry.definition}</span>
          <span className="mt-1.5 block text-ink-3">
            <strong className="text-ink-2">Why it matters:</strong> {entry.why}
          </span>
          <Link href={`/glossary?q=${encodeURIComponent(entry.term)}`} className="mt-1.5 block font-medium text-accent">
            Open in glossary →
          </Link>
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- Quiz
function QuestionCard({ q, index, onAnswered, answered }: { q: QuizQuestion; index: number; onAnswered: (correct: boolean, picks: number[]) => void; answered?: number[] }) {
  const [picks, setPicks] = useState<number[]>(answered ?? []);
  const [submitted, setSubmitted] = useState(!!answered);
  const correctSet = q.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
  const isCorrect = submitted && picks.length === correctSet.length && picks.every((p) => correctSet.includes(p));
  const toggle = (i: number) => {
    if (submitted) return;
    if (q.multi) setPicks((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));
    else setPicks([i]);
  };
  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-ink-3">
        <span>Question {index + 1}</span>
        {q.multi && <Badge tone="accent">select all that apply</Badge>}
        {submitted && (isCorrect ? <Badge tone="good">correct</Badge> : <Badge tone="bad">not quite</Badge>)}
      </div>
      <div className="mb-2 rounded-lg border-l-2 border-accent bg-surface-2 px-3 py-2 text-sm text-ink-2">{q.scenario}</div>
      <div className="mb-3 text-sm font-semibold text-ink">{q.question}</div>
      <div className="flex flex-col gap-2">
        {q.options.map((o, i) => {
          const picked = picks.includes(i);
          const show = submitted && (picked || o.correct);
          return (
            <button
              key={i}
              onClick={() => toggle(i)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                !submitted && (picked ? "border-accent bg-accent-soft text-ink" : "border-line hover:border-line-strong text-ink-2"),
                submitted && o.correct && "border-good bg-good-soft text-ink",
                submitted && picked && !o.correct && "border-bad bg-bad-soft text-ink",
                submitted && !picked && !o.correct && "border-line text-ink-3",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  {submitted ? o.correct ? <Check className="h-4 w-4 text-good-ink" /> : picked ? <X className="h-4 w-4 text-bad-ink" /> : <Circle className="h-4 w-4 opacity-30" /> : picked ? <CheckCircle2 className="h-4 w-4 text-accent" /> : <Circle className="h-4 w-4 text-ink-3" />}
                </span>
                <span>
                  {o.text}
                  {show && <span className="mt-1 block text-xs text-ink-2">{o.why}</span>}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {!submitted ? (
        <div className="mt-3 flex justify-end">
          <Button
            variant="primary"
            size="sm"
            disabled={!picks.length}
            onClick={() => {
              setSubmitted(true);
              const ok = picks.length === correctSet.length && picks.every((p) => correctSet.includes(p));
              onAnswered(ok, picks);
            }}
          >
            Check answer
          </Button>
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
          <span className="font-semibold text-ink">Takeaway: </span>
          {q.takeaway}
        </div>
      )}
    </Card>
  );
}

export function Quiz({ id, questions, onComplete }: { id: string; questions: QuizQuestion[]; onComplete?: (score: number) => void }) {
  const recordQuiz = useProgress((s) => s.recordQuiz);
  const prev = useProgress((s) => s.quizzes[id]);
  const [results, setResults] = useState<Record<string, { ok: boolean; picks: number[] }>>({});
  const [attempt, setAttempt] = useState(0);
  const done = Object.keys(results).length === questions.length;
  const score = Object.values(results).filter((r) => r.ok).length;
  const recorded = useRef(false);
  useEffect(() => {
    if (done && !recorded.current) {
      recorded.current = true;
      recordQuiz(id, { answers: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.picks])), score, total: questions.length });
      onComplete?.(score);
    }
  }, [done, id, questions.length, recordQuiz, results, score, onComplete]);
  return (
    <div className="flex flex-col gap-4" key={attempt}>
      {prev && !done && (
        <Callout kind="success" title={`Best score so far: ${prev.score}/${prev.total}`}>
          You can retake the assessment any time — only your best score is kept.
        </Callout>
      )}
      {questions.map((q, i) => (
        <QuestionCard key={`${attempt}-${q.id}`} q={q} index={i} onAnswered={(ok, picks) => setResults((r) => ({ ...r, [q.id]: { ok, picks } }))} />
      ))}
      {done && (
        <Card className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">
              Score: {score}/{questions.length}
            </div>
            <div className="text-xs text-ink-3">{score === questions.length ? "Excellent engineering judgment." : "Review the explanations above — the takeaways are what matter."}</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setResults({});
              recorded.current = false;
              setAttempt((a) => a + 1);
            }}
          >
            Retake
          </Button>
        </Card>
      )}
    </div>
  );
}

/** A single ungraded knowledge check inside a lesson. */
export function QuickCheck({ q }: { q: QuizQuestion }) {
  return (
    <div className="my-6">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
        <HelpCircle className="h-3.5 w-3.5" /> Quick check
      </div>
      <QuestionCard q={q} index={0} onAnswered={() => {}} />
    </div>
  );
}

// ---------------------------------------------------------------- Exercise
export function Exercise({ id, children }: { id: string; children?: ReactNode }) {
  const ex = getExercise(id);
  const progress = useProgress((s) => s.exercises[id]);
  const hydrated = useHydrated((s) => s.hydrated);
  const { exerciseAttempt, exerciseHint, exerciseSolution, completeExercise } = useProgress.getState();
  const [hints, setHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [code, setCode] = useState(ex?.starterCode ?? "");
  const [codeResult, setCodeResult] = useState<CheckResult | null>(null);
  const [nums, setNums] = useState<string[]>(ex?.numeric?.map(() => "") ?? []);
  const [numResult, setNumResult] = useState<boolean[] | null>(null);
  if (!ex) return null;
  const completed = hydrated && progress?.status === "completed";

  return (
    <Card className="my-8 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold text-ink">Exercise: {ex.title}</span>
          <Badge>{"●".repeat(ex.difficulty)}{"○".repeat(3 - ex.difficulty)}</Badge>
          <Badge tone="neutral">{ex.kind === "playground" ? "build in playground" : ex.kind === "code" ? "write code" : ex.kind === "numeric" ? "calculate" : "hands-on"}</Badge>
        </div>
        {completed ? <Badge tone="good">✓ completed</Badge> : progress ? <Badge tone="warn">in progress</Badge> : null}
      </div>
      <div className="flex flex-col gap-3 px-4 py-4 text-sm">
        <p className="leading-relaxed text-ink">{ex.problem}</p>
        {ex.input && (
          <div className="text-ink-2">
            <span className="font-semibold text-ink">Input: </span>
            {ex.input}
          </div>
        )}
        <div className="text-ink-2">
          <span className="font-semibold text-ink">Expected behaviour: </span>
          {ex.expected}
        </div>

        {ex.kind === "playground" && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/lab/playground?exercise=${ex.id}`} onClick={() => exerciseAttempt(ex.id)}>
              <Button variant="primary" icon={<Wrench className="h-4 w-4" />}>
                Open in Workflow Playground
              </Button>
            </Link>
            <span className="text-xs text-ink-3">The playground checks your graph automatically.</span>
          </div>
        )}

        {ex.kind === "code" && (
          <div className="flex flex-col gap-2">
            <TextArea
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                exerciseAttempt(ex.id);
              }}
              spellCheck={false}
              rows={12}
              className="bg-code font-mono text-[12.5px] leading-relaxed"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const r = staticCodeCheck(code, ex);
                  setCodeResult(r);
                  if (r.passed) completeExercise(ex.id);
                }}
              >
                Check my code
              </Button>
              <span className="text-xs text-ink-3">Static checker: required constructs + legacy-API warnings. It doesn&apos;t execute Python.</span>
            </div>
            {codeResult && <CheckList result={codeResult} />}
          </div>
        )}

        {ex.kind === "numeric" && ex.numeric && (
          <div className="flex flex-col gap-2">
            <div className="grid gap-2 sm:grid-cols-3">
              {ex.numeric.map((f, i) => (
                <label key={f.label} className="text-xs font-medium text-ink-2">
                  {f.label} {f.unit && <span className="text-ink-3">({f.unit})</span>}
                  <input
                    className={cn(
                      "mt-1 h-9 w-full rounded-lg border bg-surface px-2.5 font-mono text-sm text-ink outline-none focus:border-accent",
                      numResult ? (numResult[i] ? "border-good" : "border-bad") : "border-line",
                    )}
                    inputMode="decimal"
                    value={nums[i]}
                    onChange={(e) => {
                      const next = [...nums];
                      next[i] = e.target.value;
                      setNums(next);
                      exerciseAttempt(ex.id);
                    }}
                  />
                </label>
              ))}
            </div>
            <div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const r = ex.numeric!.map((f, i) => {
                    const v = parseFloat(nums[i].replace(/[$,\s]/g, ""));
                    return !isNaN(v) && Math.abs(v - f.answer) <= f.tolerance;
                  });
                  setNumResult(r);
                  if (r.every(Boolean)) completeExercise(ex.id);
                }}
              >
                Check answers
              </Button>
            </div>
            {numResult && (numResult.every(Boolean) ? <Callout kind="success">All correct.</Callout> : <Callout kind="warn">Some answers are off — try a hint.</Callout>)}
          </div>
        )}

        {ex.kind === "interactive" && children}

        {/* hints */}
        {hints > 0 && (
          <div className="flex flex-col gap-1.5">
            {ex.hints.slice(0, hints).map((h, i) => (
              <div key={i} className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2 text-ink-2">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warn-ink" />
                <span>
                  <strong className="text-ink">Hint {i + 1}:</strong> {h}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {hints < ex.hints.length && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Lightbulb className="h-3.5 w-3.5" />}
              onClick={() => {
                setHints(hints + 1);
                exerciseHint(ex.id);
              }}
            >
              {hints === 0 ? "Show a hint" : "Next hint"} ({ex.hints.length - hints} left)
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<Eye className="h-3.5 w-3.5" />}
            onClick={() => {
              setShowSolution(!showSolution);
              if (!showSolution) exerciseSolution(ex.id);
            }}
          >
            {showSolution ? "Hide solution" : "Reveal solution"}
          </Button>
          {ex.kind !== "playground" && ex.kind !== "interactive" && !completed && (
            <span className="text-xs text-ink-3">Solve it to mark complete.</span>
          )}
        </div>
        {showSolution && (
          <div className="fade-in flex flex-col gap-2">
            <CodeBlock tabs={[{ label: "solution", code: ex.solution, language: ex.solutionLanguage ?? "python" }]} />
            <Callout kind="info" title="Why this works">
              {ex.explanation}
            </Callout>
          </div>
        )}
      </div>
    </Card>
  );
}

export function CheckList({ result }: { result: CheckResult }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface-2 p-2.5">
      {result.checks.map((c, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          {c.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good-ink" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad-ink" />}
          <span className={c.ok ? "text-ink-2" : "text-ink"}>
            {c.label}
            {c.detail && <span className="ml-1 font-mono text-[11px] text-ink-3">— {c.detail}</span>}
          </span>
        </div>
      ))}
      <div className={cn("mt-1 text-xs font-semibold", result.passed ? "text-good-ink" : "text-bad-ink")}>{result.passed ? "All checks passed ✓" : "Not yet — fix the failing checks."}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Lesson frame
export function LessonShell({ id, children }: { id: string; children: ReactNode }) {
  const lesson = getLesson(id)!;
  const mod = getModule(lesson.module)!;
  const { prev, next } = lessonNeighbors(id);
  const hydrated = useHydrated((s) => s.hydrated);
  const status = useProgress((s) => s.lessons[id]?.status);
  const startLesson = useProgress((s) => s.startLesson);
  const completeLesson = useProgress((s) => s.completeLesson);
  const resetLesson = useProgress((s) => s.resetLesson);
  useEffect(() => {
    if (hydrated) startLesson(id);
  }, [hydrated, id, startLesson]);
  const done = hydrated && status === "completed";
  const lessonIndex = mod.lessons.indexOf(id);
  const isLastInModule = lessonIndex === mod.lessons.length - 1;

  return (
    <article className="mx-auto max-w-4xl">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <Link href={`/learn/${lesson.track}`} className="hover:text-ink">
          {lesson.track === "langgraph" ? "LangGraph & Workflows" : "LLM Evaluation"}
        </Link>
        <span>/</span>
        <span>
          Module {mod.number} · {mod.title}
        </span>
        <span>/</span>
        <span>
          Lesson {lessonIndex + 1} of {mod.lessons.length}
        </span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{lesson.title}</h1>
      <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-2">{lesson.summary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge>{lesson.minutes} min</Badge>
        {lesson.concepts.map((c) => (
          <Badge key={c} tone="accent">
            {c}
          </Badge>
        ))}
        {done && <Badge tone="good">✓ completed</Badge>}
      </div>
      <div className="lesson-prose mt-8 [&>h2]:mb-3 [&>h2]:mt-10 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-ink [&>h3]:mb-2 [&>h3]:mt-6 [&>h3]:font-semibold [&>h3]:text-ink [&>p]:my-3 [&>ul]:my-3 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:text-ink-2 [&>ul>li]:my-1 [&>ol]:my-3 [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:text-ink-2">
        {children}
      </div>

      <div className="mt-12 flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <div className="font-semibold text-ink">{done ? "Lesson completed" : "Finished experimenting?"}</div>
          <div className="text-xs text-ink-3">{done ? "Nice. Your progress is saved in this browser." : "Mark the lesson complete to update your dashboard."}</div>
        </div>
        <div className="flex gap-2">
          {done ? (
            <Button variant="ghost" size="sm" onClick={() => resetLesson(id)}>
              Mark as not done
            </Button>
          ) : (
            <Button variant="primary" onClick={() => completeLesson(id)} icon={<Check className="h-4 w-4" />}>
              Mark complete
            </Button>
          )}
          {isLastInModule && (
            <Link href={`/learn/${lesson.track}/assessment/${mod.id}`}>
              <Button variant="outline" icon={<FlaskConical className="h-4 w-4" />}>
                Module assessment
              </Button>
            </Link>
          )}
        </div>
      </div>
      <nav className="mt-4 flex justify-between gap-3">
        {prev ? (
          <Link href={`/learn/${prev.track}/${prev.id}`} className="group flex max-w-[48%] items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-2">
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="truncate">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`/learn/${next.track}/${next.id}`} className="group flex max-w-[48%] items-center gap-2 rounded-lg px-2 py-1.5 text-right text-sm text-ink-2 hover:bg-surface-2">
            <span className="truncate">{next.title}</span>
            <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        )}
      </nav>
    </article>
  );
}

/** Visual "Concept → Example → Experiment" strip to orient the learner. */
export function Steps({ items }: { items: string[] }) {
  return (
    <div className="my-4 flex flex-wrap items-center gap-1.5 text-xs">
      {items.map((s, i) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="rounded-md border border-line bg-surface px-2 py-1 font-medium text-ink-2">{s}</span>
          {i < items.length - 1 && <ArrowRight className="h-3 w-3 text-ink-3" />}
        </span>
      ))}
    </div>
  );
}

export function TryIt({ title, children, href, cta }: { title: ReactNode; children?: ReactNode; href?: string; cta?: string }) {
  return (
    <div className="my-6 rounded-xl border border-accent/40 bg-accent-soft p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FlaskConical className="h-4 w-4 text-accent" />
            {title}
          </div>
          {children && <div className="mt-1 text-sm text-ink-2">{children}</div>}
        </div>
        {href && (
          <Link href={href}>
            <Button variant="primary" size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />}>
              {cta ?? "Open the lab"}
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

export function Figure({ children, caption, className }: { children: ReactNode; caption?: ReactNode; className?: string }) {
  return (
    <figure className={cn("my-6", className)}>
      {children}
      {caption && <figcaption className="mt-2 text-center text-xs text-ink-3">{caption}</figcaption>}
    </figure>
  );
}

export { Code, CodeBlock };
