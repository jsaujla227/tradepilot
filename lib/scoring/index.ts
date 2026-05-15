// Pure scoring functions. No side effects, no I/O.
// Every function is unit-tested in index.test.ts.

export type ScoreInput = {
  /** 0–1, higher = more favourable. */
  value: number;
  label: string;
  /** Short human-readable reading, e.g. "+1.2% vs prev close". */
  rawLabel: string;
  /** Full explanation of the math behind this input. */
  why: string;
  dataAvailable: boolean;
};

export type WatchlistScore = {
  /** 0–100, one decimal place. */
  total: number;
  trend: ScoreInput;
  volatility: ScoreInput;
  rMultiple: ScoreInput;
  liquidity: ScoreInput;
  eventRisk: ScoreInput;
  longTrend: ScoreInput;
  rsi: ScoreInput;
};

export type ScoreWatchlistItemInput = {
  price: number;
  prevClose: number | null;
  high: number | null;
  low: number | null;
  targetEntry: number | null;
  targetStop: number | null;
  targetPrice: number | null;
  /** Days until next scheduled earnings; null if unknown or none in window. */
  daysToEarnings: number | null;
  /** Average dollar volume from daily bars (volume × vwap). Null = not yet cached. */
  avgDollarVolume?: number | null;
  /** SMA50 from Massive API. Null = not yet cached. */
  sma50?: number | null;
  /** SMA200 from Massive API. Null = not yet cached. */
  sma200?: number | null;
  /** RSI-14 from Massive API. Null = not yet cached. */
  rsi14?: number | null;
};

// Watchlist weights — must sum to 1.
// M14: reweighted to accommodate longTrend + rsi; rMultiple and trend reduced.
const W_WATCHLIST = {
  trend: 0.20,
  volatility: 0.15,
  rMultiple: 0.20,
  liquidity: 0.10,
  eventRisk: 0.15,
  longTrend: 0.12,
  rsi: 0.08,
} as const;

// Scanner momentum weights — no R-multiple or liquidity (no setup defined).
// Added longTrend + rsi; trend + volatility weights reduced accordingly.
const W_MOMENTUM = {
  trend: 0.35,
  volatility: 0.25,
  eventRisk: 0.20,
  longTrend: 0.12,
  rsi: 0.08,
} as const;

// -- Trend (watchlist 20%, momentum 35%) ------------------------------------
// Day momentum clipped to ±3 %. Positive = better.
// +3 % → 1.0  |  0 % → 0.5  |  −3 % → 0.0
function scoreTrend(price: number, prevClose: number | null): ScoreInput {
  if (prevClose == null || prevClose <= 0) {
    return {
      value: 0.5,
      label: "Trend",
      rawLabel: "prev close unavailable",
      why: "Prev close not available from data vendor — score held at 0.5 (neutral).",
      dataAvailable: false,
    };
  }
  const momentum = (price - prevClose) / prevClose;
  const clipped = Math.max(-0.03, Math.min(0.03, momentum));
  const value = (clipped + 0.03) / 0.06;
  const pctStr = (momentum * 100).toFixed(2);
  return {
    value,
    label: "Trend",
    rawLabel: `${momentum >= 0 ? "+" : ""}${pctStr}% vs prev close`,
    why: `Momentum = (price − prevClose) / prevClose = ${pctStr}%. Clipped to ±3 %, mapped linearly to 0–1. +3 % scores 1.0, 0 % scores 0.5, −3 % scores 0.`,
    dataAvailable: true,
  };
}

// -- Volatility (watchlist 15%, momentum 25%) -------------------------------
// Day range (high − low) / price. Smaller range = calmer = higher score.
// 0 % range → 1.0  |  ≥5 % range → 0.0
function scoreVolatility(
  price: number,
  high: number | null,
  low: number | null,
): ScoreInput {
  if (high == null || low == null || price <= 0) {
    return {
      value: 0.5,
      label: "Volatility",
      rawLabel: "high/low unavailable",
      why: "Day high/low not available from data vendor — score held at 0.5 (neutral).",
      dataAvailable: false,
    };
  }
  const dayRange = (high - low) / price;
  const value = Math.max(0, Math.min(1, 1 - dayRange / 0.05));
  const rangePct = (dayRange * 100).toFixed(2);
  return {
    value,
    label: "Volatility",
    rawLabel: `Day range ${rangePct}%`,
    why: `Day range = (high − low) / price = (${high} − ${low}) / ${price} = ${rangePct}%. Range of 0 % scores 1 (calm); ≥5 % scores 0 (high risk). Lower volatility = higher score.`,
    dataAvailable: true,
  };
}

