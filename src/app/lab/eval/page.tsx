import type { Metadata } from "next";
import { EvalPlayground } from "./EvalPlayground";

export const metadata: Metadata = { title: "Evaluation Playground" };

export default function Page() {
  return <EvalPlayground />;
}
