import type { Metadata } from "next";
import { Glossary } from "./Glossary";

export const metadata: Metadata = { title: "Glossary" };

export default async function Page({ searchParams }: PageProps<"/glossary">) {
  const sp = await searchParams;
  const q = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  return <Glossary initialQuery={q ?? ""} />;
}
