"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, Input, PageHeader, Pill } from "@/components/ui";
import { getLesson } from "@/content/curriculum";
import { GLOSSARY, type GlossaryTerm } from "@/content/glossary";

const CATS: GlossaryTerm["category"][] = ["LLM basics", "LangGraph", "Workflows", "Evaluation", "Metrics", "Production"];

export function Glossary({ initialQuery }: { initialQuery: string }) {
  const [q, setQ] = useState(initialQuery);
  const [cat, setCat] = useState<string | null>(null);
  const items = useMemo(() => {
    const n = q.toLowerCase().trim();
    return GLOSSARY.filter((g) => (!cat || g.category === cat) && (!n || [g.term, ...(g.aliases ?? []), g.definition, g.simple].some((s) => s.toLowerCase().includes(n)))).sort((a, b) => {
      const ea = a.term.toLowerCase() === n || a.aliases?.some((x) => x.toLowerCase() === n) ? 0 : 1;
      const eb = b.term.toLowerCase() === n || b.aliases?.some((x) => x.toLowerCase() === n) ? 0 : 1;
      return ea - eb || a.term.localeCompare(b.term);
    });
  }, [q, cat]);
  return (
    <div>
      <PageHeader eyebrow="Glossary" title="Every term, explained four ways">
        Definition → simple explanation → example → why it matters. Hover dotted terms in lessons for a quick version.
      </PageHeader>
      <div className="mb-4 flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-3" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: reducer, P95, groundedness…" className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Pill active={!cat} onClick={() => setCat(null)}>
            All ({GLOSSARY.length})
          </Pill>
          {CATS.map((c) => (
            <Pill key={c} active={cat === c} onClick={() => setCat(cat === c ? null : c)}>
              {c}
            </Pill>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((g) => {
          const lesson = g.lesson ? getLesson(g.lesson) : undefined;
          return (
            <Card key={g.term} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-ink">{g.term}</h2>
                  {g.aliases && <div className="text-xs text-ink-3">also: {g.aliases.join(", ")}</div>}
                </div>
                <Badge>{g.category}</Badge>
              </div>
              <dl className="mt-2 grid gap-2 text-sm">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-accent">Definition</dt>
                  <dd className="text-ink">{g.definition}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">In plain words</dt>
                  <dd className="text-ink-2">{g.simple}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Example</dt>
                  <dd className="font-mono text-[12.5px] text-ink-2">{g.example}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-warn-ink">Why it matters</dt>
                  <dd className="text-ink-2">{g.why}</dd>
                </div>
              </dl>
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                {g.related?.map((r) => (
                  <button key={r} onClick={() => setQ(r)} className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-2 hover:border-line-strong">
                    {r}
                  </button>
                ))}
                {lesson && (
                  <Link href={`/learn/${lesson.track}/${lesson.id}`} className="ml-auto flex items-center gap-1 text-xs font-medium text-accent">
                    {lesson.title} <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {!items.length && <div className="py-10 text-center text-sm text-ink-3">No terms match “{q}”.</div>}
    </div>
  );
}
