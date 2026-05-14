import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { scanTickers } from "@/lib/scanner/scan";
import { SP500_TOP100 } from "@/lib/universe/sp500";

// Daily market scanner — requires Authorization: Bearer ${CRON_SECRET}
// Scheduled via vercel.json to run at 13:35 UTC (9:35 AM ET) on weekdays.
// Scans the top 100 S&P 500 tickers, scores by momentum, upserts to
// scanner_results. Each user's row is scoped by user_id for RLS.

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

export const maxDuration = 300; // Vercel Pro: allow up to 5 min for the rate-limited scan

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isValidCronAuth(req.headers.get("authorization"), cronSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = supabaseAdmin();

  // Fetch all user IDs to scope results per user
  const { data: profiles, error: profileErr } = await admin
    .from("profiles")
    .select("user_id");

  if (profileErr || !profiles || profiles.length === 0) {
    return new Response("No profiles found", { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Scan once — results are shared for all users (single-user cockpit)
  const results = await scanTickers(SP500_TOP100);

  if (results.length === 0) {
    return Response.json({ ok: false, reason: "No quotes returned from Finnhub" });
  }

  // Upsert results for each user
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
