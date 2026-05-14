import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Side = "buy" | "sell";
export type TxSource = "manual" | "csv" | "alpaca";

export type Holding = {
  ticker: string;
  qty: number;
  avg_cost: number;
  cost_basis: number;
};

export type Transaction = {
  id: string;
  ticker: string;
  side: Side;
  qty: number;
  price: number;
  fees: number;
  executed_at: string;
  source: TxSource;
  order_id: string | null;
  note: string | null;
  created_at: string;
};

/**
 * Returns the current user's holdings via the compute_holdings() Postgres
 * function. Numeric fields come back from PostgREST as strings; we coerce.
 * Empty array when unauthenticated or when the user has no open positions.
 */
export async function getHoldings(): Promise<Holding[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("compute_holdings");
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    ticker: String(row.ticker),
    qty: Number(row.qty),
    avg_cost: Number(row.avg_cost),
    cost_basis: Number(row.cost_basis),
  }));
}

export async function getRecentTransactions(
  limit = 50,
): Promise<Transaction[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("transactions")
    .select("id, ticker, side, qty, price, fees, executed_at, source, order_id, note, created_at")
    .order("executed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((t) => ({
    id: String(t.id),
    ticker: String(t.ticker),
    side: t.side as Side,
    qty: Number(t.qty),
    price: Number(t.price),
    fees: Number(t.fees),
    executed_at: String(t.executed_at),
    source: t.source as TxSource,
    order_id: t.order_id as string | null,
    note: (t.note as string | null) ?? null,
    created_at: String(t.created_at),
  }));
}
