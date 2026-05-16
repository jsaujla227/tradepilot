import type { HistoricalBar } from "./data";
import type { Strategy, Signal } from "./strategy";

// The backtest engine — a pure, deterministic bar-replay loop.
//
// TIMING MODEL (no lookahead): on day t the strategy sees history through
// day t's close and emits a signal. The engine acts on that signal at the
// OPEN of day t+1. A decision can therefore never use same-day or future
// information to set its own fill price. Equity is marked at each day's
// close. A position still open when the data ends is force-closed at the
// final bar's close so every trade is realised.
//
// Determinism: given the same (bars, strategy, config) the result is always
// identical — no clock, no randomness, no I/O.

export type BacktestConfig = {
  /** Starting cash. */
  initialCapital: number;
  /** Fraction of the fill price lost to slippage (0.001 = 0.1%). */
  slippage: number;
  /** Flat commission charged per fill, in currency units. */
  commission: number;
};

export const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 10_000,
  slippage: 0.0005,
  commission: 1,
};

export type Trade = {
  entryDate: string;
  /** Slippage-adjusted entry fill price. */
  entryPrice: number;
  exitDate: string;
  /** Slippage-adjusted exit fill price. */
  exitPrice: number;
  shares: number;
  /** Realised profit/loss in currency, net of both commissions. */
  pnl: number;
  /** pnl as a fraction of the capital deployed on entry. */
  returnPct: number;
};

export type EquityPoint = {
  date: string;
  /** Account value: cash plus any open position marked at the close. */
  equity: number;
};

export type BacktestResult = {
  trades: Trade[];
  equityCurve: EquityPoint[];
  finalEquity: number;
};

/** Runs `strategy` over `bars` (oldest-first) and returns the result. */
export function runBacktest(
  bars: readonly HistoricalBar[],
  strategy: Strategy,
  config: BacktestConfig = DEFAULT_CONFIG,
): BacktestResult {
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  if (bars.length === 0) {
    return { trades, equityCurve, finalEquity: config.initialCapital };
  }

  let cash = config.initialCapital;
  let shares = 0;
  let inPosition = false;
  let entryDate = "";
  let entryPrice = 0;
  let entryCost = 0; // shares * entry fill + commission
  let pending: Signal = "hold";

  for (let t = 0; t < bars.length; t++) {
    const bar = bars[t]!;

    // 1. Act on the previous day's decision at today's open.
    if (pending === "enter" && !inPosition) {
      const fill = bar.open * (1 + config.slippage);
      const affordable = Math.floor((cash - config.commission) / fill);
      if (affordable > 0) {
        shares = affordable;
        entryPrice = fill;
        entryCost = shares * fill + config.commission;
        cash -= entryCost;
        inPosition = true;
        entryDate = bar.date;
      }
    } else if (pending === "exit" && inPosition) {
      const fill = bar.open * (1 - config.slippage);
      const proceeds = shares * fill - config.commission;
      cash += proceeds;
      trades.push({
        entryDate,
        entryPrice,
        exitDate: bar.date,
        exitPrice: fill,
        shares,
        pnl: proceeds - entryCost,
        returnPct: (proceeds - entryCost) / entryCost,
      });
      shares = 0;
      inPosition = false;
    }

    // 2. Strategy decides from the causal history through today's close.
    pending = strategy.decide({
      history: bars.slice(0, t + 1),
      inPosition,
    });

    // 3. Mark equity at today's close.
    equityCurve.push({
      date: bar.date,
      equity: cash + (inPosition ? shares * bar.close : 0),
    });
  }

  // Force-close any position still open at the end of the data.
  if (inPosition) {
    const last = bars[bars.length - 1]!;
    const fill = last.close * (1 - config.slippage);
    const proceeds = shares * fill - config.commission;
    cash += proceeds;
    trades.push({
      entryDate,
      entryPrice,
      exitDate: last.date,
      exitPrice: fill,
      shares,
      pnl: proceeds - entryCost,
      returnPct: (proceeds - entryCost) / entryCost,
    });
    shares = 0;
    inPosition = false;
    equityCurve[equityCurve.length - 1] = { date: last.date, equity: cash };
  }

  return { trades, equityCurve, finalEquity: cash };
}
