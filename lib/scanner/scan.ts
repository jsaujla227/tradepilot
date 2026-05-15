import "server-only";
import { getQuote, type Quote } from "@/lib/finnhub/data";
import { getEarningsContext } from "@/lib/finnhub/context";
import { scoreMomentum, type MomentumBreakdown } from "@/lib/scoring";
import { getBars, hasMassiveCreds } from "@/lib/market-data/massive";
import { computeBarStats, EMPTY_BAR_STATS } from "@/lib/market-data/bar-stats";

// Scanner uses the shared `scoreMomentum` function from lib/scoring so that
// trend/volatility/eventRisk math is identical to the watchlist surface.
// Earnings context is read through Upstash — the daily context-refresh cron
// warms the cache, so a typical scan does at most 1 Finnhub call per ticker
// (the quote itself). A cache miss falls through to a fresh fetch; that's
// rare and absorbed by the rate-limited batch loop below.
//
// When MASSIVE_API_KEY is set, the scanner also pulls 220 daily bars per
// ticker (cached 1h) so the momentum score can use SMA-50/200 stack +
// 20-day historical vol instead of the day-only quote inputs.

export type ScanResult = {
  ticker: string;
  momentum: number;
  breakdown: MomentumBreakdown;
  quote: Quote;
};

const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 11_000;
const BARS_LOOKBACK_DAYS = 320; // ~220 trading days, padded for weekends/holidays

function rangeFor(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export async function scanTickers(tickers: readonly string[]): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  const barsEnabled = hasMassiveCreds();
  const { from, to } = rangeFor(BARS_LOOKBACK_DAYS);

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const batchStart = Date.now();

    const settled = await Promise.allSettled(
      batch.map(async (ticker) => {
        const [{ quote }, earnings, bars] = await Promise.all([
          getQuote(ticker),
          getEarningsContext(ticker),
          barsEnabled
            ? getBars(ticker, 1, "day", from, to).catch(() => [])
            : Promise.resolve([]),
        ]);
        const barStats = bars.length > 0 ? computeBarStats(bars) : EMPTY_BAR_STATS;
        const { momentum, breakdown } = scoreMomentum({
          price: quote.price,
          prevClose: quote.prevClose,
          high: quote.high,
          low: quote.low,
          daysToEarnings: earnings?.daysUntil ?? null,
          bars: barStats,
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
