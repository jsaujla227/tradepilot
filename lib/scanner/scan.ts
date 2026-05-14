import "server-only";
import { getQuote, type Quote } from "@/lib/finnhub/data";

// Momentum score: trend (55%) + volatility (45%).
// R-multiple and liquidity are excluded — the user has no setup defined
// for scanned tickers, so those dimensions would always be 0 / 0.5 and
// would bias the ranking without adding signal.

export type MomentumBreakdown = {
  trend: { value: number; rawLabel: string; why: string };
  volatility: { value: number; rawLabel: string; why: string };
};

export type ScanResult = {
  ticker: string;
  momentum: number;
  breakdown: MomentumBreakdown;
  quote: Quote;
};

const W = { trend: 0.55, volatility: 0.45 } as const;

function scoreTrend(price: number, prevClose: number | null): MomentumBreakdown["trend"] {
  if (prevClose == null || prevClose <= 0) {
    return { value: 0.5, rawLabel: "prev close unavailable", why: "No prev close data." };
  }
  const momentum = (price - prevClose) / prevClose;
  const clipped = Math.max(-0.03, Math.min(0.03, momentum));
  const value = (clipped + 0.03) / 0.06;
  const pctStr = (momentum * 100).toFixed(2);
  return {
    value,
    rawLabel: `${momentum >= 0 ? "+" : ""}${pctStr}% vs prev close`,
    why: `Momentum ${pctStr}%, clipped to ±3%, mapped 0–1. +3% → 1.0, 0% → 0.5, −3% → 0.`,
  };
}

function scoreVolatility(
  price: number,
  high: number | null,
  low: number | null,
): MomentumBreakdown["volatility"] {
  if (high == null || low == null || price <= 0) {
    return { value: 0.5, rawLabel: "high/low unavailable", why: "No intraday range data." };
  }
  const dayRange = (high - low) / price;
  const value = Math.max(0, Math.min(1, 1 - dayRange / 0.05));
  const rangePct = (dayRange * 100).toFixed(2);
  return {
    value,
    rawLabel: `Day range ${rangePct}%`,
    why: `Range ${rangePct}% of price. 0% → 1.0 (calm); ≥5% → 0.0 (high risk).`,
  };
}

function momentumScore(quote: Quote): { momentum: number; breakdown: MomentumBreakdown } {
  const trend = scoreTrend(quote.price, quote.prevClose);
  const volatility = scoreVolatility(quote.price, quote.high, quote.low);
  const raw = trend.value * W.trend + volatility.value * W.volatility;
  return {
    momentum: Math.round(raw * 1000) / 10,
    breakdown: { trend, volatility },
  };
}

/**
 * Scan a list of tickers with Finnhub rate limiting.
 * Fires BATCH_SIZE requests in parallel, then waits for the next window.
 * At 10 per 11 seconds → 54 calls/min, safely under Finnhub's 60/min free tier.
 */
const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 11_000;

export async function scanTickers(tickers: readonly string[]): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const batchStart = Date.now();

    const settled = await Promise.allSettled(
      batch.map(async (ticker) => {
        const { quote } = await getQuote(ticker);
        const { momentum, breakdown } = momentumScore(quote);
        return { ticker, momentum, breakdown, quote } satisfies ScanResult;
      }),
    );

    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      }
    }

    // Rate-limit: wait out the remainder of the 11-second window before next batch
    const elapsed = Date.now() - batchStart;
    const remaining = BATCH_INTERVAL_MS - elapsed;
    if (remaining > 0 && i + BATCH_SIZE < tickers.length) {
      await new Promise((r) => setTimeout(r, remaining));
    }
  }

  return results;
}
