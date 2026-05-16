import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { backfillBars } from "@/lib/backtest/ingest";
import { SP500_TOP100 } from "@/lib/universe/sp500";

// Daily incremental historical-bar backfill — requires
// Authorization: Bearer ${CRON_SECRET}. A short look-back keeps recent
// historical_bars rows fresh; the full multi-year history is loaded once
// via the admin route (POST /api/admin/backfill-bars).

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

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret ||
    !isValidCronAuth(req.headers.get("authorization"), cronSecret)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  let results;
  try {
    results = await backfillBars(supabaseAdmin(), SP500_TOP100, 7);
  } catch (err) {
    return new Response(
      `Backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 },
    );
  }

  const failed = results.filter((r) => !r.ok);
  return Response.json({
    ok: failed.length === 0,
    tickers: results.length,
    succeeded: results.length - failed.length,
    failed: failed.length,
    bars_upserted: results.reduce((s, r) => s + r.barsUpserted, 0),
    errors: failed.slice(0, 10).map((r) => ({ ticker: r.ticker, error: r.error })),
  });
}
