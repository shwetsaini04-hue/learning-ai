"use client";

import { Quiz } from "@/components/learn/Learn";
import { ASSESSMENTS } from "@/content/assessments";

export function AssessmentClient({ quizId, moduleId }: { quizId: string; moduleId: string }) {
  return <Quiz id={quizId} questions={ASSESSMENTS[moduleId]} />;
}
