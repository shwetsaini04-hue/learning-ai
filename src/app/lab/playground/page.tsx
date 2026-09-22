import type { Metadata } from "next";
import { Playground } from "./Playground";

export const metadata: Metadata = { title: "Workflow Playground" };

export default async function Page({ searchParams }: PageProps<"/lab/playground">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <Playground template={one(sp.template)} exerciseId={one(sp.exercise)} challengeId={one(sp.challenge)} />;
}
