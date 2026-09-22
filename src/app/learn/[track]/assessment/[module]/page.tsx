import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MODULES, getModule, quizIdFor } from "@/content/curriculum";
import { ASSESSMENTS } from "@/content/assessments";
import { AssessmentClient } from "./AssessmentClient";

export function generateStaticParams() {
  return MODULES.map((m) => ({ track: m.track, module: m.id }));
}

export async function generateMetadata({ params }: PageProps<"/learn/[track]/assessment/[module]">): Promise<Metadata> {
  const { module } = await params;
  return { title: `Assessment · ${getModule(module)?.title ?? ""}` };
}

export default async function Page({ params }: PageProps<"/learn/[track]/assessment/[module]">) {
  const { track, module } = await params;
  const m = getModule(module);
  if (!m || m.track !== track || !ASSESSMENTS[module]) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 text-xs text-ink-3">
        <Link href={`/learn/${track}`} className="hover:text-ink">
          {track === "langgraph" ? "LangGraph & Workflows" : "LLM Evaluation"}
        </Link>{" "}
        / Module {m.number} assessment
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Assessment: {m.title}</h1>
      <p className="mt-1 text-sm text-ink-2">
        Scenario-based questions. There are no trick definitions here — each question asks what you would <strong className="text-ink">do</strong> as an engineer. Explanations appear
        after you answer.
      </p>
      <div className="mt-6">
        <AssessmentClient quizId={quizIdFor(module)} moduleId={module} />
      </div>
    </div>
  );
}
