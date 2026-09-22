import type { Metadata } from "next";
import { DatasetBuilder } from "./DatasetBuilder";

export const metadata: Metadata = { title: "Evaluation Datasets" };

export default function Page() {
  return <DatasetBuilder />;
}
