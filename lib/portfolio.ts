import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getQuotesMap, type Quote } from "@/lib/alpaca/data";

export type Side = "buy" | "sell";
export type TxSource = "manual" | "csv" | "alpaca";

export type Holding = {
  ticker: string;
  qty: number;
  avg_cost: number;
  cost_basis: number;
};

export type EnrichedHolding = Holding & {
  price: number | null;
  market_value: number | null;
  open_pnl: number | null;
  open_pnl_pct: number | null;
  quote_as_of: string | null;
};

export type HoldingsView = {
  holdings: EnrichedHolding[];
  total_cost_basis: number;
  total_market_value: number | null;
  total_open_pnl: number | null;
  priced_count: number;
  quotes_attempted: boolean;
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

function hasAlpacaCreds(): boolean {
  return Boolean(
    process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY,
  );
}

/**
 * Wraps `getHoldings()` with live quotes. When Alpaca creds are missing the
 * holdings are returned with `price: null` so the UI gracefully degrades.
 * Individual quote failures are tolerated — the row keeps `price: null`
 * rather than dropping out.
 */
export async function getHoldingsView(): Promise<HoldingsView> {
  const holdings = await getHoldings();
  const total_cost_basis = holdings.reduce((sum, h) => sum + h.cost_basis, 0);

  if (holdings.length === 0 || !hasAlpacaCreds()) {
    return {
      holdings: holdings.map((h) => ({
        ...h,
        price: null,
        market_value: null,
        open_pnl: null,
        open_pnl_pct: null,
        quote_as_of: null,
      })),
      total_cost_basis,
      total_market_value: null,
      total_open_pnl: null,
      priced_count: 0,
      quotes_attempted: false,
    };
  }

  const quotes = await getQuotesMap(holdings.map((h) => h.ticker));
  let priced_count = 0;
  let any_priced = false;
  let total_market_value = 0;
  let total_open_pnl = 0;

  const enriched: EnrichedHolding[] = holdings.map((h) => {
    const q: Quote | null = quotes[h.ticker] ?? null;
    if (!q) {
      return {
        ...h,
        price: null,
        market_value: null,
        open_pnl: null,
        open_pnl_pct: null,
        quote_as_of: null,
      };
    }
    const market_value = q.price * h.qty;
    const open_pnl = market_value - h.cost_basis;
    const open_pnl_pct =
      h.cost_basis > 0 ? (open_pnl / h.cost_basis) * 100 : null;
    priced_count += 1;
    any_priced = true;
    total_market_value += market_value;
    total_open_pnl += open_pnl;
    return {
      ...h,
      price: q.price,
      market_value,
      open_pnl,
      open_pnl_pct,
      quote_as_of: q.asOf,
    };
  });

  return {
    holdings: enriched,
    total_cost_basis,
    total_market_value: any_priced ? total_market_value : null,
    total_open_pnl: any_priced ? total_open_pnl : null,
    priced_count,
    quotes_attempted: true,
  };
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
