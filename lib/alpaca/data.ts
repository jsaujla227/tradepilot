import "server-only";
import { z } from "zod";
import { cached } from "@/lib/redis";

// Alpaca market-data client. IEX feed (free tier). We expose two cached
// fetchers: latest trade (quote) with a 60s TTL, and daily bars with a 6h TTL.
// All external responses pass through Zod before being trusted.

const DATA_BASE_URL =
  process.env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets";

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

export class AlpacaDataError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.name = "AlpacaDataError";
    this.code = code;
    this.status = status;
  }
}

/** Uppercase + validate a ticker against `^[A-Z][A-Z0-9.-]{0,9}$`. */
export function normalizeTicker(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (!TICKER_RE.test(t)) {
    throw new AlpacaDataError(`invalid ticker: ${raw}`, "invalid-ticker");
  }
  return t;
}

function getCreds(): { id: string; secret: string } {
  const id = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!id || !secret) {
    throw new AlpacaDataError(
      "Alpaca credentials missing — set ALPACA_API_KEY_ID + ALPACA_API_SECRET_KEY",
      "missing-credentials",
    );
  }
  return { id, secret };
}

async function alpacaFetch(path: string): Promise<unknown> {
  const { id, secret } = getCreds();
  const res = await fetch(`${DATA_BASE_URL}${path}`, {
    headers: {
      "APCA-API-KEY-ID": id,
      "APCA-API-SECRET-KEY": secret,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AlpacaDataError(
      `alpaca request failed (${res.status}): ${body.slice(0, 200)}`,
      "request-failed",
      res.status,
    );
  }
  return res.json();
}

// -- Quotes (latest trade) -----------------------------------------------

const TradeSchema = z.object({
  t: z.string(), // ISO timestamp
  p: z.number().positive(), // price
  s: z.number().nonnegative().optional(), // size
});

const LatestTradeResponseSchema = z.object({
  symbol: z.string(),
  trade: TradeSchema,
});

export type Quote = {
  ticker: string;
  price: number;
  size: number | null;
  asOf: string;
};

const QUOTE_TTL_SECONDS = 60;

async function fetchLatestTrade(ticker: string): Promise<Quote> {
  const raw = await alpacaFetch(
    `/v2/stocks/${encodeURIComponent(ticker)}/trades/latest`,
  );
  const parsed = LatestTradeResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AlpacaDataError(
      `unexpected /trades/latest payload: ${parsed.error.message}`,
      "schema-mismatch",
    );
  }
  return {
    ticker: parsed.data.symbol,
    price: parsed.data.trade.p,
    size: parsed.data.trade.s ?? null,
    asOf: parsed.data.trade.t,
  };
}

export async function getQuote(
  rawTicker: string,
): Promise<{ quote: Quote; cacheHit: boolean }> {
  const ticker = normalizeTicker(rawTicker);
  const { value, hit } = await cached<Quote>(
    `tp:quote:v1:${ticker}`,
    QUOTE_TTL_SECONDS,
    () => fetchLatestTrade(ticker),
  );
  return { quote: value, cacheHit: hit };
}

/**
 * Best-effort price lookup for many tickers in parallel. Failures resolve to
 * `null` for that ticker instead of throwing — the holdings table must still
 * render the rest of the portfolio if one symbol's quote is unavailable.
 */
export async function getQuotesMap(
  tickers: readonly string[],
): Promise<Record<string, Quote | null>> {
  const unique = Array.from(new Set(tickers.map((t) => t.toUpperCase())));
  const entries = await Promise.all(
    unique.map(async (ticker) => {
      try {
        const { quote } = await getQuote(ticker);
        return [ticker, quote] as const;
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[alpaca] quote failed for ${ticker}`, err);
        }
        return [ticker, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

// -- Daily bars ----------------------------------------------------------

const BarSchema = z.object({
  t: z.string(), // ISO timestamp at open
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number().nonnegative(),
});

const BarsResponseSchema = z.object({
  symbol: z.string(),
  bars: z.array(BarSchema).nullable().optional(),
  next_page_token: z.string().nullable().optional(),
});

export type DailyBar = {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type DailyBarsResult = {
  ticker: string;
  bars: DailyBar[];
};

const BARS_TTL_SECONDS = 6 * 60 * 60;
const DEFAULT_BARS_LIMIT = 365;
const MAX_BARS_LIMIT = 1000;

function toDateString(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

async function fetchDailyBars(
  ticker: string,
  limit: number,
): Promise<DailyBarsResult> {
  const params = new URLSearchParams({
    timeframe: "1Day",
    limit: String(limit),
    adjustment: "split",
    feed: "iex",
  });
  const raw = await alpacaFetch(
    `/v2/stocks/${encodeURIComponent(ticker)}/bars?${params.toString()}`,
  );
  const parsed = BarsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AlpacaDataError(
      `unexpected /bars payload: ${parsed.error.message}`,
      "schema-mismatch",
    );
  }
  const bars = (parsed.data.bars ?? []).map((b) => ({
    date: toDateString(b.t),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
  return { ticker: parsed.data.symbol, bars };
}

export async function getDailyBars(
  rawTicker: string,
  limit: number = DEFAULT_BARS_LIMIT,
): Promise<{ result: DailyBarsResult; cacheHit: boolean }> {
  const ticker = normalizeTicker(rawTicker);
  if (!Number.isFinite(limit) || limit < 1 || limit > MAX_BARS_LIMIT) {
    throw new AlpacaDataError(
      `limit must be 1..${MAX_BARS_LIMIT}`,
      "invalid-input",
    );
  }
  const lim = Math.floor(limit);
  const { value, hit } = await cached<DailyBarsResult>(
    `tp:bars:v1:${ticker}:${lim}`,
    BARS_TTL_SECONDS,
    () => fetchDailyBars(ticker, lim),
  );
  return { result: value, cacheHit: hit };
}

export const __cache = {
  quote: QUOTE_TTL_SECONDS,
  bars: BARS_TTL_SECONDS,
} as const;
