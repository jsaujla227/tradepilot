import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { scanTickers } from "@/lib/scanner/scan";
import { SP500_TOP100 } from "@/lib/universe/sp500";

export const maxDuration = 300;

// Manual scan trigger — admin allowlisted. Unlike the cron, this only upserts
// results for the calling admin so a stray click never writes into other
// users' scanner_results rows.
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const admin = supabaseAdmin();
  if (!admin) {
    return new Response("Supabase admin not configured", { status: 503 });
  }

  const today = new Date().toISOString().slice(0, 10);

  let results;
  try {
    results = await scanTickers(SP500_TOP100);
  } catch (err) {
    return new Response(
      `Scan failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 },
    );
  }

  if (results.length === 0) {
    return Response.json({ ok: false, reason: "No quotes returned from Finnhub" });
  }

  const rows = results.map((r) => ({
    user_id: auth.user.id,
    scan_date: today,
    ticker: r.ticker,
    momentum: r.momentum,
    quote: r.quote,
    breakdown: r.breakdown,
  }));

  const { error: upsertErr } = await admin
    .from("scanner_results")
    .upsert(rows, { onConflict: "user_id,scan_date,ticker" });

  return Response.json({
    ok: !upsertErr,
    scan_date: today,
    tickers_scanned: results.length,
    top5: results
      .sort((a, b) => b.momentum - a.momentum)
      .slice(0, 5)
      .map((r) => ({ ticker: r.ticker, momentum: r.momentum })),
    upsert_error: upsertErr?.message ?? null,
  });
}
