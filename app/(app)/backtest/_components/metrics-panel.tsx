import type { BacktestMetrics } from "@/lib/backtest/metrics";

// A decomposed metrics panel — every metric expands to show its math,
// matching the product rule that no score is a black box. Shared by the
// single-backtest and walk-forward views.

const METRIC_ROWS: {
  key: keyof BacktestMetrics;
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

export function MetricsPanel({ metrics }: { metrics: BacktestMetrics }) {
  return (
    <div className="space-y-0.5 rounded-lg border border-border bg-card/50 px-3 py-2">
      {METRIC_ROWS.map((row) => (
        <details key={row.key} className="group">
          <summary className="flex cursor-pointer items-center justify-between gap-2 py-1 list-none [&::-webkit-details-marker]:hidden">
            <span className="text-xs text-muted-foreground">{row.label}</span>
            <span className="flex items-center gap-1.5">
              <span className="text-sm tabular-nums">
                {row.format(metrics[row.key] as number | null)}
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
      ))}
    </div>
  );
}
