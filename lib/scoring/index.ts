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
};

export type ScoreWatchlistItemInput = {
  price: number;
  prevClose: number | null;
  high: number | null;
  low: number | null;
  targetEntry: number | null;
  targetStop: number | null;
  targetPrice: number | null;
};

// Weights must sum to 1.
const W = { trend: 0.30, volatility: 0.25, rMultiple: 0.30, liquidity: 0.15 } as const;

// -- Trend (30%) -----------------------------------------------------------
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

// -- Volatility (25%) ------------------------------------------------------
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

// -- R-multiple (30%) ------------------------------------------------------
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

// -- Liquidity (15%) -------------------------------------------------------
// Requires daily bars (avg dollar volume). Not available on Finnhub free tier.
function scoreLiquidity(): ScoreInput {
  return {
    value: 0.5,
    label: "Liquidity",
    rawLabel: "bars data unavailable",
    why: "Average dollar volume requires daily bars. Not available on Finnhub free tier — held at 0.5 (neutral). Will be wired when a bars vendor is added.",
    dataAvailable: false,
  };
}

// -- Composite -------------------------------------------------------------

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
  const liquidity = scoreLiquidity();

  const total =
    trend.value * W.trend +
    volatility.value * W.volatility +
    rMultiple.value * W.rMultiple +
    liquidity.value * W.liquidity;

  return {
    total: Math.round(total * 1000) / 10, // 0–100, 1 decimal
    trend,
    volatility,
    rMultiple,
    liquidity,
  };
}
