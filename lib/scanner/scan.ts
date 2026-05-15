import "server-only";
import { getQuote, type Quote } from "@/lib/finnhub/data";
import { getEarningsContext } from "@/lib/finnhub/context";
import { getIndicators } from "@/lib/massive/indicators";
import { scoreMomentum, type MomentumBreakdown } from "@/lib/scoring";

// Scanner uses the shared `scoreMomentum` function from lib/scoring so that
// trend/volatility/eventRisk math is identical to the watchlist surface.
// Earnings context is read through Upstash — the daily context-refresh cron
// warms the cache, so a typical scan does at most 1 Finnhub call per ticker
// (the quote itself). A cache miss falls through to a fresh fetch; that's
// rare and absorbed by the rate-limited batch loop below.

export type ScanResult = {
  ticker: string;
  momentum: number;
  breakdown: MomentumBreakdown;
  quote: Quote;
};

const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 11_000;

export async function scanTickers(tickers: readonly string[]): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const batchStart = Date.now();

    const settled = await Promise.allSettled(
      batch.map(async (ticker) => {
        const [{ quote }, earnings, indicators] = await Promise.all([
          getQuote(ticker),
          getEarningsContext(ticker),
          getIndicators(ticker).catch(() => ({ sma50: null, sma200: null, rsi14: null })),
        ]);
        const { momentum, breakdown } = scoreMomentum({
          price: quote.price,
          prevClose: quote.prevClose,
          high: quote.high,
          low: quote.low,
          daysToEarnings: earnings?.daysUntil ?? null,
          sma50: indicators.sma50,
          sma200: indicators.sma200,
          rsi14: indicators.rsi14,
        });
        return { ticker, momentum, breakdown, quote } satisfies ScanResult;
      }),
    );

    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      }
    }

    const elapsed = Date.now() - batchStart;
    const remaining = BATCH_INTERVAL_MS - elapsed;
    if (remaining > 0 && i + BATCH_SIZE < tickers.length) {
      await new Promise((r) => setTimeout(r, remaining));
    }
  }

  return results;
}
