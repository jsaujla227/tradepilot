import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getQuotesMap } from "@/lib/finnhub/data";

// Position monitor. Called by:
//   app/api/cron/position-monitor (scheduled, CRON_SECRET)
//   app/api/admin/position-monitor (manual trigger, user-session auth)
//
// For each user with agent_enabled=true, checks all open positions against
// the stop price from the most recent trade_checklist for that ticker. If
// the current price is at or below the stop, a paper sell order is submitted
// automatically (stop-loss enforcement).

export type MonitorResult = {
  userId: string;
  status: string;
  stopsHit: number;
  positionsChecked: number;
};

export async function runPositionMonitor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>,
): Promise<MonitorResult[]> {
  const results: MonitorResult[] = [];

  const { data: profiles, error: profileErr } = await admin
    .from("profiles")
    .select("user_id")
    .eq("agent_enabled", true);

  if (profileErr || !profiles || profiles.length === 0) {
    return results;
  }

  for (const profile of profiles) {
    const userId = profile.user_id as string;
    const result: MonitorResult = { userId, status: "ok", stopsHit: 0, positionsChecked: 0 };

    try {
      // Compute open holdings from transactions
      const { data: txRows } = await admin
        .from("transactions")
        .select("ticker, side, qty")
        .eq("user_id", userId);

      const netQty: Record<string, number> = {};
      for (const tx of txRows ?? []) {
        const t = tx.ticker as string;
        const q = Number(tx.qty);
        netQty[t] = (netQty[t] ?? 0) + (tx.side === "buy" ? q : -q);
      }
      const holdings = Object.entries(netQty)
        .filter(([, q]) => q > 0)
        .map(([ticker, qty]) => ({ ticker, qty }));

      if (holdings.length === 0) {
        result.status = "no open positions";
        results.push(result);
        continue;
      }

      const tickers = holdings.map((h) => h.ticker);

      // Most recent stop level per ticker from trade_checklists
      const { data: checklists } = await admin
        .from("trade_checklists")
        .select("ticker, stop, created_at")
        .eq("user_id", userId)
        .in("ticker", tickers)
        .order("created_at", { ascending: false });

      const stopMap: Record<string, number> = {};
      for (const c of checklists ?? []) {
        const t = c.ticker as string;
        if (!(t in stopMap)) stopMap[t] = Number(c.stop);
      }

      // Get current quotes
      const quotes = await getQuotesMap(tickers);
      result.positionsChecked = holdings.length;

      for (const holding of holdings) {
        const { ticker, qty } = holding;
        const quote = quotes[ticker];
        const stop = stopMap[ticker];

        if (!quote) {
          await log(admin, userId, "skipped", ticker, null, "No quote available for stop check");
          continue;
        }

        if (stop == null) {
          await log(admin, userId, "skipped", ticker, null, "No trade checklist stop defined — manual review required");
          continue;
        }

        if (quote.price <= stop) {
          const note = `Agent: stop hit — price $${quote.price.toFixed(2)} ≤ stop $${stop.toFixed(2)}`;

          const { data: order, error: orderErr } = await admin
            .from("orders")
            .insert({ user_id: userId, ticker, side: "sell", qty, status: "pending", note, broker_mode: "paper" })
            .select()
            .single();

          if (orderErr || !order) {
            await log(admin, userId, "error", ticker, null, `Sell order insert failed: ${orderErr?.message}`);
            continue;
          }

          const filledAt = new Date().toISOString();
          const { error: fillErr } = await admin.rpc("fill_paper_order", {
            p_order_id: order.id,
            p_user_id: userId,
            p_ticker: ticker,
            p_side: "sell",
            p_qty: qty,
            p_fill_price: quote.price,
            p_filled_at: filledAt,
          });

          if (fillErr) {
            await admin.from("orders").update({ status: "rejected" }).eq("id", order.id);
            await log(admin, userId, "error", ticker, order.id as string, `Stop fill failed: ${fillErr.message}`);
            continue;
          }

          await log(admin, userId, "sell_submitted", ticker, order.id as string, note);
          result.stopsHit++;
        }
      }
    } catch (err) {
      result.status = `error: ${String(err)}`;
      await log(admin, userId, "error", null, null, String(err));
    }

    results.push(result);
  }

  return results;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function log(admin: SupabaseClient<any>, userId: string, eventType: string,
  ticker: string | null, orderId: string | null, reason: string) {
  await admin.from("agent_log").insert({ user_id: userId, event_type: eventType, ticker, order_id: orderId, reason });
}
