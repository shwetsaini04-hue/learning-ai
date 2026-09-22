import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MODULES, TRACKS } from "@/content/curriculum";

export const metadata = { title: "Curriculum" };

export default function Page() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Curriculum</h1>
      <p className="mt-1 text-sm text-ink-2">Two tracks. Each module: short concepts, interactive experiments, exercises and a scenario-based assessment.</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {TRACKS.map((t) => (
          <Link key={t.id} href={`/learn/${t.id}`} className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">{t.title}</h2>
              <ArrowRight className="h-4 w-4 text-ink-3" />
            </div>
            <p className="mt-1 text-sm text-ink-2">{t.tagline}</p>
            <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-2">
              {MODULES.filter((m) => m.track === t.id).map((m) => (
                <li key={m.id}>
                  <span className="font-mono text-xs text-accent">{m.number}</span> {m.title}
                </li>
              ))}
            </ul>
          </Link>
        ))}
      </div>
    </div>
  );
}
