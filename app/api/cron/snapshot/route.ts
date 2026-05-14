import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Daily portfolio snapshot cron — requires Authorization: Bearer ${CRON_SECRET}
// Scheduled via vercel.json to run at 23:00 UTC each day.
// Writes one row per user to portfolio_snapshots with cost-basis positions_value
// (live quotes are not fetched — market is closed at 23:00 UTC for most markets).

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

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isValidCronAuth(req.headers.get("authorization"), cronSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = supabaseAdmin();

  const { data: profiles, error: profileErr } = await admin
    .from("profiles")
    .select("user_id, account_size_initial");

  if (profileErr || !profiles) {
    return new Response("Failed to fetch profiles", { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const results: { userId: string; status: string }[] = [];

  for (const profile of profiles) {
    const userId = profile.user_id as string;
    const accountSize = (profile.account_size_initial as number | null) ?? 0;

    const { data: txRows } = await admin
      .from("transactions")
      .select("ticker, side, qty, price")
      .eq("user_id", userId);

    // Aggregate net qty and cost basis per ticker
    const holdings: Record<string, { netQty: number; costBasis: number }> = {};
    for (const tx of txRows ?? []) {
      const ticker = tx.ticker as string;
      const side = tx.side as string;
      const qty = Number(tx.qty);
      const price = Number(tx.price);
      if (!holdings[ticker]) holdings[ticker] = { netQty: 0, costBasis: 0 };
      if (side === "buy") {
        holdings[ticker].netQty += qty;
        holdings[ticker].costBasis += qty * price;
      } else {
        const prev = holdings[ticker];
        const sellRatio = prev.netQty > 0 ? qty / prev.netQty : 0;
        holdings[ticker].netQty -= qty;
        holdings[ticker].costBasis -= prev.costBasis * sellRatio;
      }
    }

    const positionsValue = Object.values(holdings)
      .filter((h) => h.netQty > 0.00000001)
      .reduce((sum, h) => sum + h.costBasis, 0);

    const cash = Math.max(0, accountSize - positionsValue);
    const totalValue = cash + positionsValue;

    const { error: upsertErr } = await admin.from("portfolio_snapshots").upsert(
      {
        user_id: userId,
        snapshot_date: today,
        total_value: totalValue,
        cash,
        positions_value: positionsValue,
        realized_pnl_today: 0,
      },
      { onConflict: "user_id,snapshot_date" },
    );

    results.push({
      userId,
      status: upsertErr ? `error: ${upsertErr.message}` : "ok",
    });
  }

  return Response.json({ ok: true, date: today, results });
}
