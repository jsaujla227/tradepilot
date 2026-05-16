import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { getEarningsContext } from "@/lib/finnhub/context";
import { SP500_TOP100 } from "@/lib/universe/sp500";

// Daily context refresh — requires Authorization: Bearer ${CRON_SECRET}.
// Walks the scan universe and warms the Upstash earnings cache so the 9:35 AM
// scanner can pull `daysToEarnings` without issuing a fresh Finnhub call.
//
// Rate-limit budget: 100 tickers × 1 earnings call. Throttled to 10 per
// 11-second window (matches scanner) → ~110 s, well under maxDuration.

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

const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 11_000;

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isValidCronAuth(req.headers.get("authorization"), cronSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const start = Date.now();
  let warmed = 0;
  let failed = 0;

  for (let i = 0; i < SP500_TOP100.length; i += BATCH_SIZE) {
    const batch = SP500_TOP100.slice(i, i + BATCH_SIZE);
    const batchStart = Date.now();

    const settled = await Promise.allSettled(
      batch.map((ticker) => getEarningsContext(ticker)),
    );

    for (const outcome of settled) {
      if (outcome.status === "fulfilled" && outcome.value !== null) {
        warmed++;
      } else {
        failed++;
      }
    }

    const remaining = BATCH_INTERVAL_MS - (Date.now() - batchStart);
    if (remaining > 0 && i + BATCH_SIZE < SP500_TOP100.length) {
      await new Promise((r) => setTimeout(r, remaining));
    }
  }

  return Response.json({
    ok: true,
    tickersWarmed: warmed,
    tickersFailed: failed,
    durationMs: Date.now() - start,
  });
}
