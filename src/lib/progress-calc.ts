"use client";

import { LESSONS, MODULES, quizIdFor, type TrackId } from "@/content/curriculum";
import { useProgress } from "@/lib/store/progress";

export interface TrackProgress {
  lessonsDone: number;
  lessonsTotal: number;
  quizzesDone: number;
  quizzesTotal: number;
  exercisesDone: number;
  exercisesTotal: number;
  pct: number;
}

export function computeTrackProgress(state: ReturnType<typeof useProgress.getState>, track: TrackId): TrackProgress {
  const lessons = LESSONS.filter((l) => l.track === track);
  const modules = MODULES.filter((m) => m.track === track);
  const exercises = modules.flatMap((m) => m.exercises);
  const lessonsDone = lessons.filter((l) => state.lessons[l.id]?.status === "completed").length;
  const quizzesDone = modules.filter((m) => state.quizzes[quizIdFor(m.id)]).length;
  const exercisesDone = exercises.filter((e) => state.exercises[e]?.status === "completed").length;
  const total = lessons.length + modules.length + exercises.length;
  return {
    lessonsDone,
    lessonsTotal: lessons.length,
    quizzesDone,
    quizzesTotal: modules.length,
    exercisesDone,
    exercisesTotal: exercises.length,
    pct: total ? (lessonsDone + quizzesDone + exercisesDone) / total : 0,
  };
}

export const CAPSTONE_STEPS = ["brief", "design", "build", "evaluate", "analyze", "regression", "final"] as const;

export function computeLabProgress(state: ReturnType<typeof useProgress.getState>) {
  const c = state.counters;
  const goals: { key: string; label: string; target: number }[] = [
    { key: "transcript_runs", label: "Transcript lab runs", target: 5 },
    { key: "human_reviews", label: "Human reviews completed", target: 3 },
    { key: "playground_runs", label: "Playground runs", target: 5 },
    { key: "experiments", label: "Evaluation experiments", target: 4 },
    { key: "judge_runs", label: "LLM-judge evaluations", target: 3 },
  ];
  const items = goals.map((g) => ({ ...g, value: c[g.key] ?? 0 }));
  const capstoneDone = CAPSTONE_STEPS.filter((s) => state.capstone[s]?.done).length;
  const pct = (items.reduce((a, i) => a + Math.min(1, i.value / i.target), 0) + capstoneDone / CAPSTONE_STEPS.length * 2) / (items.length + 2);
  return { items, capstoneDone, capstoneTotal: CAPSTONE_STEPS.length, pct };
}
