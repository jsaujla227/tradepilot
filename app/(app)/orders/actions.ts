"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { submitParamsSchema } from "@/lib/broker/paper";
import { getBrokerAdapter } from "@/lib/broker";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_PROFILE } from "@/lib/profile";
import { getHoldingsView } from "@/lib/portfolio";
import { tickerSchema } from "@/lib/ticker";
import {
  positionSize,
  rMultiple,
  dailyLossBreached,
} from "@/lib/risk";

// ── submitOrder (direct paper order, no checklist) ───────────────────────────

export type SubmitOrderState = {
  error?: string;
  orderId?: string;
};

export async function submitOrder(
  _prev: SubmitOrderState,
  formData: FormData,
): Promise<SubmitOrderState> {
  const parsed = submitParamsSchema.safeParse({
    ticker: formData.get("ticker"),
    side: formData.get("side"),
    qty: formData.get("qty"),
    note: formData.get("note") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Not configured" };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  try {
    const adapter = await getBrokerAdapter(user.id);
    const order = await adapter.submitOrder(parsed.data);
    revalidatePath("/orders");
    revalidatePath("/portfolio");
    return { orderId: order.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Order failed" };
  }
}

// ── submitTrade (pre-trade checklist → circuit breaker → paper order) ─────────

const submitTradeSchema = z.object({
  ticker: tickerSchema,
  side: z.enum(["buy", "sell"]),
  entry: z.coerce.number().positive("Entry must be positive"),
  stop: z.coerce.number().positive("Stop must be positive"),
  target: z.coerce.number().positive("Target must be positive"),
  qty: z.coerce.number().positive("Qty must be positive").max(1e9),
  reason: z.string().min(1, "Reason is required").max(1000),
  what_could_go_wrong: z.string().min(1, "Required").max(1000),
});

export type SubmitTradeState = {
  error?: string;
  /** Set when the daily-loss circuit breaker trips. */
  blocked?: {
    totalToday: number;
    limit: number;
    remaining: number;
  };
  orderId?: string;
};

export async function submitTrade(
  _prev: SubmitTradeState,
  formData: FormData,
): Promise<SubmitTradeState> {
  const parsed = submitTradeSchema.safeParse({
    ticker: formData.get("ticker"),
    side: formData.get("side"),
    entry: formData.get("entry"),
    stop: formData.get("stop"),
    target: formData.get("target"),
    qty: formData.get("qty"),
    reason: formData.get("reason"),
    what_could_go_wrong: formData.get("what_could_go_wrong"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase not configured" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // Load risk settings from profile
  const { data: profileRow } = await supabase
    .from("profiles")
    .select(
      "account_size_initial, max_risk_per_trade_pct, daily_loss_limit_pct",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const accountSize = Number(
    profileRow?.account_size_initial ?? DEFAULT_PROFILE.account_size_initial,
  );
  const maxRiskPct = Number(
    profileRow?.max_risk_per_trade_pct ??
      DEFAULT_PROFILE.max_risk_per_trade_pct,
  );
  const dailyLossLimitPct = Number(
    profileRow?.daily_loss_limit_pct ?? DEFAULT_PROFILE.daily_loss_limit_pct,
  );

  // Circuit breaker: sum today's realized P&L from closed positions + open P&L.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [holdingsView, { data: closedToday }] = await Promise.all([
    getHoldingsView(),
    supabase
      .from("positions")
      .select("realized_pnl")
      .eq("is_closed", true)
      .gte("closed_at", startOfDay.toISOString()),
  ]);

  const openPnL = holdingsView.total_open_pnl ?? 0;
  const realizedToday = (closedToday ?? []).reduce(
    (sum, row) => sum + Number(row.realized_pnl ?? 0),
    0,
  );

  const cbResult = dailyLossBreached({
    accountSize,
    dailyLossLimitPct,
    realizedToday,
    openPnL,
  });

  if (cbResult.breached) {
    return {
      blocked: {
        totalToday: cbResult.totalToday,
        limit: cbResult.limit,
        remaining: cbResult.remaining,
      },
    };
  }

  // Compute risk metrics to store alongside the checklist entry
  let computedShares: number | null = null;
  let computedR: number | null = null;
  try {
    const ps = positionSize({
      entry: parsed.data.entry,
      stop: parsed.data.stop,
      accountSize,
      maxRiskPct,
    });
    computedShares = ps.shares;
    const rm = rMultiple({
      entry: parsed.data.entry,
      stop: parsed.data.stop,
      target: parsed.data.target,
    });
    computedR = rm.plannedR;
  } catch {
    // non-fatal — checklist row still written with nulls
  }

  // Write checklist row
  const { error: checklistError } = await supabase
    .from("trade_checklists")
    .insert({
      user_id: user.id,
      ticker: parsed.data.ticker,
      side: parsed.data.side,
      entry: parsed.data.entry,
      stop: parsed.data.stop,
      target: parsed.data.target,
      qty: parsed.data.qty,
      reason: parsed.data.reason,
      what_could_go_wrong: parsed.data.what_could_go_wrong,
      position_size_at_entry: computedShares,
      r_at_entry: computedR,
      daily_loss_at_entry: openPnL,
    });

  if (checklistError) {
    return { error: `Failed to save checklist: ${checklistError.message}` };
  }

  // Submit order via broker adapter
  try {
    const adapter = await getBrokerAdapter(user.id);
    const order = await adapter.submitOrder({
      ticker: parsed.data.ticker,
      side: parsed.data.side,
      qty: parsed.data.qty,
      note: `${parsed.data.side === "buy" ? "Long" : "Short"}: ${parsed.data.reason}`,
    });
    revalidatePath("/orders");
    revalidatePath("/portfolio");
    revalidatePath("/dashboard");
    return { orderId: order.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Order failed" };
  }
}
