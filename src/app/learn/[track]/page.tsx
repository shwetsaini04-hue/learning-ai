import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TRACKS, getTrack, type TrackId } from "@/content/curriculum";
import { TrackOverview } from "../TrackOverview";

export function generateStaticParams() {
  return TRACKS.map((t) => ({ track: t.id }));
}

export async function generateMetadata({ params }: PageProps<"/learn/[track]">): Promise<Metadata> {
  const { track } = await params;
  return { title: getTrack(track)?.title ?? "Track" };
}

export default async function Page({ params }: PageProps<"/learn/[track]">) {
  const { track } = await params;
  if (!getTrack(track)) notFound();
  return <TrackOverview trackId={track as TrackId} />;
}
