import "server-only";
import { z } from "zod";
import { cached } from "@/lib/redis";
import { normalizeTicker } from "@/lib/finnhub/data";

// Massive API (Polygon.io rebranded Oct 2025). REST API is identical to
// Polygon — same endpoints, same auth pattern, new base URL.
// Docs: https://api.massive.com
// Key endpoints used here:
//   /v2/aggs/grouped/locale/us/market/stocks/{date}  — all US equities in ONE call
//   /v2/aggs/ticker/{t}/prev                          — single-ticker previous close

const BASE_URL = "https://api.massive.com";

export class MassiveDataError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.name = "MassiveDataError";
    this.code = code;
    this.status = status;
  }
}

function getApiKey(): string {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) {
    throw new MassiveDataError(
      "Massive API credentials missing — set MASSIVE_API_KEY",
      "missing-credentials",
    );
  }
  return key;
}

export async function massiveFetch(path: string): Promise<unknown> {
  const key = getApiKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new MassiveDataError(
      `Massive API request failed (${res.status}): ${body.slice(0, 200)}`,
      "request-failed",
      res.status,
    );
  }
  return res.json();
}

// -- Daily bars (OHLCV) per ticker -------------------------------------------

const AggResultSchema = z.object({
  T: z.string(), // ticker
  o: z.number(), // open
  h: z.number(), // high
  l: z.number(), // low
  c: z.number(), // close
  v: z.number(), // volume (shares)
  vw: z.number().optional(), // volume-weighted avg price
  t: z.number(), // timestamp (ms)
  n: z.number().optional(), // number of transactions
});

export type DailyBar = {
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  date: string; // YYYY-MM-DD
};

const GroupedBarsResponseSchema = z.object({
  status: z.string(),
  resultsCount: z.number().optional(),
  results: z.array(AggResultSchema).optional(),
});

// Cache one full trading day; keyed by date so we don't need to invalidate.
const GROUPED_BARS_TTL = 86_400; // 24 h

async function fetchGroupedDailyBars(date: string): Promise<DailyBar[]> {
  const raw = await massiveFetch(
    `/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`,
  );
  const parsed = GroupedBarsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MassiveDataError(
      `unexpected grouped bars payload: ${parsed.error.message}`,
      "schema-mismatch",
    );
  }
  const results = parsed.data.results ?? [];
  return results.map((r) => ({
    ticker: r.T,
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v,
    vwap: r.vw ?? null,
    date,
  }));
}

/**
 * Returns OHLCV bars for ALL US equities for a given calendar date.
 * One API call, cached 24 h. Use this to derive liquidity scores for the
 * full scan universe without burning per-ticker quota.
 */
export async function getGroupedDailyBars(
  date: string, // YYYY-MM-DD
): Promise<{ bars: DailyBar[]; cacheHit: boolean }> {
  const { value, hit } = await cached<DailyBar[]>(
    `tp:massive:grouped:v1:${date}`,
    GROUPED_BARS_TTL,
    () => fetchGroupedDailyBars(date),
  );
  return { bars: value, cacheHit: hit };
}

// -- Previous close (single ticker) -----------------------------------------

const PrevCloseResponseSchema = z.object({
  status: z.string(),
  results: z
    .array(
      z.object({
        T: z.string(),
        o: z.number(),
        h: z.number(),
        l: z.number(),
        c: z.number(),
        v: z.number(),
        vw: z.number().optional(),
        t: z.number(),
      }),
    )
    .optional(),
});

export type PrevCloseBar = {
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
};

async function fetchPreviousClose(ticker: string): Promise<PrevCloseBar | null> {
  const raw = await massiveFetch(
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?adjusted=true`,
  );
  const parsed = PrevCloseResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MassiveDataError(
      `unexpected prev-close payload: ${parsed.error.message}`,
      "schema-mismatch",
    );
  }
  const result = parsed.data.results?.[0];
  if (!result) return null;
  return {
    ticker: result.T,
    open: result.o,
    high: result.h,
    low: result.l,
    close: result.c,
    volume: result.v,
    vwap: result.vw ?? null,
  };
}

const PREV_CLOSE_TTL = 3_600; // 1 h during market hours

export async function getPreviousClose(
  rawTicker: string,
): Promise<{ bar: PrevCloseBar | null; cacheHit: boolean }> {
  const ticker = normalizeTicker(rawTicker);
  const { value, hit } = await cached<PrevCloseBar | null>(
    `tp:massive:prevclose:v1:${ticker}`,
    PREV_CLOSE_TTL,
    () => fetchPreviousClose(ticker),
  );
  return { bar: value, cacheHit: hit };
}

// -- Liquidity helper --------------------------------------------------------

/**
 * Build a ticker → avgDollarVolume map from grouped daily bars.
 * avgDollarVolume = volume × vwap (or close if vwap absent).
 * Returns `null` for any ticker not found in the bars dataset.
 */
export function buildLiquidityMap(
  bars: DailyBar[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const bar of bars) {
    const price = bar.vwap ?? bar.close;
    map[bar.ticker] = bar.volume * price;
  }
  return map;
}
