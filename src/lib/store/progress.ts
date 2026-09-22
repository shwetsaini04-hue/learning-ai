"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type LessonStatus = "not_started" | "in_progress" | "completed";

export interface QuizRecord {
  answers: Record<string, number[]>;
  score: number;
  total: number;
  completedAt: number;
  attempts: number;
}

export interface ExerciseRecord {
  status: "attempted" | "completed";
  hintsUsed: number;
  solutionViewed: boolean;
  completedAt?: number;
}

export interface ChallengeRecord {
  diagnosed: boolean;
  fixed: boolean;
  completedAt?: number;
}

export interface ActivityEvent {
  type: string;
  detail: string;
  at: number;
}

export interface CapstoneStepRecord {
  done: boolean;
  score?: number;
  data?: unknown;
  at?: number;
}

interface ProgressState {
  lessons: Record<string, { status: LessonStatus; updatedAt: number }>;
  quizzes: Record<string, QuizRecord>;
  exercises: Record<string, ExerciseRecord>;
  challenges: Record<string, ChallengeRecord>;
  counters: Record<string, number>;
  activity: ActivityEvent[];
  capstone: Record<string, CapstoneStepRecord>;
  startLesson: (id: string) => void;
  completeLesson: (id: string) => void;
  resetLesson: (id: string) => void;
  recordQuiz: (id: string, rec: Omit<QuizRecord, "attempts" | "completedAt">) => void;
  exerciseAttempt: (id: string) => void;
  exerciseHint: (id: string) => void;
  exerciseSolution: (id: string) => void;
  completeExercise: (id: string) => void;
  challengeDiagnosed: (id: string) => void;
  challengeFixed: (id: string) => void;
  bump: (counter: string, detail?: string) => void;
  log: (type: string, detail: string) => void;
  capstoneStep: (step: string, rec: Partial<CapstoneStepRecord>) => void;
  resetAll: () => void;
  importAll: (data: Partial<ProgressState>) => void;
}

const initial = {
  lessons: {},
  quizzes: {},
  exercises: {},
  challenges: {},
  counters: {},
  activity: [] as ActivityEvent[],
  capstone: {},
};

function pushActivity(list: ActivityEvent[], ev: ActivityEvent) {
  return [ev, ...list].slice(0, 60);
}

export const useProgress = create<ProgressState>()(
  persist(
    (set, get) => ({
      ...initial,
      startLesson: (id) => {
        const cur = get().lessons[id];
        if (cur && cur.status !== "not_started") return;
        set({ lessons: { ...get().lessons, [id]: { status: "in_progress", updatedAt: Date.now() } } });
      },
      completeLesson: (id) => {
        set({
          lessons: { ...get().lessons, [id]: { status: "completed", updatedAt: Date.now() } },
          activity: pushActivity(get().activity, { type: "lesson", detail: id, at: Date.now() }),
        });
      },
      resetLesson: (id) => {
        const next = { ...get().lessons };
        delete next[id];
        set({ lessons: next });
      },
      recordQuiz: (id, rec) => {
        const prev = get().quizzes[id];
        const best = prev && prev.score / Math.max(1, prev.total) > rec.score / Math.max(1, rec.total) ? prev : null;
        set({
          quizzes: {
            ...get().quizzes,
            [id]: best
              ? { ...best, attempts: (prev?.attempts ?? 0) + 1 }
              : { ...rec, attempts: (prev?.attempts ?? 0) + 1, completedAt: Date.now() },
          },
          activity: pushActivity(get().activity, { type: "quiz", detail: `${id}: ${rec.score}/${rec.total}`, at: Date.now() }),
        });
      },
      exerciseAttempt: (id) => {
        const cur = get().exercises[id];
        if (cur) return;
        set({ exercises: { ...get().exercises, [id]: { status: "attempted", hintsUsed: 0, solutionViewed: false } } });
      },
      exerciseHint: (id) => {
        const cur = get().exercises[id] ?? { status: "attempted", hintsUsed: 0, solutionViewed: false };
        set({ exercises: { ...get().exercises, [id]: { ...cur, hintsUsed: cur.hintsUsed + 1 } } });
      },
      exerciseSolution: (id) => {
        const cur = get().exercises[id] ?? { status: "attempted", hintsUsed: 0, solutionViewed: false };
        set({ exercises: { ...get().exercises, [id]: { ...cur, solutionViewed: true } } });
      },
      completeExercise: (id) => {
        const cur = get().exercises[id] ?? { status: "attempted", hintsUsed: 0, solutionViewed: false };
        if (cur.status === "completed") return;
        set({
          exercises: { ...get().exercises, [id]: { ...cur, status: "completed", completedAt: Date.now() } },
          activity: pushActivity(get().activity, { type: "exercise", detail: id, at: Date.now() }),
        });
      },
      challengeDiagnosed: (id) => {
        const cur = get().challenges[id] ?? { diagnosed: false, fixed: false };
        set({ challenges: { ...get().challenges, [id]: { ...cur, diagnosed: true } } });
      },
      challengeFixed: (id) => {
        const cur = get().challenges[id] ?? { diagnosed: false, fixed: false };
        if (cur.fixed) return;
        set({
          challenges: { ...get().challenges, [id]: { ...cur, fixed: true, completedAt: Date.now() } },
          activity: pushActivity(get().activity, { type: "debug", detail: id, at: Date.now() }),
        });
      },
      bump: (counter, detail) => {
        set({
          counters: { ...get().counters, [counter]: (get().counters[counter] ?? 0) + 1 },
          activity: detail ? pushActivity(get().activity, { type: counter, detail, at: Date.now() }) : get().activity,
        });
      },
      log: (type, detail) => set({ activity: pushActivity(get().activity, { type, detail, at: Date.now() }) }),
      capstoneStep: (step, rec) => {
        const cur = get().capstone[step] ?? { done: false };
        set({
          capstone: { ...get().capstone, [step]: { ...cur, ...rec, at: Date.now() } },
          activity: rec.done && !cur.done ? pushActivity(get().activity, { type: "capstone", detail: step, at: Date.now() }) : get().activity,
        });
      },
      resetAll: () => set({ ...initial }),
      importAll: (data) =>
        set({
          lessons: data.lessons ?? {},
          quizzes: data.quizzes ?? {},
          exercises: data.exercises ?? {},
          challenges: data.challenges ?? {},
          counters: data.counters ?? {},
          activity: data.activity ?? [],
          capstone: data.capstone ?? {},
        }),
    }),
    { name: "ael-progress-v1", storage: createJSONStorage(() => localStorage), skipHydration: true },
  ),
);
