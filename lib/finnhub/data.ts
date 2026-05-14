import "server-only";
import { z } from "zod";
import { cached } from "@/lib/redis";
import { TICKER_REGEX } from "@/lib/ticker";

// Finnhub market-data client. Free tier covers US-stock /quote endpoint with
// 60 calls/min — plenty for a single-user cockpit on a 60s cache. Historical
// candles moved behind a paywall in late 2024, so bars are deferred to M8
// where the scoring engine will pick a bars-friendly vendor.

const BASE_URL = "https://finnhub.io/api/v1";

const TICKER_RE = TICKER_REGEX;

export class FinnhubDataError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.name = "FinnhubDataError";
    this.code = code;
    this.status = status;
  }
}

/** Uppercase + validate a ticker against `^[A-Z][A-Z0-9.-]{0,9}$`. */
export function normalizeTicker(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (!TICKER_RE.test(t)) {
    throw new FinnhubDataError(`invalid ticker: ${raw}`, "invalid-ticker");
  }
  return t;
}

function getApiKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    throw new FinnhubDataError(
      "Finnhub credentials missing — set FINNHUB_API_KEY",
      "missing-credentials",
    );
  }
  return key;
}

export async function finnhubFetch(path: string): Promise<unknown> {
  const key = getApiKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "X-Finnhub-Token": key,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new FinnhubDataError(
      `finnhub request failed (${res.status}): ${body.slice(0, 200)}`,
      "request-failed",
      res.status,
    );
  }
  return res.json();
}

// -- Quotes ---------------------------------------------------------------
//
// Finnhub /quote returns the day's pricing snapshot. We map it onto the
// vendor-neutral `Quote` shape so the rest of the cockpit doesn't care which
// data vendor is wired up.
//
// Shape: { c, d, dp, h, l, o, pc, t }
//   c  = current price
//   t  = unix seconds; 0 when the symbol is unknown
// When Finnhub doesn't recognize a symbol it returns all zeros + t=0 — that's
// our cue to throw `unknown-ticker` rather than persist a $0 fill price.

const RawQuoteSchema = z.object({
  c: z.number(),
  d: z.number().nullable().optional(),
  dp: z.number().nullable().optional(),
  h: z.number().nullable().optional(),
  l: z.number().nullable().optional(),
  o: z.number().nullable().optional(),
  pc: z.number().nullable().optional(),
  t: z.number(),
});

export type Quote = {
  ticker: string;
  price: number;
  prevClose: number | null;
  high: number | null;
  low: number | null;
  asOf: string;
};

const QUOTE_TTL_SECONDS = 60;

async function fetchQuote(ticker: string): Promise<Quote> {
  const raw = await finnhubFetch(
    `/quote?symbol=${encodeURIComponent(ticker)}`,
  );
  const parsed = RawQuoteSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FinnhubDataError(
      `unexpected /quote payload: ${parsed.error.message}`,
      "schema-mismatch",
    );
  }
  const { c, pc, t } = parsed.data;
  if (t === 0 || c <= 0) {
    throw new FinnhubDataError(
      `unknown ticker ${ticker}`,
      "unknown-ticker",
      404,
    );
  }
  return {
    ticker,
    price: c,
    prevClose: pc ?? null,
    high: parsed.data.h ?? null,
    low: parsed.data.l ?? null,
    asOf: new Date(t * 1000).toISOString(),
  };
}

export async function getQuote(
  rawTicker: string,
): Promise<{ quote: Quote; cacheHit: boolean }> {
  const ticker = normalizeTicker(rawTicker);
  const { value, hit } = await cached<Quote>(
    `tp:quote:v2:${ticker}`,
    QUOTE_TTL_SECONDS,
    () => fetchQuote(ticker),
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
          console.warn(`[finnhub] quote failed for ${ticker}`, err);
        }
        return [ticker, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

export const __cache = {
  quote: QUOTE_TTL_SECONDS,
} as const;
