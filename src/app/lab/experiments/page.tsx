import type { Metadata } from "next";
import { Experiments } from "./Experiments";

export const metadata: Metadata = { title: "Experiments" };

export default async function Page({ searchParams }: PageProps<"/lab/experiments">) {
  const sp = await searchParams;
  const ds = Array.isArray(sp.dataset) ? sp.dataset[0] : sp.dataset;
  return <Experiments initialDataset={ds} />;
}
