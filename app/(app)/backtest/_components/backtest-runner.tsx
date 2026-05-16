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

const INPUT =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/40";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

// Each metric: how to read its value, and the math behind it.
const METRIC_ROWS: {
  key: keyof BacktestRunView["metrics"];
  label: string;
  format: (v: number | null) => string;
  why: string;
}[] = [
  {
    key: "totalReturnPct",
    label: "Total return",
    format: (v) => `${(v as number).toFixed(2)}%`,
    why: "Total return = (final equity − initial capital) / initial capital. The whole-period result before annualising.",
  },
  {
    key: "cagrPct",
    label: "CAGR",
    format: (v) => `${(v as number).toFixed(2)}%`,
    why: "CAGR = (final / initial) ^ (1 / years) − 1. The constant annual rate that compounds to the same result.",
  },
  {
    key: "sharpe",
    label: "Sharpe",
    format: (v) => (v as number).toFixed(2),
    why: "Sharpe = mean daily return / std-dev of daily returns, annualised by √252. Risk-adjusted return, with the baseline cash rate assumed 0.",
  },
  {
    key: "sortino",
    label: "Sortino",
    format: (v) => (v as number).toFixed(2),
    why: "Sortino = mean daily return / downside deviation, annualised by √252. Like Sharpe, but only downside volatility is penalised.",
  },
  {
    key: "maxDrawdownPct",
    label: "Max drawdown",
    format: (v) => `${(v as number).toFixed(2)}%`,
    why: "Max drawdown = the largest peak-to-trough fall in equity — the worst loss you would have sat through.",
  },
  {
    key: "tradeCount",
    label: "Trades",
    format: (v) => String(v),
    why: "Number of completed round-trip trades in the run.",
  },
  {
    key: "winRatePct",
    label: "Win rate",
    format: (v) => `${(v as number).toFixed(1)}%`,
    why: "Win rate = winning trades / total trades — the share that closed with positive P/L.",
  },
  {
    key: "avgTradeReturnPct",
    label: "Avg trade return",
    format: (v) => `${(v as number).toFixed(2)}%`,
    why: "The mean return across all completed trades.",
  },
  {
    key: "expectancyPct",
    label: "Expectancy",
    format: (v) => `${(v as number).toFixed(2)}%`,
    why: "Expectancy = winRate × average win − lossRate × average loss. The expected return per trade.",
  },
  {
    key: "profitFactor",
    label: "Profit factor",
    format: (v) => (v == null ? "no losses" : v.toFixed(2)),
    why: "Profit factor = gross winning P/L / gross losing P/L. Above 1 means wins outweigh losses.",
  },
  {
    key: "exposurePct",
    label: "Exposure",
    format: (v) => `${(v as number).toFixed(1)}%`,
    why: "Exposure = days holding a position / total trading days — how much of the time capital was at work.",
  },
];

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
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fontSize: 10 }}
              width={56}
            />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(v) => [Number(v).toFixed(2), "Equity"]}
            />
            {initial > 0 && (
              <ReferenceLine y={initial} strokeDasharray="4 4" />
            )}
            <Line
              type="monotone"
              dataKey="equity"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-0.5 rounded-lg border border-border bg-card/50 px-3 py-2">
        {METRIC_ROWS.map((row) => {
          const value = result.metrics[row.key];
          return (
            <details key={row.key} className="group">
              <summary className="flex cursor-pointer items-center justify-between gap-2 py-1 list-none [&::-webkit-details-marker]:hidden">
                <span className="text-xs text-muted-foreground">
                  {row.label}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-sm tabular-nums">
                    {row.format(value as number | null)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50 group-open:rotate-180 transition-transform">
                    ▾
                  </span>
                </span>
              </summary>
              <p className="pb-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {row.why}
              </p>
            </details>
          );
        })}
      </div>
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
      <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card/50 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Ticker</span>
            <input name="ticker" defaultValue="AAPL" required className={`${INPUT} font-mono uppercase`} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Fast SMA</span>
            <input name="fast" type="number" defaultValue={50} min={2} max={200} required className={INPUT} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Slow SMA</span>
            <input name="slow" type="number" defaultValue={200} min={3} max={400} required className={INPUT} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">From</span>
            <input name="from" type="date" defaultValue={isoDaysAgo(1095)} required className={INPUT} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">To</span>
            <input name="to" type="date" defaultValue={isoDaysAgo(0)} required className={INPUT} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Initial capital</span>
            <input name="initialCapital" type="number" defaultValue={10000} min={1} required className={INPUT} />
          </label>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:opacity-50"
        >
          {pending ? "Running…" : "Run backtest"}
        </button>
        {state.error && (
          <p className="text-xs text-destructive">{state.error}</p>
        )}
      </form>

      {state.result && <Results result={state.result} />}
    </div>
  );
}
