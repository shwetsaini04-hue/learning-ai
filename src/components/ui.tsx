"use client";

import { AlertTriangle, Check, ChevronDown, Copy, Info, Lightbulb, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- Button
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  icon,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; icon?: ReactNode }) {
  const v: Record<ButtonVariant, string> = {
    primary: "bg-accent text-white hover:brightness-110 shadow-sm",
    secondary: "bg-surface-2 text-ink hover:bg-surface-3 border border-line",
    outline: "bg-transparent text-ink border border-line-strong hover:bg-surface-2",
    ghost: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
    danger: "bg-bad text-white hover:brightness-110",
  };
  const s = { sm: "h-7 px-2.5 text-xs gap-1.5", md: "h-9 px-3.5 text-sm gap-2", lg: "h-11 px-5 text-sm gap-2" }[size];
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-all disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap select-none",
        v[variant],
        s,
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Card
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface", className)} style={{ boxShadow: "var(--shadow)" }} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, right, className, icon }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-4 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          {icon}
          <span className="truncate">{title}</span>
        </div>
        {subtitle && <div className="mt-0.5 text-xs text-ink-3">{subtitle}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Badge
type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "llm" | "fn" | "router" | "human" | "tool";
export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  const t: Record<Tone, string> = {
    neutral: "bg-surface-2 text-ink-2 border-line",
    accent: "bg-accent-soft text-accent-strong border-transparent",
    good: "bg-good-soft text-good-ink border-transparent",
    warn: "bg-warn-soft text-warn-ink border-transparent",
    bad: "bg-bad-soft text-bad-ink border-transparent",
    llm: "bg-surface-2 text-ink border-line",
    fn: "bg-surface-2 text-ink border-line",
    router: "bg-surface-2 text-ink border-line",
    human: "bg-surface-2 text-ink border-line",
    tool: "bg-surface-2 text-ink border-line",
  };
  const dotColor: Partial<Record<Tone, string>> = { llm: "bg-n-llm", fn: "bg-n-fn", router: "bg-n-router", human: "bg-n-human", tool: "bg-n-tool", good: "bg-good", warn: "bg-warn", bad: "bg-bad", accent: "bg-accent" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4", t[tone], className)}>
      {(dot || ["llm", "fn", "router", "human", "tool"].includes(tone)) && <span className={cn("h-1.5 w-1.5 rounded-full", dotColor[tone] ?? "bg-ink-3")} />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Tabs
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  size = "md",
}: {
  tabs: { id: T; label: ReactNode; badge?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" className={cn("flex items-center gap-1 overflow-x-auto border-b border-line", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "relative -mb-px flex shrink-0 items-center gap-1.5 border-b-2 font-medium transition-colors",
            size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
            value === t.id ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2",
          )}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
}: {
  options: { id: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("inline-flex rounded-lg border border-line bg-surface-2 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-md font-medium transition-all",
            size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
            value === o.id ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Callout
type CalloutKind = "info" | "tip" | "warn" | "danger" | "success";
export function Callout({ kind = "info", title, children, className }: { kind?: CalloutKind; title?: ReactNode; children: ReactNode; className?: string }) {
  const map: Record<CalloutKind, { icon: ReactNode; cls: string }> = {
    info: { icon: <Info className="h-4 w-4 text-accent" />, cls: "border-line bg-accent-soft" },
    tip: { icon: <Lightbulb className="h-4 w-4 text-warn-ink" />, cls: "border-line bg-warn-soft" },
    warn: { icon: <AlertTriangle className="h-4 w-4 text-warn-ink" />, cls: "border-line bg-warn-soft" },
    danger: { icon: <AlertTriangle className="h-4 w-4 text-bad-ink" />, cls: "border-line bg-bad-soft" },
    success: { icon: <Check className="h-4 w-4 text-good-ink" />, cls: "border-line bg-good-soft" },
  };
  return (
    <div className={cn("flex gap-3 rounded-lg border px-3.5 py-3 text-sm", map[kind].cls, className)}>
      <div className="mt-0.5 shrink-0">{map[kind].icon}</div>
      <div className="min-w-0 text-ink-2 [&_strong]:text-ink">
        {title && <div className="mb-0.5 font-semibold text-ink">{title}</div>}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Collapsible
export function Collapsible({ title, children, defaultOpen = false, className, right }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("rounded-lg border border-line bg-surface", className)}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm font-medium text-ink">
        <span className="flex min-w-0 items-center gap-2">{title}</span>
        <span className="flex items-center gap-2">
          {right}
          <ChevronDown className={cn("h-4 w-4 text-ink-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <div className="border-t border-line px-3.5 py-3 fade-in">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Progress
export function ProgressBar({ value, className, tone = "accent", height = 6 }: { value: number; className?: string; tone?: "accent" | "good" | "warn" | "bad"; height?: number }) {
  const color = { accent: "bg-accent", good: "bg-good", warn: "bg-warn", bad: "bg-bad" }[tone];
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-surface-3", className)} style={{ height }}>
      <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- Stat
export function Stat({ label, value, sub, className, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface px-3 py-2.5", className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold text-ink", tone === "good" && "text-good-ink", tone === "bad" && "text-bad-ink", tone === "warn" && "text-warn-ink")}>{value}</div>
      {sub && <div className="text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Form controls
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-ink-2">
        <span>{label}</span>
        {hint && <span className="font-normal text-ink-3">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean; group?: string }[];
  className?: string;
  disabled?: boolean;
}) {
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(
        "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-sm text-ink outline-none transition-colors hover:border-line-strong focus:border-accent disabled:opacity-50",
        className,
      )}
    >
      {groups.map((g) =>
        g ? (
          <optgroup key={g} label={g}>
            {options
              .filter((o) => o.group === g)
              .map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ) : (
          options
            .filter((o) => !o.group)
            .map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
        ),
      )}
    </select>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}

export function TextArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  label,
  format,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: ReactNode;
  format?: (v: number) => string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex items-center justify-between text-xs font-medium text-ink-2">
          <label htmlFor={id}>{label}</label>
          <span className="num font-mono text-ink">{format ? format(value) : value}</span>
        </div>
      )}
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
    </div>
  );
}

export function Toggle({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-2 text-sm text-ink-2", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-surface-3")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cn("fade-in max-h-[92vh] w-full overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-sm font-semibold text-ink">{title}</div>
          <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- misc
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <button
      className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-3 hover:bg-surface-3 hover:text-ink", className)}
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        setDone(true);
        if (t.current) clearTimeout(t.current);
        t.current = setTimeout(() => setDone(false), 1400);
      }}
      aria-label="Copy"
    >
      {done ? <Check className="h-3.5 w-3.5 text-good-ink" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <div className="text-sm font-semibold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-ink-3">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[10px] text-ink-2">{children}</kbd>;
}

export function SectionTitle({ children, sub, id }: { children: ReactNode; sub?: ReactNode; id?: string }) {
  return (
    <div id={id} className="mb-3 mt-10 scroll-mt-20">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{children}</h2>
      {sub && <p className="mt-0.5 text-sm text-ink-3">{sub}</p>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, right }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wider text-accent">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {children && <div className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-2">{children}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function Pill({ children, active, onClick, className }: { children: ReactNode; active?: boolean; onClick?: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink-2 hover:border-line-strong",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}
