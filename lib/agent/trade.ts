import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getQuote } from "@/lib/finnhub/data";
import { hasMassiveCreds, isMarketOpen } from "@/lib/market-data/massive";

// Autonomous paper-trade execution. Called by:
//   app/api/cron/agent-trade (scheduled, CRON_SECRET)
//   app/api/admin/agent-trade (manual trigger, user-session auth)
//
// For each user with agent_enabled=true the agent:
//   1. Picks top scanner results for today above MOMENTUM_THRESHOLD
//   2. Skips tickers already held in the portfolio
//   3. Submits buy orders up to agent_daily_capital_limit
//   4. Logs every decision to agent_log

const MOMENTUM_THRESHOLD = 60;
const MAX_NEW_POSITIONS = 3;

export type AgentTradeResult = {
  userId: string;
  status: string;
  ordersPlaced: number;
};

export async function runAgentTrades(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>,
): Promise<AgentTradeResult[]> {
  const today = new Date().toISOString().slice(0, 10);
  const results: AgentTradeResult[] = [];

  // Holiday guard: if Massive reports the US market closed (e.g. Thanksgiving
  // on a weekday) skip the whole run. Weekend filtering already happens at
  // the cron schedule level. If MASSIVE_API_KEY isn't set we fall through.
  if (hasMassiveCreds()) {
    const open = await isMarketOpen();
    if (!open) {
      return [{ userId: "*", status: "skipped: market closed (holiday)", ordersPlaced: 0 }];
    }
  }

  const { data: profiles, error: profileErr } = await admin
    .from("profiles")
    .select("user_id, agent_daily_capital_limit")
    .eq("agent_enabled", true);

  if (profileErr || !profiles || profiles.length === 0) {
    return results;
  }

  for (const profile of profiles) {
    const userId = profile.user_id as string;
    const capitalLimit = Number(profile.agent_daily_capital_limit ?? 500);
    const result: AgentTradeResult = { userId, status: "ok", ordersPlaced: 0 };

    try {
      // 1. Today's top scanner results above threshold
      const { data: scans } = await admin
        .from("scanner_results")
        .select("ticker, momentum, quote")
        .eq("user_id", userId)
        .eq("scan_date", today)
        .gte("momentum", MOMENTUM_THRESHOLD)
        .order("momentum", { ascending: false })
        .limit(10);

      if (!scans || scans.length === 0) {
        result.status = "skipped: no qualifying scans";
        await log(admin, userId, "skipped", null, null, "No scanner results above threshold today");
        results.push(result);
        continue;
      }

      // 2. Current holdings — compute net qty per ticker from transactions
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
      const held = new Set(
        Object.entries(netQty)
          .filter(([, q]) => q > 0)
          .map(([t]) => t),
      );

      // 3. Agent capital already deployed today (tagged with "Agent:" note)
      const todayStart = `${today}T00:00:00.000Z`;
      const { data: todayOrders } = await admin
        .from("orders")
        .select("filled_price, filled_qty")
        .eq("user_id", userId)
        .eq("side", "buy")
        .eq("status", "filled")
        .gte("filled_at", todayStart)
        .like("note", "Agent:%");

      const deployed = (todayOrders ?? []).reduce(
        (sum, o) => sum + Number(o.filled_price ?? 0) * Number(o.filled_qty ?? 0),
        0,
      );
      const remaining = capitalLimit - deployed;

      if (remaining <= 0) {
        result.status = "skipped: daily limit reached";
        await log(admin, userId, "skipped", null, null, `Daily capital limit $${capitalLimit} already deployed`);
        results.push(result);
        continue;
      }

      // 4. Candidates: high momentum, not already held
      const candidates = scans.filter((s) => !held.has(s.ticker as string));

      if (candidates.length === 0) {
        result.status = "skipped: all candidates already held";
        await log(admin, userId, "skipped", null, null, "All qualifying tickers already in portfolio");
        results.push(result);
        continue;
      }

      const numToBuy = Math.min(MAX_NEW_POSITIONS, candidates.length);
      const perPosition = remaining / numToBuy;

      for (let i = 0; i < numToBuy; i++) {
        const scan = candidates[i];
        if (!scan) continue;
        const ticker = scan.ticker as string;

        let price: number;
        try {
          const { quote } = await getQuote(ticker);
          price = quote.price;
        } catch (err) {
          await log(admin, userId, "error", ticker, null, `No quote: ${String(err)}`);
          continue;
        }

        const qty = Math.floor(perPosition / price);
        if (qty < 1) {
          await log(admin, userId, "skipped", ticker, null,
            `Allocation too small: $${perPosition.toFixed(0)} / $${price.toFixed(2)} = 0 shares`);
          continue;
        }

        const note = `Agent: momentum ${Number(scan.momentum).toFixed(1)} on ${today}`;

        const { data: order, error: orderErr } = await admin
          .from("orders")
          .insert({ user_id: userId, ticker, side: "buy", qty, status: "pending", note, broker_mode: "paper" })
          .select()
          .single();

        if (orderErr || !order) {
          await log(admin, userId, "error", ticker, null, `Order insert failed: ${orderErr?.message}`);
          continue;
        }

        const filledAt = new Date().toISOString();
        const { error: fillErr } = await admin.rpc("fill_paper_order", {
          p_order_id: order.id,
          p_user_id: userId,
          p_ticker: ticker,
          p_side: "buy",
          p_qty: qty,
          p_fill_price: price,
          p_filled_at: filledAt,
        });

        if (fillErr) {
          await admin.from("orders").update({ status: "rejected" }).eq("id", order.id);
          await log(admin, userId, "error", ticker, order.id as string, `Fill failed: ${fillErr.message}`);
          continue;
        }

        await log(admin, userId, "buy_submitted", ticker, order.id as string,
          `${note} — ${qty} shares @ $${price.toFixed(2)}`);
        result.ordersPlaced++;
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
