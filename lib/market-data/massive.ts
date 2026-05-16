import "server-only";
import { z } from "zod";
import { cached } from "@/lib/redis";
import { TICKER_REGEX } from "@/lib/ticker";

// Massive.com (formerly Polygon.io — rebranded Oct 30 2025) client.
// Used for:
//   - getMarketStatus(): is the US market open right now (catches holidays
//     that simple weekday-only cron schedules miss)
//   - getBars(): historical OHLC aggregates for charts and the agent's
//     ATR-based stop calculations
//
// Auth: Bearer token (api.massive.com still accepts api.polygon.io URLs
// during the transition; we use the new host).

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
      "Massive.com credentials missing — set MASSIVE_API_KEY",
      "missing-credentials",
    );
  }
  return key;
}

export function hasMassiveCreds(): boolean {
  return Boolean(process.env.MASSIVE_API_KEY);
}

async function massiveFetch(path: string): Promise<unknown> {
  const key = getApiKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new MassiveDataError(
      `massive request failed (${res.status}): ${body.slice(0, 200)}`,
      "request-failed",
      res.status,
    );
  }
  return res.json();
}

// -- Market status --------------------------------------------------------
//
// /v1/marketstatus/now returns { market, serverTime, exchanges{...}, ... }.
// `market` is "open" | "closed" | "extended-hours". Crons use this to skip
// runs on holidays (the M-F cron schedule already covers weekends).

const RawMarketStatusSchema = z.object({
  market: z.string(),
  serverTime: z.string().optional(),
});

export type MarketStatus = {
  market: "open" | "closed" | "extended-hours" | "unknown";
  asOf: string;
};

const MARKET_STATUS_TTL_SECONDS = 60;

export async function getMarketStatus(): Promise<MarketStatus> {
  const { value } = await cached<MarketStatus>(
    `tp:massive:marketstatus:v1`,
    MARKET_STATUS_TTL_SECONDS,
    async () => {
      const raw = await massiveFetch("/v1/marketstatus/now");
      const parsed = RawMarketStatusSchema.safeParse(raw);
      if (!parsed.success) {
        throw new MassiveDataError(
          `unexpected /v1/marketstatus/now payload: ${parsed.error.message}`,
          "schema-mismatch",
        );
      }
      const m = parsed.data.market.toLowerCase();
      const market: MarketStatus["market"] =
        m === "open" || m === "closed" || m === "extended-hours"
          ? (m as MarketStatus["market"])
          : "unknown";
      return { market, asOf: parsed.data.serverTime ?? new Date().toISOString() };
    },
  );
  return value;
}

/** True when US equities are currently tradeable (regular session). */
export async function isMarketOpen(): Promise<boolean> {
  try {
    const status = await getMarketStatus();
    return status.market === "open";
  } catch {
    // If Massive is down or the key is missing, fall back to "open" so the
    // weekday cron schedule still runs. Holiday filtering is a nice-to-have.
    return true;
  }
}

// -- Aggregates (OHLC bars) -----------------------------------------------
//
// /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}
//   multiplier: integer (1, 5, 15, ...)
//   timespan:   "minute" | "hour" | "day" | "week" | "month" | ...
//   from/to:    YYYY-MM-DD or unix ms
//
// Response: { results: [{ v, vw, o, c, h, l, t, n }], status, resultsCount }
//   t = unix ms · o/h/l/c = price · v = volume · n = num trades

const RawAggResultSchema = z.object({
  t: z.number(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number().optional(),
});
const RawAggsSchema = z.object({
  status: z.string().optional(),
  results: z.array(RawAggResultSchema).optional(),
});

export type Bar = {
  /** Unix milliseconds (open of the bar). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Timespan = "minute" | "hour" | "day" | "week" | "month";

const BARS_TTL_SECONDS = 60 * 60; // 1h — bars are immutable once the period closes

export async function getBars(
  rawTicker: string,
  multiplier: number,
  timespan: Timespan,
  from: string,
  to: string,
): Promise<Bar[]> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!TICKER_REGEX.test(ticker)) {
    throw new MassiveDataError(`invalid ticker: ${rawTicker}`, "invalid-ticker");
  }
  const cacheKey = `tp:massive:bars:v1:${ticker}:${multiplier}:${timespan}:${from}:${to}`;
  const { value } = await cached<Bar[]>(cacheKey, BARS_TTL_SECONDS, async () => {
    const path = `/v2/aggs/ticker/${encodeURIComponent(
      ticker,
    )}/range/${multiplier}/${timespan}/${encodeURIComponent(from)}/${encodeURIComponent(
      to,
    )}?adjusted=true&sort=asc&limit=5000`;
    const raw = await massiveFetch(path);
    const parsed = RawAggsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new MassiveDataError(
        `unexpected /v2/aggs payload: ${parsed.error.message}`,
        "schema-mismatch",
      );
    }
    return (parsed.data.results ?? []).map((r) => ({
      time: r.t,
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v ?? 0,
    }));
  });
  return value;
}
