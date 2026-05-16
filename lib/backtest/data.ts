import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

// Read access to the historical_bars table — the backtest engine's bar source.
// historical_bars holds adjusted daily OHLCV, backfilled by lib/backtest/ingest.
// The backtest engine (B3+) replays from this table, never the live API.

export type HistoricalBar = {
  ticker: string;
  /** Trading day, YYYY-MM-DD. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// Postgres NUMERIC / BIGINT cross the wire as strings — coerce defensively.
const RowSchema = z.object({
  ticker: z.string(),
  bar_date: z.string(),
  open: z.coerce.number(),
  high: z.coerce.number(),
  low: z.coerce.number(),
  close: z.coerce.number(),
  volume: z.coerce.number(),
});

/** Validates and maps one historical_bars row to a HistoricalBar. Pure. */
export function toHistoricalBar(row: unknown): HistoricalBar {
  const r = RowSchema.parse(row);
  return {
    ticker: r.ticker,
    date: r.bar_date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  };
}

/**
 * Loads adjusted daily bars for one ticker over [from, to] inclusive,
 * ordered oldest-first. `from` and `to` are YYYY-MM-DD strings.
 */
export async function getHistoricalBars(
  supabase: SupabaseClient,
  ticker: string,
  from: string,
  to: string,
): Promise<HistoricalBar[]> {
  const { data, error } = await supabase
    .from("historical_bars")
    .select("ticker, bar_date, open, high, low, close, volume")
    .eq("ticker", ticker.trim().toUpperCase())
    .gte("bar_date", from)
    .lte("bar_date", to)
    .order("bar_date", { ascending: true });
  if (error) {
    throw new Error(`historical_bars query failed: ${error.message}`);
  }
  return (data ?? []).map(toHistoricalBar);
}