// -- R-multiple (watchlist 20%) ---------------------------------------------
// Planned R = |target − entry| / |entry − stop|.
// 0R → 0.0  |  3R → 1.0  (capped)
function scoreRMultiple(
  targetEntry: number | null,
  targetStop: number | null,
  targetPrice: number | null,
): ScoreInput {
  if (
    targetEntry == null ||
    targetStop == null ||
    targetPrice == null ||
    targetEntry <= 0 ||
    targetStop <= 0 ||
    targetPrice <= 0 ||
    targetEntry === targetStop
  ) {
    return {
      value: 0,
      label: "R-multiple",
      rawLabel: "entry / stop / target not set",
      why: "Set a target entry, stop, and target price on the watchlist item to compute planned R.",
      dataAvailable: false,
    };
  }
  const isLong = targetEntry > targetStop;
  const validTarget = isLong ? targetPrice > targetEntry : targetPrice < targetEntry;
  if (!validTarget) {
    return {
      value: 0,
      label: "R-multiple",
      rawLabel: "target on wrong side of entry",
      why: `For a ${isLong ? "long" : "short"} setup (stop ${isLong ? "below" : "above"} entry), the target must be ${isLong ? "above" : "below"} entry. Current target ${targetPrice} is on the wrong side — setup is invalid.`,
      dataAvailable: false,
    };
  }
  const r = Math.abs(targetEntry - targetStop);
  const plannedR = Math.abs(targetPrice - targetEntry) / r;
  const value = Math.max(0, Math.min(1, plannedR / 3));
  return {
    value,
    label: "R-multiple",
    rawLabel: `${plannedR.toFixed(2)}R planned`,
    why: `Planned R = |target − entry| / |entry − stop| = |${targetPrice} − ${targetEntry}| / |${targetEntry} − ${targetStop}| = ${plannedR.toFixed(2)}R. 3R scores 1.0; 0R scores 0.`,
    dataAvailable: true,
  };
}

// -- Liquidity (watchlist 10%) ----------------------------------------------
// Average dollar volume from daily bars (volume × vwap).
// Requires Massive API daily bars. Falls back to neutral when unavailable.
// Thresholds calibrated to US large/mid/small-cap typical dollar volumes:
//   ≥$100M/day → 1.0 (very liquid, tight spreads)
//   ≥$10M/day  → 0.7 (liquid)
//   ≥$1M/day   → 0.4 (tradeable but watch spreads)
//   <$1M/day   → 0.1 (illiquid — avoid)
function scoreLiquidity(avgDollarVolume?: number | null): ScoreInput {
  if (avgDollarVolume == null) {
    return {
      value: 0.5,
      label: "Liquidity",
      rawLabel: "bars data pending",
      why: "Average dollar volume requires daily bars from Massive API. Cache warms at 09:30 UTC — score held at 0.5 (neutral) until available.",
      dataAvailable: false,
    };
  }
  const m = 1_000_000;
  let value: number;
  let rawLabel: string;
  if (avgDollarVolume >= 100 * m) {
    value = 1.0;
    rawLabel = `$${(avgDollarVolume / m).toFixed(0)}M avg vol`;
  } else if (avgDollarVolume >= 10 * m) {
    value = 0.7;
    rawLabel = `$${(avgDollarVolume / m).toFixed(0)}M avg vol`;
  } else if (avgDollarVolume >= m) {
    value = 0.4;
    rawLabel = `$${(avgDollarVolume / m).toFixed(1)}M avg vol`;
  } else {
    value = 0.1;
    rawLabel = `$${(avgDollarVolume / 1000).toFixed(0)}K avg vol`;
  }
  return {
    value,
    label: "Liquidity",
    rawLabel,
    why: `Avg dollar volume = volume × vwap = $${(avgDollarVolume / m).toFixed(2)}M. ≥$100M scores 1.0; ≥$10M scores 0.7; ≥$1M scores 0.4; below $1M scores 0.1 (illiquid).`,
    dataAvailable: true,
  };
}

