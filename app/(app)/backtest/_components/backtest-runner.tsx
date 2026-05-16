"use client";

import { useActionState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import {
  runBacktestAction,
  type RunBacktestState,
  type BacktestRunView,
} from "../actions";
import { MetricsPanel } from "./metrics-panel";

const INPUT =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/40";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function Results({ result }: { result: BacktestRunView }) {
  const initial = result.equityCurve[0]?.equity ?? 0;
  return (
    <div className="space-y-5">
      <div className="text-sm text-muted-foreground">
        <span className="font-mono font-semibold text-foreground">
          {result.ticker}
        </span>{" "}
        · {result.strategy} · {result.barCount} bars · {result.tradeCount} trades
      </div>

      <div className="h-[220px] rounded-lg border border-border bg-card/50 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={result.equityCurve}>
            <XAxis dataKey="date" hide />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={56} />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(v) => [Number(v).toFixed(2), "Equity"]}
            />
            {initial > 0 && <ReferenceLine y={initial} strokeDasharray="4 4" />}
            <Line type="monotone" dataKey="equity" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <MetricsPanel metrics={result.metrics} />
    </div>
  );
}

export function BacktestRunner() {
  const [state, formAction, pending] = useActionState<
    RunBacktestState,
    FormData
  >(runBacktestAction, {});

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
            <span className="text-xs text-muted-foreground">Fast SMA</span>
            <input
              name="fast"
              type="number"
              defaultValue={50}
              min={2}
              max={200}
              required
              className={INPUT}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Slow SMA</span>
            <input
              name="slow"
              type="number"
              defaultValue={200}
              min={3}
              max={400}
              required
              className={INPUT}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">From</span>
            <input
              name="from"
              type="date"
              defaultValue={isoDaysAgo(1095)}
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
          {pending ? "Running…" : "Run backtest"}
        </button>
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      </form>

      {state.result && <Results result={state.result} />}
    </div>
  );
}
