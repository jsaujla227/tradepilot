// Pure derivations from a bar series. No I/O, no side effects — fully
// unit-tested. Consumed by the scoring engine (volume-based liquidity,
// SMA-50/SMA-200 trend, ATR-based volatility) and by the agent (ATR stops).

import type { Bar } from "./massive";

export type BarStats = {
  /** Average daily $ volume over the last `avgWindow` bars (default 20). */
  avgDollarVolume: number | null;
  /** Annualized standard deviation of log returns over 20 bars. 0.2 = 20 %/yr. */
  historicalVol20: number | null;
  /** Wilder-smoothed 14-period ATR in price units, or null when <15 bars. */
  atr14: number | null;
  /** Simple moving average of close over 50 bars, null when <50 bars. */
  sma50: number | null;
  /** Simple moving average of close over 200 bars, null when <200 bars. */
  sma200: number | null;
  /** Most recent close used as the price reference for ratios. */
  lastClose: number | null;
  /** Number of bars used to compute the stats — surfaced for transparency. */
  barCount: number;
};

export const EMPTY_BAR_STATS: BarStats = {
  avgDollarVolume: null,
  historicalVol20: null,
  atr14: null,
  sma50: null,
  sma200: null,
  lastClose: null,
  barCount: 0,
};

function sma(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = sma(values);
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Average daily $ volume across the last `window` bars. Returns null when the
 * series is shorter than `window`. Uses the bar's close as the price reference
 * (matches the convention chart vendors use).
 */
function computeAvgDollarVolume(bars: Bar[], window = 20): number | null {
  if (bars.length < window) return null;
  const tail = bars.slice(-window);
  const total = tail.reduce((s, b) => s + b.close * b.volume, 0);
  return total / window;
}

/**
 * Annualized historical volatility from `window` log returns. 252 trading
 * days per year is the standard convention. Returns null when <`window+1` bars.
 */
function computeHistoricalVol(bars: Bar[], window = 20): number | null {
  if (bars.length < window + 1) return null;
  const tail = bars.slice(-(window + 1));
  const logReturns: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    const prev = tail[i - 1]!.close;
    const curr = tail[i]!.close;
    if (prev <= 0 || curr <= 0) return null;
    logReturns.push(Math.log(curr / prev));
  }
  return stdev(logReturns) * Math.sqrt(252);
}

/**
 * Wilder-smoothed 14-period ATR. True range for bar i is max of:
 *   high - low, |high - prevClose|, |low - prevClose|.
 * The first ATR is the simple average of the first 14 TRs; subsequent values
 * smooth as ATR_i = (ATR_{i-1} × 13 + TR_i) / 14.
 */
function computeATR(bars: Bar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.close;
    const b = bars[i]!;
    const tr = Math.max(
      b.high - b.low,
      Math.abs(b.high - prev),
      Math.abs(b.low - prev),
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;
  // Seed with simple average of the first `period` TRs
  let atr = sma(trs.slice(0, period));
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]!) / period;
  }
  return atr;
}

function computeSMA(bars: Bar[], window: number): number | null {
  if (bars.length < window) return null;
  const closes = bars.slice(-window).map((b) => b.close);
  return sma(closes);
}

export function computeBarStats(bars: Bar[]): BarStats {
  if (bars.length === 0) return { ...EMPTY_BAR_STATS };
  const last = bars[bars.length - 1]!;
  return {
    avgDollarVolume: computeAvgDollarVolume(bars, 20),
    historicalVol20: computeHistoricalVol(bars, 20),
    atr14: computeATR(bars, 14),
    sma50: computeSMA(bars, 50),
    sma200: computeSMA(bars, 200),
    lastClose: last.close,
    barCount: bars.length,
  };
}

/**
 * Suggested stop price = entry − multiplier × ATR for longs, entry + … for
 * shorts. Returns null when ATR is unavailable.
 */
export function suggestStopFromAtr(args: {
  entry: number;
  atr14: number | null;
  side: "long" | "short";
  multiplier?: number;
}): number | null {
  if (args.atr14 == null || args.atr14 <= 0) return null;
  const m = args.multiplier ?? 2;
  return args.side === "long"
    ? args.entry - m * args.atr14
    : args.entry + m * args.atr14;
}
