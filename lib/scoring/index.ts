// Pure scoring functions. No side effects, no I/O.
// Every function is unit-tested in index.test.ts.

import type { BarStats } from "@/lib/market-data/bar-stats";
import { formatDollarVolume } from "@/lib/format";

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
  /** Optional bar-derived stats. When supplied, upgrades the trend / volatility /
   *  liquidity scores from neutral day-only placeholders to bar-backed values. */
  bars?: BarStats | null;
};

// Watchlist weights — must sum to 1.
const W_WATCHLIST = {
  trend: 0.25,
  volatility: 0.20,
  rMultiple: 0.25,
  liquidity: 0.10,
  eventRisk: 0.20,
} as const;

// Scanner momentum weights — no R-multiple or liquidity (no setup defined).
const W_MOMENTUM = {
  trend: 0.45,
  volatility: 0.35,
  eventRisk: 0.20,
} as const;

// -- Trend (watchlist 25%, momentum 45%) ------------------------------------
// Bar-backed version: blend day momentum (50%) with SMA stack (50%).
//   SMA stack: price > sma50 > sma200 → 1.0
//              price > sma50 only      → 0.7
//              price > sma200 only     → 0.5
//              price < sma50 < sma200  → 0.0
//              all other configurations → 0.3 (mixed/transitional)
function scoreTrendWithBars(
  price: number,
  prevClose: number | null,
  sma50: number | null,
  sma200: number | null,
): ScoreInput {
  if (sma50 == null && sma200 == null) {
    return scoreTrend(price, prevClose);
  }
  const dayPart = scoreTrend(price, prevClose);
  let stackValue: number;
  let stackLabel: string;
  if (sma50 != null && sma200 != null) {
    if (price > sma50 && sma50 > sma200) {
      stackValue = 1.0;
      stackLabel = `price > SMA50 ($${sma50.toFixed(2)}) > SMA200 ($${sma200.toFixed(2)}) — uptrend stack`;
    } else if (price < sma50 && sma50 < sma200) {
      stackValue = 0.0;
      stackLabel = `price < SMA50 ($${sma50.toFixed(2)}) < SMA200 ($${sma200.toFixed(2)}) — downtrend stack`;
    } else if (price > sma200) {
      stackValue = 0.5;
      stackLabel = `price above SMA200 ($${sma200.toFixed(2)}) only — mixed`;
    } else {
      stackValue = 0.3;
      stackLabel = `mixed SMA configuration (price ${price < sma200 ? "<" : ">"} SMA200)`;
    }
  } else if (sma50 != null) {
    stackValue = price > sma50 ? 0.7 : 0.3;
    stackLabel = `price ${price > sma50 ? ">" : "<"} SMA50 ($${sma50.toFixed(2)}) — partial signal`;
  } else {
    // sma200 only
    stackValue = price > sma200! ? 0.5 : 0.2;
    stackLabel = `price ${price > sma200! ? ">" : "<"} SMA200 ($${sma200!.toFixed(2)}) — partial signal`;
  }
  const value = 0.5 * dayPart.value + 0.5 * stackValue;
  return {
    value,
    label: "Trend",
    rawLabel: `${dayPart.rawLabel} · ${stackLabel.split(" — ")[1] ?? "SMA stack"}`,
    why: `Trend = 50 % day momentum + 50 % SMA stack. Day part: ${dayPart.rawLabel} → ${dayPart.value.toFixed(2)}. SMA stack: ${stackLabel} → ${stackValue.toFixed(2)}. Combined: ${value.toFixed(2)}.`,
    dataAvailable: dayPart.dataAvailable,
  };
}

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

// -- Volatility (watchlist 20%, momentum 35%) -------------------------------
// Bar-backed version: blend day-range volatility (50%) with annualized 20-day
// historical vol (50%).
//   20 %/yr → 1.0 (calm)  |  60 %/yr → 0.0 (turbulent)
function scoreVolatilityWithBars(
  price: number,
  high: number | null,
  low: number | null,
  historicalVol20: number | null,
): ScoreInput {
  if (historicalVol20 == null) {
    return scoreVolatility(price, high, low);
  }
  const dayPart = scoreVolatility(price, high, low);
  const annVol = historicalVol20;
  const hvValue = Math.max(0, Math.min(1, 1 - (annVol - 0.2) / 0.4));
  const value = 0.5 * dayPart.value + 0.5 * hvValue;
  const annPct = (annVol * 100).toFixed(1);
  return {
    value,
    label: "Volatility",
    rawLabel: `${dayPart.rawLabel} · 20-d HV ${annPct}%/yr`,
    why: `Volatility = 50 % day range + 50 % 20-day historical vol. Day part: ${dayPart.rawLabel} → ${dayPart.value.toFixed(2)}. HV part: ${annPct}%/yr annualised — 20 %/yr scores 1, 60 %/yr scores 0 → ${hvValue.toFixed(2)}. Combined: ${value.toFixed(2)}.`,
    dataAvailable: true,
  };
}

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

