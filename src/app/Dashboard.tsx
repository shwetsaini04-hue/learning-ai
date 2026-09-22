"use client";

import { ArrowRight, Bug, ChartColumn, CheckCircle2, Coins, FlaskConical, MessageSquareText, Timer, Trophy, Workflow } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, ProgressBar } from "@/components/ui";
import { LESSONS, MODULES, TRACKS, quizIdFor } from "@/content/curriculum";
import { DEBUG_CHALLENGES } from "@/content/debugChallenges";
import { computeLabProgress, computeTrackProgress } from "@/lib/progress-calc";
import { useHydrated } from "@/lib/store/hydration";
import { useProgress } from "@/lib/store/progress";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";

const JOURNEY: { label: string; lesson: string }[] = [
  { label: "LLM", lesson: "a1-llm-apps" },
  { label: "Prompt", lesson: "a1-llm-apps" },
  { label: "Structured output", lesson: "a1-structured-output" },
  { label: "Workflow", lesson: "a1-patterns" },
  { label: "LangGraph", lesson: "a2-why-langgraph" },
  { label: "State", lesson: "a3-state" },
  { label: "Routing", lesson: "a3-routing" },
  { label: "Tools / Agents", lesson: "a3-agents" },
  { label: "Tracing", lesson: "b4-observability" },
  { label: "Evaluation", lesson: "b1-why-eval" },
  { label: "Quality", lesson: "b2-classification-metrics" },
  { label: "Cost", lesson: "b4-cost" },
  { label: "Latency", lesson: "b4-latency" },
  { label: "Production", lesson: "b4-production-loop" },
];

function TextBar({ pct }: { pct: number }) {
  const filled = Math.round(pct * 10);
  return (
    <span className="font-mono text-sm tracking-tight">
      <span className="text-accent">{"█".repeat(filled)}</span>
      <span className="text-ink-3 opacity-50">{"░".repeat(10 - filled)}</span>
    </span>
  );
}

