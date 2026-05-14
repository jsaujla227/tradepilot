"use client";

import { ReactNode } from "react";

export function CalculatorCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground p-6 shadow-sm flex flex-col gap-4">
      <header>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>
      </header>
      {children}
    </section>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  step = "0.01",
  min,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (next: number) => void;
  step?: string;
  min?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs">
      <span className="font-medium text-foreground/90">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          onChange(Number.isFinite(parsed) ? parsed : NaN);
        }}
        className="rounded-md border border-input bg-background/40 px-3 py-2 text-sm font-mono tabular-nums text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
      />
      {hint ? (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function ResultRow({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: ReactNode;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={
          emphasize
            ? "text-base font-semibold tabular-nums text-foreground"
            : "text-sm tabular-nums text-foreground/90 font-mono"
        }
      >
        {value}
      </span>
    </div>
  );
}

export function WhyReveal({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-md border border-border/60 bg-background/30 open:bg-background/50">
      <summary className="cursor-pointer select-none list-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition flex items-center justify-between">
        <span>Why?</span>
        <span
          aria-hidden
          className="text-[10px] font-mono transition group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="px-3 pb-3 pt-1 text-xs leading-relaxed text-muted-foreground space-y-1.5 font-mono">
        {children}
      </div>
    </details>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
    >
      {message}
    </div>
  );
}