// -- Long trend / SMA (watchlist 12%, momentum 12%) -------------------------
// Compares price to SMA50 and SMA200 (golden cross / death cross logic).
// price > SMA50 > SMA200 → strong uptrend → 1.0
// price > SMA50, SMA50 ≤ SMA200 → recovering → 0.6
// price ≤ SMA50, SMA50 > SMA200 → pulling back → 0.4
// price ≤ SMA50 ≤ SMA200 → downtrend → 0.1
function scoreLongTrend(
  price: number,
  sma50: number | null | undefined,
  sma200: number | null | undefined,
): ScoreInput {
  if (sma50 == null || sma200 == null) {
    return {
      value: 0.5,
      label: "Long trend",
      rawLabel: "SMA data pending",
      why: "SMA50/200 from Massive API not yet cached. Score held at 0.5 (neutral). Cache warms at 09:30 UTC.",
      dataAvailable: false,
    };
  }
  const aboveSma50 = price > sma50;
  const sma50AboveSma200 = sma50 > sma200;

  let value: number;
  let rawLabel: string;
  let why: string;

  if (aboveSma50 && sma50AboveSma200) {
    value = 1.0;
    rawLabel = "Price > SMA50 > SMA200";
    why = `Price (${price.toFixed(2)}) is above SMA50 (${sma50.toFixed(2)}) which is above SMA200 (${sma200.toFixed(2)}) — classic uptrend / golden-cross alignment. Scores 1.0.`;
  } else if (aboveSma50 && !sma50AboveSma200) {
    value = 0.6;
    rawLabel = "Price > SMA50, SMA50 < SMA200";
    why = `Price (${price.toFixed(2)}) is above SMA50 (${sma50.toFixed(2)}) but SMA50 is still below SMA200 (${sma200.toFixed(2)}) — short-term strength in a longer downtrend. Scores 0.6.`;
  } else if (!aboveSma50 && sma50AboveSma200) {
    value = 0.4;
    rawLabel = "Price < SMA50, SMA50 > SMA200";
    why = `Price (${price.toFixed(2)}) is below SMA50 (${sma50.toFixed(2)}) but the longer trend is still up (SMA50 > SMA200 ${sma200.toFixed(2)}) — pullback within an uptrend. Scores 0.4.`;
  } else {
    value = 0.1;
    rawLabel = "Price < SMA50 < SMA200";
    why = `Price (${price.toFixed(2)}) is below SMA50 (${sma50.toFixed(2)}) which is below SMA200 (${sma200.toFixed(2)}) — downtrend / death-cross. Scores 0.1.`;
  }

  return { value, label: "Long trend", rawLabel, why, dataAvailable: true };
}

// -- RSI (watchlist 8%, momentum 8%) ----------------------------------------
// RSI-14 from Massive API.
// < 30  = oversold → 0.65 (mean-reversion opportunity, moderate caution)
// 30–50 = neutral-bearish → 0.5
// 50–70 = neutral-bullish → 0.8
// > 70  = overbought → 0.2
function scoreRsi(rsi14: number | null | undefined): ScoreInput {
  if (rsi14 == null) {
    return {
      value: 0.5,
      label: "RSI",
      rawLabel: "RSI pending",
      why: "RSI-14 from Massive API not yet cached. Score held at 0.5 (neutral). Cache warms at 09:30 UTC.",
      dataAvailable: false,
    };
  }
  const rsiStr = rsi14.toFixed(1);
  if (rsi14 < 30) {
    return {
      value: 0.65,
      label: "RSI",
      rawLabel: `RSI ${rsiStr} (oversold)`,
      why: `RSI-14 = ${rsiStr}. Below 30 = oversold — potential mean-reversion entry but could keep falling. Scores 0.65 (moderate opportunity, elevated risk).`,
      dataAvailable: true,
    };
  }
  if (rsi14 < 50) {
    return {
      value: 0.5,
      label: "RSI",
      rawLabel: `RSI ${rsiStr} (neutral-bearish)`,
      why: `RSI-14 = ${rsiStr}. Between 30–50 = below midline, mild bearish momentum. Scores 0.5.`,
      dataAvailable: true,
    };
  }
  if (rsi14 <= 70) {
    return {
      value: 0.8,
      label: "RSI",
      rawLabel: `RSI ${rsiStr} (neutral-bullish)`,
      why: `RSI-14 = ${rsiStr}. Between 50–70 = above midline with room to run. Scores 0.8.`,
      dataAvailable: true,
    };
  }
  return {
    value: 0.2,
    label: "RSI",
    rawLabel: `RSI ${rsiStr} (overbought)`,
    why: `RSI-14 = ${rsiStr}. Above 70 = overbought — elevated reversal risk. Scores 0.2.`,
    dataAvailable: true,
  };
}

