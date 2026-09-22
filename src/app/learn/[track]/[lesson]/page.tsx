import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LESSONS, getLesson } from "@/content/curriculum";
import { LessonRenderer } from "@/lessons/LessonRenderer";

export function generateStaticParams() {
  return LESSONS.map((l) => ({ track: l.track, lesson: l.id }));
}

export async function generateMetadata({ params }: PageProps<"/learn/[track]/[lesson]">): Promise<Metadata> {
  const { lesson } = await params;
  const l = getLesson(lesson);
  return { title: l?.title ?? "Lesson", description: l?.summary };
}

export default async function Page({ params }: PageProps<"/learn/[track]/[lesson]">) {
  const { track, lesson } = await params;
  const l = getLesson(lesson);
  if (!l || l.track !== track) notFound();
  return <LessonRenderer id={lesson} />;
}
