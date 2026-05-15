import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { getEarningsContext } from "@/lib/finnhub/context";
import { getIndicators } from "@/lib/massive/indicators";
import { getGroupedDailyBars } from "@/lib/massive/data";
import { getCompanyOverview } from "@/lib/alphavantage/data";
import { SP500_TOP100 } from "@/lib/universe/sp500";

// Daily context refresh — requires Authorization: Bearer ${CRON_SECRET}.
// Warms Upstash caches for all three data vendors so the 9:35 AM scanner
// and watchlist page run from cache rather than issuing live API calls.
//
// Vendor lanes:
//   Finnhub:       earnings context (1 call/ticker)
//   Massive:       grouped daily bars (1 call total!) + indicators (3/ticker)
//   Alpha Vantage: company overview (1 call/ticker, 5/min free tier)
//
// Rate-limit budget:
//   Finnhub:       10/11s batches → ~110 s for 100 tickers
//   Massive:       1 grouped-bars call + 10/11s batches for indicators → ~110 s
//   Alpha Vantage: 5/min → 100 calls at 12 s interval → ~20 min
//   Total (phased): earnings + bars + indicators (~220 s) then AV overview
//   maxDuration: 300 s covers the first two phases. AV falls back to neutral
//   if it doesn't complete within the window.

function isValidCronAuth(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = `Bearer ${secret}`;
  try {
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const FINNHUB_BATCH_SIZE = 10;
const FINNHUB_BATCH_MS = 11_000;

// Massive free+paid tiers handle higher rate; use 20/10s bursts.
const MASSIVE_BATCH_SIZE = 20;
const MASSIVE_BATCH_MS = 10_000;

// AV free tier: 5/min → 1 call per 12 s
const AV_CALL_INTERVAL_MS = 12_000;

export const maxDuration = 300;

function prevTradingDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  // Step back until we hit Mon–Fri
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isValidCronAuth(req.headers.get("authorization"), cronSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const start = Date.now();
  const counts = {
    earningsWarmed: 0,
    earningsFailed: 0,
    barsWarmed: 0,
    indicatorsWarmed: 0,
    indicatorsFailed: 0,
    avWarmed: 0,
    avFailed: 0,
  };

  // --- Phase 1: Finnhub earnings context ------------------------------------
  for (let i = 0; i < SP500_TOP100.length; i += FINNHUB_BATCH_SIZE) {
    const batch = SP500_TOP100.slice(i, i + FINNHUB_BATCH_SIZE);
    const batchStart = Date.now();
    const settled = await Promise.allSettled(
      batch.map((t) => getEarningsContext(t)),
    );
    for (const outcome of settled) {
      if (outcome.status === "fulfilled" && outcome.value !== null) counts.earningsWarmed++;
      else counts.earningsFailed++;
    }
    const remaining = FINNHUB_BATCH_MS - (Date.now() - batchStart);
    if (remaining > 0 && i + FINNHUB_BATCH_SIZE < SP500_TOP100.length) {
      await new Promise((r) => setTimeout(r, remaining));
    }
  }

  // --- Phase 2: Massive grouped daily bars (ONE call for all US equities) ---
  try {
    const date = prevTradingDay();
    await getGroupedDailyBars(date);
    counts.barsWarmed = 1;
  } catch {
    // Non-fatal — liquidity falls back to neutral
  }

  // --- Phase 3: Massive indicators per ticker (SMA50, SMA200, RSI14) --------
  for (let i = 0; i < SP500_TOP100.length; i += MASSIVE_BATCH_SIZE) {
    const batch = SP500_TOP100.slice(i, i + MASSIVE_BATCH_SIZE);
    const batchStart = Date.now();
    const settled = await Promise.allSettled(
      batch.map((t) => getIndicators(t)),
    );
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") counts.indicatorsWarmed++;
      else counts.indicatorsFailed++;
    }
    const elapsed = Date.now() - batchStart;
    const remaining = MASSIVE_BATCH_MS - elapsed;
    if (remaining > 0 && i + MASSIVE_BATCH_SIZE < SP500_TOP100.length) {
      await new Promise((r) => setTimeout(r, remaining));
    }
  }

  // --- Phase 4: Alpha Vantage company overview (5 req/min free tier) --------
  // Best-effort: only run if well within maxDuration budget (~240 s used so far).
  // AV cache is 24 h so misses just fall back to null on the watchlist.
  const elapsed = Date.now() - start;
  if (elapsed < 240_000) {
    for (let i = 0; i < SP500_TOP100.length; i++) {
      const ticker = SP500_TOP100[i]!;
      const callStart = Date.now();
      try {
        await getCompanyOverview(ticker);
        counts.avWarmed++;
      } catch {
        counts.avFailed++;
      }
      const callElapsed = Date.now() - callStart;
      const remaining = AV_CALL_INTERVAL_MS - callElapsed;
      if (remaining > 0 && i + 1 < SP500_TOP100.length) {
        // Check wall-clock budget — stop if we're approaching maxDuration
        if (Date.now() - start > 280_000) break;
        await new Promise((r) => setTimeout(r, remaining));
      }
    }
  }

  return Response.json({
    ok: true,
    ...counts,
    durationMs: Date.now() - start,
  });
}
