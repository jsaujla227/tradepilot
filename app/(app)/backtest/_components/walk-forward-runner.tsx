"use client";

import { useActionState } from "react";
import {
  runWalkForwardAction,
  type WalkForwardState,
  type WalkForwardView,
} from "../actions";
import { MetricsPanel } from "./metrics-panel";

const INPUT =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/40";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function Report({ report }: { report: WalkForwardView }) {
  const gap = report.overfittingGap;
  // A large positive gap = in-sample looked better than out-of-sample held up.
  const gapColor =
    gap > 0.5 ? "text-red-400" : gap > 0.1 ? "text-yellow-400" : "text-green-400";

  return (
    <div className="space-y-5">
      <div className="text-sm text-muted-foreground">
        <span className="font-mono font-semibold text-foreground">
          {report.ticker}
        </span>{" "}
        · {report.windows.length} walk-forward windows · {report.barCount} bars
      </div>

      {/* Overfitting gap headline */}
      <details className="group rounded-lg border border-border bg-card/50 px-4 py-3">
        <summary className="flex cursor-pointer items-center justify-between list-none [&::-webkit-details-marker]:hidden">
          <span className="text-sm font-medium">Overfitting gap</span>
          <span className="flex items-center gap-1.5">
            <span className={`text-base font-semibold tabular-nums ${gapColor}`}>
              {gap >= 0 ? "+" : ""}
              {gap.toFixed(3)}
            </span>
            <span className="text-[10px] text-muted-foreground/50 group-open:rotate-180 transition-transform">
              ▾
            </span>
          </span>
        </summary>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Mean in-sample Sharpe minus mean out-of-sample Sharpe across all
          windows. A small or negative gap means the parameters that looked
          best in optimisation held up on unseen data. A large positive gap is
          the overfitting tell — the optimiser was fitting noise.
        </p>
      </details>

      {/* Per-window in-sample vs out-of-sample */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card/30 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">In-sample</th>
              <th className="px-3 py-2 font-medium">Out-of-sample</th>
              <th className="px-3 py-2 font-medium">Chosen</th>
              <th className="px-3 py-2 text-right font-medium">IS Sharpe</th>
              <th className="px-3 py-2 text-right font-medium">OOS Sharpe</th>
              <th className="px-3 py-2 text-right font-medium">OOS return</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {report.windows.map((w, i) => (
              <tr key={i} className="hover:bg-foreground/5 transition">
                <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
                  {w.inSampleRange.from} → {w.inSampleRange.to}
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
                  {w.outOfSampleRange.from} → {w.outOfSampleRange.to}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">
                  {w.chosenParams.fast}/{w.chosenParams.slow}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {w.inSampleMetrics.sharpe.toFixed(2)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {w.outOfSampleMetrics.sharpe.toFixed(2)}
                </td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums ${
                    w.outOfSampleMetrics.totalReturnPct >= 0
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {w.outOfSampleMetrics.totalReturnPct >= 0 ? "+" : ""}
                  {w.outOfSampleMetrics.totalReturnPct.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Aggregate out-of-sample — the honest result */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Aggregate out-of-sample (the honest result)
        </h3>
        <MetricsPanel metrics={report.aggregateOutOfSample} />
      </div>
    </div>
  );
}

export function WalkForwardRunner() {
  const [state, formAction, pending] = useActionState<
    WalkForwardState,
    FormData
  >(runWalkForwardAction, {});

  return (
    <div className="space-y-6">
      <form
        action={formAction}
        className="space-y-3 rounded-lg border border-border bg-card/50 p-4"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Ticker</span>
            <input
              name="ticker"
              defaultValue="AAPL"
              required
              className={`${INPUT} font-mono uppercase`}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">From</span>
            <input
              name="from"
              type="date"
              defaultValue={isoDaysAgo(1825)}
              required
              className={INPUT}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">To</span>
            <input
              name="to"
              type="date"
              defaultValue={isoDaysAgo(0)}
              required
              className={INPUT}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">
              In-sample bars
            </span>
            <input
              name="inSampleBars"
              type="number"
              defaultValue={252}
              min={30}
              max={2000}
              required
              className={INPUT}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">
              Out-of-sample bars
            </span>
            <input
              name="outOfSampleBars"
              type="number"
              defaultValue={63}
              min={10}
              max={1000}
              required
              className={INPUT}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">
              Initial capital
            </span>
            <input
              name="initialCapital"
              type="number"
              defaultValue={10000}
              min={1}
              required
              className={INPUT}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:opacity-50"
        >
          {pending ? "Running…" : "Run walk-forward"}
        </button>
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      </form>

      {state.report && <Report report={state.report} />}
    </div>
  );
}
