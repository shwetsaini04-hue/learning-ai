import type { Metadata } from "next";
import { ModelComparison } from "./ModelComparison";

export const metadata: Metadata = { title: "Model Comparison" };

export default function Page() {
  return <ModelComparison />;
}
