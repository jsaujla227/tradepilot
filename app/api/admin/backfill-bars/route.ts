import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { backfillBars } from "@/lib/backtest/ingest";
import { SP500_TOP100 } from "@/lib/universe/sp500";

// Manual full historical-bar backfill — admin allowlisted. Defaults to a
// ~20-year look-back so a single run seeds the whole backtesting history;
// pass ?days=N to override (capped at 7300 ≈ 20 years).

export const maxDuration = 300;

const DEFAULT_LOOKBACK_DAYS = 7300;
const MAX_LOOKBACK_DAYS = 7300;

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const daysParam = req.nextUrl.searchParams.get("days");
  const requested = daysParam != null ? Number(daysParam) : DEFAULT_LOOKBACK_DAYS;
  const lookbackDays =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_LOOKBACK_DAYS)
      : DEFAULT_LOOKBACK_DAYS;

  let results;
  try {
    results = await backfillBars(supabaseAdmin(), SP500_TOP100, lookbackDays);
  } catch (err) {
    return new Response(
      `Backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 },
    );
  }

  const failed = results.filter((r) => !r.ok);
  return Response.json({
    ok: failed.length === 0,
    lookback_days: lookbackDays,
    tickers: results.length,
    succeeded: results.length - failed.length,
    failed: failed.length,
    bars_upserted: results.reduce((s, r) => s + r.barsUpserted, 0),
    errors: failed.slice(0, 10).map((r) => ({ ticker: r.ticker, error: r.error })),
  });
}