// -- R-multiple (watchlist 25%) ---------------------------------------------
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
// Average daily $ volume over 20 bars. Massive.com bars feed this.
//   ≥ $50 M/day → 1.0 (mega-cap, frictionless)
//   $5 M/day    → 0.5 (decent mid-cap)
//   ≤ $200 k    → 0.0 (illiquid — slippage risk on retail-size orders)
// Log-scale mapping handles the 6 orders of magnitude between micro and mega.
function scoreLiquidity(avgDollarVolume: number | null = null): ScoreInput {
  if (avgDollarVolume == null || avgDollarVolume <= 0) {
    return {
      value: 0.5,
      label: "Liquidity",
      rawLabel: "bars data unavailable",
      why: "Average dollar volume requires daily bars. Set MASSIVE_API_KEY to enable — held at 0.5 (neutral) until bars are available.",
      dataAvailable: false,
    };
  }
  // log10(200_000) ≈ 5.30; log10(50_000_000) ≈ 7.70 → span of 2.40
  const log = Math.log10(avgDollarVolume);
  const value = Math.max(0, Math.min(1, (log - 5.3) / 2.4));
  const fmt = formatDollarVolume(avgDollarVolume);
  return {
    value,
    label: "Liquidity",
    rawLabel: `${fmt}/day avg`,
    why: `Average dollar volume over the last 20 daily bars is ${fmt}/day. log10 scale: $200 k/day scores 0, $50 M/day scores 1. Larger volume = lower slippage = higher score → ${value.toFixed(2)}.`,
    dataAvailable: true,
  };
}

// -- Event risk (watchlist 20%, momentum 20%) -------------------------------
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
  const bars = input.bars ?? null;
  const trend = scoreTrendWithBars(
    input.price,
    input.prevClose,
    bars?.sma50 ?? null,
    bars?.sma200 ?? null,
  );
  const volatility = scoreVolatilityWithBars(
    input.price,
    input.high,
    input.low,
    bars?.historicalVol20 ?? null,
  );
  const rMultiple = scoreRMultiple(
    input.targetEntry,
    input.targetStop,
    input.targetPrice,
  );
  const liquidity = scoreLiquidity(bars?.avgDollarVolume ?? null);
  const eventRisk = scoreEventRisk(input.daysToEarnings);

  const total =
    trend.value * W_WATCHLIST.trend +
    volatility.value * W_WATCHLIST.volatility +
    rMultiple.value * W_WATCHLIST.rMultiple +
    liquidity.value * W_WATCHLIST.liquidity +
    eventRisk.value * W_WATCHLIST.eventRisk;

  return {
    total: Math.round(total * 1000) / 10, // 0–100, 1 decimal
    trend,
    volatility,
    rMultiple,
    liquidity,
    eventRisk,
  };
}

// -- Composite (scanner momentum) -------------------------------------------

export type MomentumBreakdown = {
  trend: { value: number; rawLabel: string; why: string };
  volatility: { value: number; rawLabel: string; why: string };
  eventRisk: { value: number; rawLabel: string; why: string };
};

export type ScoreMomentumInput = {
  price: number;
  prevClose: number | null;
  high: number | null;
  low: number | null;
  daysToEarnings: number | null;
  /** Optional bar-derived stats; upgrades trend/volatility when supplied. */
  bars?: BarStats | null;
};

/**
 * Lightweight momentum score for the daily scanner. No R-multiple / liquidity
 * (the scanner has no user setup data). Identical trend/volatility/eventRisk
 * math as the watchlist score so the two surfaces stay consistent.
 */
export function scoreMomentum(input: ScoreMomentumInput): {
  momentum: number;
  breakdown: MomentumBreakdown;
} {
  const bars = input.bars ?? null;
  const trend = scoreTrendWithBars(
    input.price,
    input.prevClose,
    bars?.sma50 ?? null,
    bars?.sma200 ?? null,
  );
  const volatility = scoreVolatilityWithBars(
    input.price,
    input.high,
    input.low,
    bars?.historicalVol20 ?? null,
  );
  const eventRisk = scoreEventRisk(input.daysToEarnings);

  const raw =
    trend.value * W_MOMENTUM.trend +
    volatility.value * W_MOMENTUM.volatility +
    eventRisk.value * W_MOMENTUM.eventRisk;

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
    },
  };
}
