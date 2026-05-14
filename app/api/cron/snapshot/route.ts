import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Daily portfolio snapshot cron — requires Authorization: Bearer ${CRON_SECRET}
// Scheduled via vercel.json to run at 23:00 UTC each day.
// Writes one row per user to portfolio_snapshots with cost-basis positions_value
// (live quotes are not fetched — market is closed at 23:00 UTC for most markets).

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = supabaseAdmin();

  // Get all profiles for account_size_initial
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profiles, error: profileErr } = await (admin.from("profiles") as any)
    .select("user_id, account_size_initial") as {
      data: { user_id: string; account_size_initial: number | null }[] | null;
      error: { message: string } | null;
    };

  if (profileErr || !profiles) {
    return new Response("Failed to fetch profiles", { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const results: { userId: string; status: string }[] = [];

  for (const profile of profiles) {
    const userId = profile.user_id as string;
    const accountSize = (profile.account_size_initial as number | null) ?? 0;

    // Compute open positions cost basis from transactions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: txRows } = await (admin.from("transactions") as any)
      .select("ticker, side, qty, price")
      .eq("user_id", userId) as {
        data: { ticker: string; side: string; qty: string; price: string }[] | null;
      };

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
        // Sell: reduce position. Reduce cost basis proportionally.
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

    // Upsert — unique on (user_id, snapshot_date)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upsertErr } = await (admin.from("portfolio_snapshots") as any).upsert(
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
