"use client";

import { Highlight, type PrismTheme } from "prism-react-renderer";
import { ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CopyButton } from "@/components/ui";
import { cn } from "@/lib/utils";

const theme: PrismTheme = {
  plain: { color: "var(--ink)", backgroundColor: "transparent" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "var(--ink-3)", fontStyle: "italic" } },
    { types: ["keyword", "builtin", "important", "atrule"], style: { color: "var(--s7)" } },
    { types: ["string", "char", "attr-value", "triple-quoted-string", "template-string"], style: { color: "var(--s3)" } },
    { types: ["function", "class-name"], style: { color: "var(--s1)" } },
    { types: ["number", "boolean", "constant"], style: { color: "var(--s2)" } },
    { types: ["decorator", "annotation"], style: { color: "var(--s5)" } },
    { types: ["operator", "punctuation"], style: { color: "var(--ink-2)" } },
    { types: ["property", "attr-name"], style: { color: "var(--s1)" } },
  ],
};

export function LastVerified({ date = "2026-09-22", source, className }: { date?: string; source?: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10.5px] font-medium text-ink-3", className)}
      title={source ? `Verified against ${source}` : "API details verified against official docs on this date"}
    >
      <ShieldCheck className="h-3 w-3 text-good-ink" />
      Last verified {date}
    </span>
  );
}

export function Code({
  code,
  language = "python",
  className,
  maxHeight,
  highlightLines = [],
}: {
  code: string;
  language?: string;
  className?: string;
  maxHeight?: number;
  highlightLines?: number[];
}) {
  const lang = language === "bash" || language === "text" ? "plain" : language;
  return (
    <Highlight code={code.replace(/\n$/, "")} language={lang} theme={theme}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className={cn("overflow-auto bg-code px-4 py-3 font-mono text-[12.5px] leading-[1.65]", className)} style={{ maxHeight }}>
          {tokens.map((line, i) => {
            const lp = getLineProps({ line });
            return (
              <div key={i} {...lp} className={cn(lp.className, highlightLines.includes(i + 1) && "-mx-4 border-l-2 border-accent bg-accent-soft px-[14px]")}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
}

export interface CodeTab {
  label: string;
  code: string;
  language?: string;
  note?: ReactNode;
}

/**
 * Code with tabs. `verified` marks version-sensitive API code with a
 * "Last verified" badge so current syntax is distinguishable from concepts.
 */
export function CodeBlock({
  tabs,
  title,
  verified,
  className,
  maxHeight = 460,
  highlightLines,
}: {
  tabs: CodeTab[] | string;
  title?: ReactNode;
  verified?: boolean | string;
  className?: string;
  maxHeight?: number;
  highlightLines?: number[];
}) {
  const list: CodeTab[] = typeof tabs === "string" ? [{ label: "python", code: tabs, language: "python" }] : tabs;
  const [active, setActive] = useState(0);
  const cur = list[Math.min(active, list.length - 1)];
  return (
    <div className={cn("overflow-hidden rounded-xl border border-line bg-code", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {title && <span className="px-1.5 text-xs font-medium text-ink-2">{title}</span>}
          {list.length > 1 &&
            list.map((t, i) => (
              <button
                key={t.label}
                onClick={() => setActive(i)}
                className={cn("shrink-0 rounded-md px-2 py-1 text-xs font-medium", i === active ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink-2")}
              >
                {t.label}
              </button>
            ))}
          {list.length === 1 && !title && <span className="px-1.5 font-mono text-[11px] text-ink-3">{cur.language ?? "python"}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {verified && <LastVerified date={typeof verified === "string" ? verified : undefined} source="docs.langchain.com" />}
          <CopyButton text={cur.code} />
        </div>
      </div>
      <Code code={cur.code} language={cur.language ?? "python"} maxHeight={maxHeight} highlightLines={highlightLines} />
      {cur.note && <div className="border-t border-line bg-surface px-4 py-2 text-xs text-ink-2">{cur.note}</div>}
    </div>
  );
}
