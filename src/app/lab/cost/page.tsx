import type { Metadata } from "next";
import { CostLab } from "./CostLab";

export const metadata: Metadata = { title: "Cost Lab" };

export default function Page() {
  return <CostLab />;
}
