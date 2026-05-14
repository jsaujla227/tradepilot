import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { submitPaperOrder } from "./paper";
import type { BrokerAdapter, BrokerOrder, SubmitOrderParams } from "./types";

export class PaperAdapter implements BrokerAdapter {
  readonly mode = "paper" as const;

  async submitOrder(params: SubmitOrderParams): Promise<BrokerOrder> {
    const order = await submitPaperOrder({
      ticker: params.ticker,
      side: params.side,
      qty: params.qty,
      note: params.note,
    });
    return { ...order, broker_mode: "paper" };
  }

  async listOrders(userId: string, limit = 50): Promise<BrokerOrder[]> {
    void userId; // M17: Questrade adapter will scope to this user's account
    const supabase = await createSupabaseServerClient();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, ticker, side, qty, status, broker_mode, submitted_at, filled_price, filled_qty, filled_at, note, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Failed to fetch orders: ${error.message}`);
    return (data ?? []) as unknown as BrokerOrder[];
  }

  async getOrder(orderId: string, userId: string): Promise<BrokerOrder | null> {
    void userId;
    const supabase = await createSupabaseServerClient();
    if (!supabase) return null;
    const { data } = await supabase
      .from("orders")
      .select(
        "id, ticker, side, qty, status, broker_mode, submitted_at, filled_price, filled_qty, filled_at, note, created_at",
      )
      .eq("id", orderId)
      .maybeSingle();
    return data as BrokerOrder | null;
  }

  async cancelOrder(orderId: string, userId: string): Promise<boolean> {
    void userId;
    const supabase = await createSupabaseServerClient();
    if (!supabase) return false;
    const { error } = await supabase
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", orderId)
      .eq("status", "pending");
    return !error;
  }
}
