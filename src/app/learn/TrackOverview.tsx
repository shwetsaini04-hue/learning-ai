"use client";

import { CheckCircle2, Circle, CircleDot, FlaskConical, Target } from "lucide-react";
import Link from "next/link";
import { Badge, Card, PageHeader, ProgressBar } from "@/components/ui";
import { LESSONS, MODULES, getTrack, quizIdFor, type TrackId } from "@/content/curriculum";
import { getExercise } from "@/content/exercises";
import { computeTrackProgress } from "@/lib/progress-calc";
import { useHydrated } from "@/lib/store/hydration";
import { useProgress } from "@/lib/store/progress";
import { cn } from "@/lib/utils";

export function TrackOverview({ trackId }: { trackId: TrackId }) {
  const track = getTrack(trackId)!;
  const p = useProgress();
  const hydrated = useHydrated((s) => s.hydrated);
  const prog = computeTrackProgress(p, trackId);
  const modules = MODULES.filter((m) => m.track === trackId);

  const lessonStatus = (id: string) => (hydrated ? p.lessons[id]?.status ?? "not_started" : "not_started");
  const moduleStatus = (lessons: string[]) => {
    const st = lessons.map(lessonStatus);
    if (st.every((s) => s === "completed")) return "Completed";
    if (st.some((s) => s !== "not_started")) return "In progress";
    return "Not started";
  };

  return (
    <div>
      <PageHeader
        eyebrow={trackId === "langgraph" ? "Track A" : "Track B"}
        title={track.title}
        right={
          <div className="w-56">
            <div className="mb-1 flex justify-between text-xs text-ink-3">
              <span>Track progress</span>
              <span className="num font-semibold text-ink">{hydrated ? Math.round(prog.pct * 100) : 0}%</span>
            </div>
            <ProgressBar value={hydrated ? prog.pct : 0} />
          </div>
        }
      >
        {track.tagline}
      </PageHeader>

      <div className="flex flex-col gap-5">
        {modules.map((m) => {
          const ms = moduleStatus(m.lessons);
          const quiz = hydrated ? p.quizzes[quizIdFor(m.id)] : undefined;
          return (
            <Card key={m.id} className="overflow-hidden">
              <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{m.number}</span>
                    <h2 className="text-base font-semibold text-ink">{m.title}</h2>
                  </div>
                  <p className="mt-1 text-sm text-ink-3">{m.summary}</p>
                </div>
                <Badge tone={ms === "Completed" ? "good" : ms === "In progress" ? "accent" : "neutral"}>{ms}</Badge>
              </div>
              <ol className="divide-y divide-line">
                {m.lessons.map((lid, i) => {
                  const l = LESSONS.find((x) => x.id === lid)!;
                  const st = lessonStatus(lid);
                  return (
                    <li key={lid}>
                      <Link href={`/learn/${trackId}/${lid}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                        {st === "completed" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-good-ink" /> : st === "in_progress" ? <CircleDot className="h-4 w-4 shrink-0 text-accent" /> : <Circle className="h-4 w-4 shrink-0 text-ink-3" />}
                        <span className="w-5 shrink-0 font-mono text-xs text-ink-3">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink">{l.title}</span>
                          <span className="block truncate text-xs text-ink-3">{l.summary}</span>
                        </span>
                        <span className="hidden shrink-0 text-xs text-ink-3 sm:block">{l.minutes} min</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
              <div className="flex flex-col gap-2 border-t border-line bg-surface-2 px-4 py-3">
                {m.exercises.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Target className="h-4 w-4 text-ink-3" />
                    <span className="text-xs font-medium text-ink-2">Exercises:</span>
                    {m.exercises.map((eid) => {
                      const ex = getExercise(eid)!;
                      const done = hydrated && p.exercises[eid]?.status === "completed";
                      const lesson = LESSONS.find((l) => l.id === ex.lesson)!;
                      return (
                        <Link
                          key={eid}
                          href={ex.kind === "playground" ? `/lab/playground?exercise=${eid}` : `/learn/${lesson.track}/${lesson.id}`}
                          className={cn("rounded-md border px-2 py-0.5 text-xs", done ? "border-good/40 bg-good-soft text-ink" : "border-line bg-surface text-ink-2 hover:border-line-strong")}
                        >
                          {done ? "✓ " : ""}
                          {ex.title}
                        </Link>
                      );
                    })}
                  </div>
                )}
                <Link href={`/learn/${trackId}/assessment/${m.id}`} className="flex items-center gap-2 text-xs font-medium text-accent">
                  <FlaskConical className="h-4 w-4" />
                  Module assessment {quiz ? `· best ${quiz.score}/${quiz.total}` : "· not taken"}
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
