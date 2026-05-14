import "server-only";
import { z } from "zod";
import { getQuote } from "@/lib/finnhub/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tickerSchema } from "@/lib/ticker";

// Stubbed in-app paper broker. Orders fill synchronously at the last cached
// Finnhub quote. No external trade routing (Alpaca/IBKR not viable for Canada).

export type OrderSide = "buy" | "sell";
export type OrderStatus = "pending" | "filled" | "cancelled" | "rejected";

export type PaperOrder = {
  id: string;
  ticker: string;
  side: OrderSide;
  qty: number;
  status: OrderStatus;
  submitted_at: string;
  filled_price: number | null;
  filled_qty: number | null;
  filled_at: string | null;
  note: string | null;
  created_at: string;
};

export const submitParamsSchema = z.object({
  ticker: tickerSchema,
  side: z.enum(["buy", "sell"]),
  qty: z.coerce.number().positive("Qty must be positive").max(1e9),
  note: z
    .string()
    .max(500)
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined)),
});

export type SubmitParams = z.infer<typeof submitParamsSchema>;

/**
 * Submit a paper market order. Writes `pending`, fetches the Finnhub quote,
 * updates to `filled`, then inserts the linked `transactions` row — all in the
 * same request so the portfolio reflects the fill immediately.
 */
export async function submitPaperOrder(params: SubmitParams): Promise<PaperOrder> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Insert order as pending
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      user_id: user.id,
      ticker: params.ticker,
      side: params.side,
      qty: params.qty,
      status: "pending",
      note: params.note ?? null,
    })
    .select()
    .single();

  if (orderError || !order) {
    throw new Error(`Failed to create order: ${orderError?.message}`);
  }

  // Fetch fill price — uses Upstash cache (60 s TTL) so rapid re-orders are cheap
  let fillPrice: number;
  try {
    const { quote } = await getQuote(params.ticker);
    fillPrice = quote.price;
  } catch (err) {
    await supabase
      .from("orders")
      .update({ status: "rejected" })
      .eq("id", order.id);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`No quote available for ${params.ticker} — order rejected: ${msg}`);
  }

  const filledAt = new Date().toISOString();

  // Atomic fill: update order + insert transaction in one Postgres function
  // so a mid-flight crash cannot leave an order "filled" with no transaction.
  const { error: fillError } = await supabase.rpc("fill_paper_order", {
    p_order_id:   order.id,
    p_user_id:    user.id,
    p_ticker:     params.ticker,
    p_side:       params.side,
    p_qty:        params.qty,
    p_fill_price: fillPrice,
    p_filled_at:  filledAt,
  });

  if (fillError) {
    await supabase.from("orders").update({ status: "rejected" }).eq("id", order.id);
    throw new Error(`Failed to fill order: ${fillError.message}`);
  }

  return {
    ...(order as unknown as PaperOrder),
    status: "filled",
    filled_price: fillPrice,
    filled_qty: params.qty,
    filled_at: filledAt,
  };
}

export async function getOrders(limit = 50): Promise<PaperOrder[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, ticker, side, qty, status, submitted_at, filled_price, filled_qty, filled_at, note, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch orders: ${error.message}`);
  return (data ?? []) as unknown as PaperOrder[];
}
