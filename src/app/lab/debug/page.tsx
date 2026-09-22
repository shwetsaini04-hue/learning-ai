import type { Metadata } from "next";
import { DebugLab } from "./DebugLab";

export const metadata: Metadata = { title: "Debugging Lab" };

export default function Page() {
  return <DebugLab />;
}
