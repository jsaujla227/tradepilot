import type { HistoricalBar } from "./data";
import { runBacktest, type EquityPoint } from "./engine";
import { computeMetrics, type BacktestMetrics } from "./metrics";
import { smaCrossover } from "./strategies/sma-crossover";

// Forward paper-trading run for a strategy in the `paper` lifecycle stage.
//
// A paper run is just a backtest over bars that all post-date the strategy's
// paper-start date — so it is genuine forward, out-of-sample evidence: none of
// these bars existed when the strategy was created and backtested. Recomputing
// it as the bar history grows extends the forward track record.

export type PaperRun = {
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  barCount: number;
};

const PAPER_CONFIG = {
  initialCapital: 10_000,
  slippage: 0.0005,
  commission: 1,
} as const;

/** Computes the forward paper run of an SMA strategy over the given bars. */
export function paperRun(
  bars: readonly HistoricalBar[],
  fast: number,
  slow: number,
): PaperRun {
  const result = runBacktest(bars, smaCrossover(fast, slow), PAPER_CONFIG);
  return {
    metrics: computeMetrics(result, PAPER_CONFIG.initialCapital),
    equityCurve: result.equityCurve,
    barCount: bars.length,
  };
}
