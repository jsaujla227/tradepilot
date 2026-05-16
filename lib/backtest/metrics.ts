import type { BacktestResult } from "./engine";

// Performance metrics derived from a BacktestResult. Pure — no I/O, no clock.
// Annualisation assumes ~252 trading days per year.

const TRADING_DAYS = 252;

export type BacktestMetrics = {
  /** Total return over the whole run, percent. */
  totalReturnPct: number;
  /** Compound annual growth rate, percent. */
  cagrPct: number;
  /** Annualised Sharpe ratio (risk-free rate assumed 0). */
  sharpe: number;
  /** Annualised Sortino ratio (downside deviation only). */
  sortino: number;
  /** Worst peak-to-trough equity decline, percent (a positive number). */
  maxDrawdownPct: number;
  tradeCount: number;
  /** Share of trades with positive P/L, percent. */
  winRatePct: number;
  /** Mean per-trade return, percent. */
  avgTradeReturnPct: number;
  /** winRate x avgWin - lossRate x avgLoss, percent. */
  expectancyPct: number;
  /** Gross winning P/L over gross losing P/L; null when there are no losers. */
  profitFactor: number | null;
  /** Share of trading days holding a position, percent. */
  exposurePct: number;
};

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

/** Computes performance metrics for a completed backtest. */
export function computeMetrics(
  result: BacktestResult,
  initialCapital: number,
): BacktestMetrics {
  const { trades, equityCurve, finalEquity } = result;

  const totalReturnPct =
    initialCapital > 0
      ? ((finalEquity - initialCapital) / initialCapital) * 100
      : 0;

  // CAGR — needs a measurable time span.
  let cagrPct = 0;
  if (equityCurve.length >= 2 && initialCapital > 0 && finalEquity > 0) {
    const first = new Date(equityCurve[0]!.date).getTime();
    const last = new Date(equityCurve[equityCurve.length - 1]!.date).getTime();
    const years = (last - first) / (365.25 * 86_400_000);
    if (years > 0) {
      cagrPct = ((finalEquity / initialCapital) ** (1 / years) - 1) * 100;
    }
  }

  // Daily returns from the equity curve.
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    if (prev > 0) dailyReturns.push(equityCurve[i]!.equity / prev - 1);
  }
  const avgDaily = mean(dailyReturns);
  const sd = stdDev(dailyReturns);
  const sharpe = sd > 0 ? (avgDaily / sd) * Math.sqrt(TRADING_DAYS) : 0;

  const downsideDev = Math.sqrt(
    mean(dailyReturns.map((r) => (r < 0 ? r * r : 0))),
  );
  const sortino =
    downsideDev > 0 ? (avgDaily / downsideDev) * Math.sqrt(TRADING_DAYS) : 0;

  // Max drawdown over the equity curve.
  let peak = -Infinity;
  let maxDd = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    if (peak > 0) {
      const dd = (peak - point.equity) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }

  // Trade-level statistics.
  const tradeCount = trades.length;
  const winners = trades.filter((t) => t.pnl > 0);
  const losers = trades.filter((t) => t.pnl <= 0);
  const winFrac = tradeCount ? winners.length / tradeCount : 0;
  const avgWin = mean(winners.map((t) => t.returnPct));
  const avgLossAbs = Math.abs(mean(losers.map((t) => t.returnPct)));

  const grossWin = winners.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));

  // Exposure — share of trading days holding a position.
  const indexByDate = new Map<string, number>();
  equityCurve.forEach((p, i) => indexByDate.set(p.date, i));
  let daysInMarket = 0;
  for (const t of trades) {
    const entryIdx = indexByDate.get(t.entryDate);
    const exitIdx = indexByDate.get(t.exitDate);
    if (entryIdx != null && exitIdx != null && exitIdx > entryIdx) {
      daysInMarket += exitIdx - entryIdx;
    }
  }

  return {
    totalReturnPct,
    cagrPct,
    sharpe,
    sortino,
    maxDrawdownPct: maxDd * 100,
    tradeCount,
    winRatePct: tradeCount ? (winners.length / tradeCount) * 100 : 0,
    avgTradeReturnPct: mean(trades.map((t) => t.returnPct)) * 100,
    expectancyPct: (winFrac * avgWin - (1 - winFrac) * avgLossAbs) * 100,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    exposurePct: equityCurve.length
      ? (daysInMarket / equityCurve.length) * 100
      : 0,
  };
}