// -- Event risk (watchlist 15%, momentum 20%) -------------------------------
// Distance to the next known earnings announcement. Closer = riskier.
//   no known earnings within window → 0.5 neutral, dataAvailable false
//   > 5 days  → 1.0 (clear)
//   3 < d ≤ 5 → 0.5 (caution)
//   0 ≤ d ≤ 3 → 0.0 (gap risk)
function scoreEventRisk(daysToEarnings: number | null): ScoreInput {
  if (daysToEarnings == null) {
    return {
      value: 0.5,
      label: "Event risk",
      rawLabel: "no earnings in next 30d",
      why: "No earnings announcement found in the next 30 days. Score held at 0.5 (neutral) — known event risk only, doesn't cover macro events or unscheduled news.",
      dataAvailable: false,
    };
  }
  if (daysToEarnings > 5) {
    return {
      value: 1.0,
      label: "Event risk",
      rawLabel: `Earnings in ${daysToEarnings}d`,
      why: `Next earnings is ${daysToEarnings} days away — outside the 5-day overnight-gap window. Scores 1.0 (clear).`,
      dataAvailable: true,
    };
  }
  if (daysToEarnings > 3) {
    return {
      value: 0.5,
      label: "Event risk",
      rawLabel: `Earnings in ${daysToEarnings}d`,
      why: `Next earnings is ${daysToEarnings} days away — inside the 5-day caution window. Earnings can gap stops at the open. Scores 0.5 (caution).`,
      dataAvailable: true,
    };
  }
  return {
    value: 0.0,
    label: "Event risk",
    rawLabel: `Earnings in ${daysToEarnings}d`,
    why: `Next earnings is ${daysToEarnings} days away — inside the 3-day gap-risk window. An earnings move can open past your stop. Scores 0.0 (high risk).`,
    dataAvailable: true,
  };
}

// -- Composite (watchlist) --------------------------------------------------

export function scoreWatchlistItem(
  input: ScoreWatchlistItemInput,
): WatchlistScore {
  const trend = scoreTrend(input.price, input.prevClose);
  const volatility = scoreVolatility(input.price, input.high, input.low);
  const rMultiple = scoreRMultiple(
    input.targetEntry,
    input.targetStop,
    input.targetPrice,
  );
  const liquidity = scoreLiquidity(input.avgDollarVolume);
  const eventRisk = scoreEventRisk(input.daysToEarnings);
  const longTrend = scoreLongTrend(input.price, input.sma50, input.sma200);
  const rsi = scoreRsi(input.rsi14);

  const total =
    trend.value * W_WATCHLIST.trend +
    volatility.value * W_WATCHLIST.volatility +
    rMultiple.value * W_WATCHLIST.rMultiple +
    liquidity.value * W_WATCHLIST.liquidity +
    eventRisk.value * W_WATCHLIST.eventRisk +
    longTrend.value * W_WATCHLIST.longTrend +
    rsi.value * W_WATCHLIST.rsi;

  return {
    total: Math.round(total * 1000) / 10, // 0–100, 1 decimal
    trend,
    volatility,
    rMultiple,
    liquidity,
    eventRisk,
    longTrend,
    rsi,
  };
}

// -- Composite (scanner momentum) -------------------------------------------

export type MomentumBreakdown = {
  trend: { value: number; rawLabel: string; why: string };
  volatility: { value: number; rawLabel: string; why: string };
  eventRisk: { value: number; rawLabel: string; why: string };
  longTrend: { value: number; rawLabel: string; why: string };
  rsi: { value: number; rawLabel: string; why: string };
};

export type ScoreMomentumInput = {
  price: number;
  prevClose: number | null;
  high: number | null;
  low: number | null;
  daysToEarnings: number | null;
  sma50?: number | null;
  sma200?: number | null;
  rsi14?: number | null;
};

/**
 * Lightweight momentum score for the daily scanner. No R-multiple / liquidity
 * (the scanner has no user setup data). Identical scoring math as the watchlist
 * score so the two surfaces stay consistent.
 */
export function scoreMomentum(input: ScoreMomentumInput): {
  momentum: number;
  breakdown: MomentumBreakdown;
} {
  const trend = scoreTrend(input.price, input.prevClose);
  const volatility = scoreVolatility(input.price, input.high, input.low);
  const eventRisk = scoreEventRisk(input.daysToEarnings);
  const longTrend = scoreLongTrend(input.price, input.sma50, input.sma200);
  const rsi = scoreRsi(input.rsi14);

  const raw =
    trend.value * W_MOMENTUM.trend +
    volatility.value * W_MOMENTUM.volatility +
    eventRisk.value * W_MOMENTUM.eventRisk +
    longTrend.value * W_MOMENTUM.longTrend +
    rsi.value * W_MOMENTUM.rsi;

  return {
    momentum: Math.round(raw * 1000) / 10,
    breakdown: {
      trend: { value: trend.value, rawLabel: trend.rawLabel, why: trend.why },
      volatility: {
        value: volatility.value,
        rawLabel: volatility.rawLabel,
        why: volatility.why,
      },
      eventRisk: {
        value: eventRisk.value,
        rawLabel: eventRisk.rawLabel,
        why: eventRisk.why,
      },
      longTrend: {
        value: longTrend.value,
        rawLabel: longTrend.rawLabel,
        why: longTrend.why,
      },
      rsi: {
        value: rsi.value,
        rawLabel: rsi.rawLabel,
        why: rsi.why,
      },
    },
  };
}
