import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { scanTickers } from "@/lib/scanner/scan";
import { SP500_TOP100 } from "@/lib/universe/sp500";

export const maxDuration = 300;

export async function POST() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return new Response("Supabase not configured", { status: 503 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const admin = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  const { data: profiles, error: profileErr } = await admin
    .from("profiles")
    .select("user_id");

  if (profileErr || !profiles || profiles.length === 0) {
    return new Response("No profiles found", { status: 500 });
  }

  const results = await scanTickers(SP500_TOP100);

  if (results.length === 0) {
    return Response.json({ ok: false, reason: "No quotes returned from Finnhub" });
  }

  let upsertErrors = 0;
  for (const { user_id } of profiles) {
    const rows = results.map((r) => ({
      user_id: user_id as string,
      scan_date: today,
      ticker: r.ticker,
      momentum: r.momentum,
      quote: r.quote,
      breakdown: r.breakdown,
    }));

    const { error } = await admin
      .from("scanner_results")
      .upsert(rows, { onConflict: "user_id,scan_date,ticker" });

    if (error) upsertErrors++;
  }

  return Response.json({
    ok: true,
    scan_date: today,
    tickers_scanned: results.length,
    top5: results
      .sort((a, b) => b.momentum - a.momentum)
      .slice(0, 5)
      .map((r) => ({ ticker: r.ticker, momentum: r.momentum })),
    upsert_errors: upsertErrors,
  });
}
