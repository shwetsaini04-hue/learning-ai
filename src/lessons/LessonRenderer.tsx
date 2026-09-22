"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { Spinner } from "@/components/ui";

const loading = () => (
  <div className="flex items-center gap-2 py-20 text-sm text-ink-3">
    <Spinner /> Loading lesson…
  </div>
);

const LESSONS: Record<string, ComponentType> = {
  "a1-llm-apps": dynamic(() => import("./a1"), { loading }),
  "a1-structured-output": dynamic(() => import("./a1").then((m) => m.StructuredOutput), { loading }),
  "a1-patterns": dynamic(() => import("./a1").then((m) => m.Patterns), { loading }),
  "a2-why-langgraph": dynamic(() => import("./a2"), { loading }),
  "a2-mental-model": dynamic(() => import("./a2").then((m) => m.MentalModel), { loading }),
  "a3-state": dynamic(() => import("./a3-core"), { loading }),
  "a3-nodes-edges": dynamic(() => import("./a3-core").then((m) => m.NodesEdges), { loading }),
  "a3-routing": dynamic(() => import("./a3-core").then((m) => m.Routing), { loading }),
  "a3-loops": dynamic(() => import("./a3-core").then((m) => m.Loops), { loading }),
  "a3-parallel": dynamic(() => import("./a3-advanced"), { loading }),
  "a3-persistence": dynamic(() => import("./a3-advanced").then((m) => m.Persistence), { loading }),
  "a3-hitl": dynamic(() => import("./a3-advanced").then((m) => m.HumanInTheLoop), { loading }),
  "a3-agents": dynamic(() => import("./a3-advanced").then((m) => m.Agents), { loading }),
  "a4-ladder": dynamic(() => import("./a4"), { loading }),
  "a4-debugging": dynamic(() => import("./a4").then((m) => m.Debugging), { loading }),
  "b1-why-eval": dynamic(() => import("./b1"), { loading }),
  "b1-ground-truth": dynamic(() => import("./b1").then((m) => m.GroundTruth), { loading }),
  "b2-correctness-relevance": dynamic(() => import("./b2"), { loading }),
  "b2-groundedness": dynamic(() => import("./b2").then((m) => m.Groundedness), { loading }),
  "b2-structured-consistency": dynamic(() => import("./b2").then((m) => m.ValidityConsistency), { loading }),
  "b2-classification-metrics": dynamic(() => import("./b2").then((m) => m.ClassificationMetrics), { loading }),
  "b3-exact-semantic": dynamic(() => import("./b3"), { loading }),
  "b3-llm-judge": dynamic(() => import("./b3").then((m) => m.LLMJudge), { loading }),
  "b3-regression": dynamic(() => import("./b3").then((m) => m.Regression), { loading }),
  "b4-cost": dynamic(() => import("./b4"), { loading }),
  "b4-latency": dynamic(() => import("./b4").then((m) => m.Latency), { loading }),
  "b4-observability": dynamic(() => import("./b4").then((m) => m.Observability), { loading }),
  "b4-production-loop": dynamic(() => import("./b4").then((m) => m.ProductionLoop), { loading }),
};

export function LessonRenderer({ id }: { id: string }) {
  const C = LESSONS[id];
  if (!C) return <div className="text-sm text-ink-3">Lesson not found.</div>;
  return <C />;
}
