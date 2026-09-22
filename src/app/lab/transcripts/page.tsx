import type { Metadata } from "next";
import { TranscriptLab } from "./TranscriptLab";

export const metadata: Metadata = { title: "Transcript Analysis Lab" };

export default function Page() {
  return <TranscriptLab />;
}
