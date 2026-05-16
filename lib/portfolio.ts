import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getQuotesMap, type Quote } from "@/lib/finnhub/data";
import {
  portfolioHeat,
  atrTrailingStop,
  type PortfolioHeatOutput,
  type Direction,
} from "@/lib/risk";
import { getHistoricalBars, type HistoricalBar } from "@/lib/backtest/data";
import { computeBarStats } from "@/lib/market-data/bar-stats";
import type { Bar } from "@/lib/market-data/massive";

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

function hasMarketDataCreds(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}

/**
 * Wraps `getHoldings()` with live quotes. When the data-vendor key is missing
 * the holdings are returned with `price: null` so the UI gracefully degrades.
 * Individual quote failures are tolerated — the row keeps `price: null`
 * rather than dropping out.
 */
export async function getHoldingsView(): Promise<HoldingsView> {
  const holdings = await getHoldings();
  const total_cost_basis = holdings.reduce((sum, h) => sum + h.cost_basis, 0);

  if (holdings.length === 0 || !hasMarketDataCreds()) {
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

/**
 * Most recent planned stop per ticker, drawn from the user's pre-trade
 * checklists. This is the working stop a position is held against. Tickers
 * with no checklist on file are simply absent from the result.
 */
async function getLatestStops(
  tickers: string[],
): Promise<Record<string, number>> {
  if (tickers.length === 0) return {};
  const supabase = await createSupabaseServerClient();
  if (!supabase) return {};
  const { data, error } = await supabase
    .from("trade_checklists")
    .select("ticker, stop, created_at")
    .in("ticker", tickers)
    .order("created_at", { ascending: false });
  if (error || !data) return {};

  const stops: Record<string, number> = {};
  for (const row of data) {
    const ticker = String(row.ticker);
    if (ticker in stops) continue; // ordered desc — first row is most recent
    const stop = Number(row.stop);
    if (Number.isFinite(stop) && stop > 0) stops[ticker] = stop;
  }
  return stops;
}

/**
 * Portfolio heat: total open R-at-risk across every open position, measured
 * against each position's most recent planned stop. Returns null when there
 * are no open positions or the account size / ceiling is unusable.
 */
export async function getPortfolioHeat(
  view: HoldingsView,
  accountSize: number,
  maxHeatPct: number,
): Promise<PortfolioHeatOutput | null> {
  const sizable = view.holdings.filter(
    (h) => h.qty !== 0 && h.avg_cost > 0,
  );
  if (sizable.length === 0) return null;
  if (!Number.isFinite(accountSize) || accountSize <= 0) return null;
  if (!Number.isFinite(maxHeatPct) || maxHeatPct <= 0 || maxHeatPct >= 100) {
    return null;
  }

  const stops = await getLatestStops(sizable.map((h) => h.ticker));

  const positions = sizable.map((h) => {
    const rawStop = stops[h.ticker];
    // A stop equal to entry cannot define risk — treat it as none on file.
    const stop =
      rawStop !== undefined && rawStop > 0 && rawStop !== h.avg_cost
        ? rawStop
        : null;
    return {
      ticker: h.ticker,
      shares: Math.abs(h.qty),
      entry: h.avg_cost,
      stop,
      price: h.price ?? undefined,
      direction: (h.qty >= 0 ? "long" : "short") as "long" | "short",
    };
  });

  try {
    return portfolioHeat({ positions, accountSize, maxHeatPct });
  } catch {
    return null;
  }
}

// Chandelier-style trailing stop: 3 ATRs back from the extreme since entry.
const TRAILING_ATR_MULT = 3;

export type TrailingStopRow = {
  ticker: string;
  direction: Direction;
  entry: number;
  currentPrice: number | null;
  /** Stop currently on file. */
  currentStop: number;
  /** Suggested trailing stop after the ratchet rule. */
  suggestedStop: number;
  /** True when the suggested stop sits above the current stop (long). */
  hasRatcheted: boolean;
  /** True once the trailing stop has removed the initial risk. */
  riskFree: boolean;
  lockedInR: number;
};

export type TrailingStopsView = {
  rows: TrailingStopRow[];
  atrMultiplier: number;
  /** Open positions skipped for lack of a stop on file or stored bars. */
  skippedCount: number;
};

function barRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

/**
 * Per-open-position ATR trailing stop. For each holding with a stop on file
 * and stored bars, derives where a chandelier-style trailing stop would sit
 * given the extreme price reached since the position opened and the current
 * ATR. Returns null when no position can be evaluated.
 */
export async function getTrailingStops(
  view: HoldingsView,
): Promise<TrailingStopsView | null> {
  const sizable = view.holdings.filter(
    (h) => h.qty !== 0 && h.avg_cost > 0,
  );
  if (sizable.length === 0) return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const tickers = sizable.map((h) => h.ticker);

  const { data: posRows } = await supabase
    .from("positions")
    .select("ticker, opened_at, is_closed")
    .in("ticker", tickers)
    .eq("is_closed", false);
  const openedAt: Record<string, string> = {};
  for (const row of posRows ?? []) {
    openedAt[String(row.ticker)] = String(row.opened_at);
  }

  const stops = await getLatestStops(tickers);
  const { from, to } = barRange(320);

  const rows: TrailingStopRow[] = [];
  let skippedCount = 0;

  for (const h of sizable) {
    const opened = openedAt[h.ticker];
    const rawStop = stops[h.ticker];
    const initialStop =
      rawStop !== undefined && rawStop > 0 && rawStop !== h.avg_cost
        ? rawStop
        : null;
    if (!opened || initialStop === null) {
      skippedCount += 1;
      continue;
    }

    let bars: HistoricalBar[];
    try {
      bars = await getHistoricalBars(supabase, h.ticker, from, to);
    } catch {
      skippedCount += 1;
      continue;
    }
    if (bars.length === 0) {
      skippedCount += 1;
      continue;
    }

    const series: Bar[] = bars.map((b) => ({
      time: Date.parse(b.date),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    const atr = computeBarStats(series).atr14;
    if (atr === null || atr <= 0) {
      skippedCount += 1;
      continue;
    }

    const direction: Direction = h.qty >= 0 ? "long" : "short";
    const openedDate = opened.slice(0, 10);
    const sinceOpen = bars.filter((b) => b.date >= openedDate);
    let extreme: number;
    if (direction === "long") {
      extreme = Math.max(
        h.avg_cost,
        h.price ?? 0,
        ...sinceOpen.map((b) => b.high),
      );
    } else {
      const lows = [
        h.avg_cost,
        ...(h.price != null ? [h.price] : []),
        ...sinceOpen.map((b) => b.low),
      ].filter((v) => v > 0);
      extreme = Math.min(...lows);
    }

    try {
      const out = atrTrailingStop({
        entry: h.avg_cost,
        direction,
        atr,
        atrMultiplier: TRAILING_ATR_MULT,
        extreme,
        initialStop,
      });
      rows.push({
        ticker: h.ticker,
        direction,
        entry: h.avg_cost,
        currentPrice: h.price,
        currentStop: initialStop,
        suggestedStop: out.trailingStop,
        hasRatcheted: out.hasRatcheted,
        riskFree: out.riskFree,
        lockedInR: out.lockedInR,
      });
    } catch {
      skippedCount += 1;
    }
  }

  if (rows.length === 0) return null;
  return { rows, atrMultiplier: TRAILING_ATR_MULT, skippedCount };
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