export function Dashboard() {
  const hydrated = useHydrated((s) => s.hydrated);
  const p = useProgress();
  const mode = useSettings((s) => s.mode);
  const tracks = TRACKS.map((t) => ({ t, prog: computeTrackProgress(p, t.id) }));
  const lab = computeLabProgress(p);
  const lessonsDone = Object.values(p.lessons).filter((l) => l.status === "completed").length;
  const exercisesDone = Object.values(p.exercises).filter((e) => e.status === "completed").length;
  const challengesDone = Object.values(p.challenges).filter((c) => c.fixed).length;
  const quizzesDone = MODULES.filter((m) => p.quizzes[quizIdFor(m.id)]).length;
  const experiments = p.counters.experiments ?? 0;
  const nextLesson = (track: string) => LESSONS.find((l) => l.track === track && p.lessons[l.id]?.status !== "completed");
  const statusOf = (id: string) => (hydrated ? p.lessons[id]?.status ?? "not_started" : "not_started");

  return (
    <div className="flex flex-col gap-8">
      {/* hero */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-accent-soft blur-3xl" />
        <div className="relative max-w-3xl">
          <Badge tone="accent">Interactive AI engineering lab</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Learn → Understand → Experiment → Build → Evaluate → Debug</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            Build real LLM workflows for <strong className="text-ink">customer-call transcript analysis</strong> with LangGraph concepts, then measure them like an engineer: quality, cost, latency and
            reliability. Everything runs in your browser — {mode === "live" ? "Live mode is on: real models are being called." : "simulation mode is free and needs no API key."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={`/learn/${nextLesson("langgraph")?.track ?? "langgraph"}/${nextLesson("langgraph")?.id ?? "a1-llm-apps"}`}>
              <Button variant="primary" icon={<ArrowRight className="h-4 w-4" />}>
                {hydrated && lessonsDone > 0 ? "Continue learning" : "Start with lesson 1"}
              </Button>
            </Link>
            <Link href="/lab/transcripts">
              <Button variant="outline" icon={<MessageSquareText className="h-4 w-4" />}>
                Open the Transcript Lab
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* journey */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-ink">Your path to production LLM systems</h2>
          <span className="text-xs text-ink-3">each step links to the lesson where you experiment with it</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {JOURNEY.map((j, i) => {
            const lesson = LESSONS.find((l) => l.id === j.lesson)!;
            const st = statusOf(j.lesson);
            return (
              <div key={j.label} className="flex shrink-0 items-center gap-1.5">
                <Link
                  href={`/learn/${lesson.track}/${lesson.id}`}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    st === "completed" ? "border-good/40 bg-good-soft text-ink" : st === "in_progress" ? "border-accent/50 bg-accent-soft text-ink" : "border-line bg-surface text-ink-2 hover:border-line-strong",
                  )}
                >
                  {st === "completed" && <CheckCircle2 className="h-3.5 w-3.5 text-good-ink" />}
                  {j.label}
                </Link>
                {i < JOURNEY.length - 1 && <ArrowRight className="h-3 w-3 shrink-0 text-ink-3" />}
              </div>
            );
          })}
        </div>
      </section>

      {/* progress */}
      <section className="grid gap-4 md:grid-cols-3">
        {tracks.map(({ t, prog }) => {
          const nl = nextLesson(t.id);
          return (
            <Card key={t.id} className="flex flex-col">
              <CardHeader title={t.title} subtitle={t.tagline} />
              <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
                <div className="flex items-center justify-between">
                  <TextBar pct={hydrated ? prog.pct : 0} />
                  <span className="num text-sm font-semibold text-ink">{hydrated ? Math.round(prog.pct * 100) : 0}%</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-surface-2 py-1.5">
                    <div className="num font-semibold text-ink">
                      {hydrated ? prog.lessonsDone : 0}/{prog.lessonsTotal}
                    </div>
                    <div className="text-ink-3">lessons</div>
                  </div>
                  <div className="rounded-lg bg-surface-2 py-1.5">
                    <div className="num font-semibold text-ink">
                      {hydrated ? prog.exercisesDone : 0}/{prog.exercisesTotal}
                    </div>
                    <div className="text-ink-3">exercises</div>
                  </div>
                  <div className="rounded-lg bg-surface-2 py-1.5">
                    <div className="num font-semibold text-ink">
                      {hydrated ? prog.quizzesDone : 0}/{prog.quizzesTotal}
                    </div>
                    <div className="text-ink-3">assessments</div>
                  </div>
                </div>
                <div className="mt-auto">
                  {nl ? (
                    <Link href={`/learn/${nl.track}/${nl.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:border-line-strong">
                      <span className="min-w-0">
                        <span className="block text-[11px] text-ink-3">Up next</span>
                        <span className="block truncate font-medium text-ink">{nl.title}</span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-ink-3" />
                    </Link>
                  ) : (
                    <Badge tone="good">Track complete 🎉</Badge>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
        <Card className="flex flex-col">
          <CardHeader title="Transcript Analysis practice" subtitle="Hands-on runs, reviews, experiments and the capstone." />
          <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
            <div className="flex items-center justify-between">
              <TextBar pct={hydrated ? lab.pct : 0} />
              <span className="num text-sm font-semibold text-ink">{hydrated ? Math.round(lab.pct * 100) : 0}%</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {lab.items.map((i) => (
                <div key={i.key} className="flex items-center gap-2 text-xs">
                  <span className="w-40 shrink-0 truncate text-ink-2">{i.label}</span>
                  <ProgressBar value={hydrated ? Math.min(1, i.value / i.target) : 0} height={5} />
                  <span className="num w-10 shrink-0 text-right font-mono text-ink-3">
                    {hydrated ? Math.min(i.value, i.target) : 0}/{i.target}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 text-ink-2">Capstone steps</span>
                <ProgressBar value={hydrated ? lab.capstoneDone / lab.capstoneTotal : 0} height={5} tone="good" />
                <span className="num w-10 shrink-0 text-right font-mono text-ink-3">
                  {hydrated ? lab.capstoneDone : 0}/{lab.capstoneTotal}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* counters */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Lessons", value: lessonsDone, total: LESSONS.length },
          { label: "Exercises", value: exercisesDone, total: MODULES.flatMap((m) => m.exercises).length },
          { label: "Assessments", value: quizzesDone, total: MODULES.length },
          { label: "Debug challenges", value: challengesDone, total: DEBUG_CHALLENGES.length },
          { label: "Experiments run", value: experiments },
          { label: "Capstone", value: lab.capstoneDone, total: lab.capstoneTotal },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-surface px-3 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{s.label}</div>
            <div className="num mt-0.5 text-xl font-semibold text-ink">
              {hydrated ? s.value : 0}
              {s.total !== undefined && <span className="text-sm font-normal text-ink-3">/{s.total}</span>}
            </div>
          </div>
        ))}
      </section>

      {/* labs + activity */}
      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <h2 className="mb-3 text-lg font-semibold text-ink">Labs</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { href: "/lab/playground", icon: <Workflow className="h-5 w-5" />, title: "Workflow Playground", text: "Drag nodes, connect edges, run with animation, inspect state, export LangGraph Python." },
              { href: "/lab/transcripts", icon: <MessageSquareText className="h-5 w-5" />, title: "Transcript Lab", text: "Run the full analysis pipeline, review low-confidence calls, collect feedback." },
              { href: "/lab/debug", icon: <Bug className="h-5 w-5" />, title: "Debugging Lab", text: "Eight broken workflows. Diagnose from traces, fix, verify." },
              { href: "/lab/eval", icon: <FlaskConical className="h-5 w-5" />, title: "Eval Playground", text: "Exact match, semantic similarity, groundedness and LLM-as-a-judge side by side." },
              { href: "/lab/experiments", icon: <ChartColumn className="h-5 w-5" />, title: "Experiments", text: "Run datasets through models × prompt versions. Compare, find regressions." },
              { href: "/lab/cost", icon: <Coins className="h-5 w-5" />, title: "Cost & Latency", text: "Token economics, P95 simulations, sequential vs parallel.", extra: <Timer className="h-4 w-4 text-ink-3" /> },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="group rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
                <div className="flex items-center gap-2 text-accent">
                  {l.icon}
                  <span className="text-sm font-semibold text-ink">{l.title}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{l.text}</p>
              </Link>
            ))}
          </div>
          <Link href="/capstone" className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn-soft p-4">
            <div className="flex items-center gap-3">
              <Trophy className="h-5 w-5 text-warn-ink" />
              <div>
                <div className="text-sm font-semibold text-ink">Capstone: Transcript Analysis LLM System</div>
                <div className="text-xs text-ink-2">Design, build, evaluate and defend a production-style pipeline.</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-ink-2" />
          </Link>
        </div>
        <Card>
          <CardHeader title="Recent activity" subtitle="Stored only in this browser" />
          <div className="max-h-[420px] overflow-y-auto px-4 pb-4">
            {hydrated && p.activity.length ? (
              <ul className="flex flex-col gap-2">
                {p.activity.slice(0, 14).map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-ink">{a.type.replace(/_/g, " ")}</span> <span className="text-ink-2">{a.detail}</span>
                    </span>
                    <span className="shrink-0 text-ink-3">{new Date(a.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-8 text-center text-sm text-ink-3">Nothing yet. Start a lesson or run a workflow.</div>
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}
