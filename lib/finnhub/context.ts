import "server-only";
import { z } from "zod";
import { cached } from "@/lib/redis";
import { finnhubFetch, normalizeTicker, FinnhubDataError } from "./data";

// Per-ticker context: known event risk + recent news + analyst consensus.
// Each section has its own Upstash cache. A failure in one section returns
// null for that section only — the panel still renders the rest. We never
// throw out of this module; it's optional decision-support data.

// -- Earnings -------------------------------------------------------------
//
// Finnhub /calendar/earnings?from=<today>&to=<+30d>&symbol=<t>
// Response shape:
//   { earningsCalendar: [{ date, epsActual, epsEstimate, symbol, ... }] }
// We surface only the next date that's >= today and the integer day count.

const RawEarningsSchema = z.object({
  earningsCalendar: z
    .array(
      z.object({
        date: z.string(),
        symbol: z.string(),
      }).passthrough(),
    )
    .nullable()
    .optional(),
});

export type EarningsContext = {
  nextEarningsDate: string | null;
  daysUntil: number | null;
};

const EARNINGS_TTL_SECONDS = 24 * 60 * 60;
const EARNINGS_LOOKAHEAD_DAYS = 30;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T00:00:00Z").getTime();
  const b = new Date(toISO + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

async function fetchEarnings(ticker: string): Promise<EarningsContext> {
  const from = todayISO();
  const to = addDaysISO(EARNINGS_LOOKAHEAD_DAYS);
  const raw = await finnhubFetch(
    `/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(ticker)}`,
  );
  const parsed = RawEarningsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FinnhubDataError(
      `unexpected /calendar/earnings payload: ${parsed.error.message}`,
      "schema-mismatch",
    );
  }
  const items = parsed.data.earningsCalendar ?? [];
  const today = todayISO();
  const upcoming = items
    .filter((it) => it.symbol.toUpperCase() === ticker && it.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const next = upcoming[0];
  if (!next) return { nextEarningsDate: null, daysUntil: null };
  return {
    nextEarningsDate: next.date,
    daysUntil: daysBetween(today, next.date),
  };
}

/**
 * Look up the next earnings date for a ticker within the next 30 days.
 * Returns `{ nextEarningsDate: null, daysUntil: null }` when nothing is
 * scheduled, or `null` if the Finnhub call fails — call sites must handle both.
 */
export async function getEarningsContext(
  rawTicker: string,
): Promise<EarningsContext | null> {
  const ticker = normalizeTicker(rawTicker);
  try {
    const { value } = await cached<EarningsContext>(
      `tp:ctx:earn:v1:${ticker}`,
      EARNINGS_TTL_SECONDS,
      () => fetchEarnings(ticker),
    );
    return value;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[finnhub] earnings failed for ${ticker}`, err);
    }
    return null;
  }
}

// -- News -----------------------------------------------------------------
//
// Finnhub /company-news?symbol=<t>&from=<-3d>&to=<today>
// Response: array of { id, headline, source, datetime (unix), url, ... }
// We keep the top 3 most-recent items.

const RawNewsItemSchema = z.object({
  headline: z.string(),
  source: z.string(),
  datetime: z.number(),
  url: z.string(),
}).passthrough();
const RawNewsSchema = z.array(RawNewsItemSchema);

export type NewsItem = {
  headline: string;
  source: string;
  datetime: string; // ISO
  url: string;
};

const NEWS_TTL_SECONDS = 30 * 60;
const NEWS_LOOKBACK_DAYS = 3;
const NEWS_MAX_ITEMS = 3;

async function fetchNews(ticker: string): Promise<NewsItem[]> {
  const to = todayISO();
  const from = addDaysISO(-NEWS_LOOKBACK_DAYS);
  const raw = await finnhubFetch(
    `/company-news?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}`,
  );
  const parsed = RawNewsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FinnhubDataError(
      `unexpected /company-news payload: ${parsed.error.message}`,
      "schema-mismatch",
    );
  }
  return parsed.data
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, NEWS_MAX_ITEMS)
    .map((it) => ({
      headline: it.headline,
      source: it.source,
      datetime: new Date(it.datetime * 1000).toISOString(),
      url: it.url,
    }));
}

export async function getNewsContext(
  rawTicker: string,
): Promise<NewsItem[] | null> {
  const ticker = normalizeTicker(rawTicker);
  try {
    const { value } = await cached<NewsItem[]>(
      `tp:ctx:news:v1:${ticker}`,
      NEWS_TTL_SECONDS,
      () => fetchNews(ticker),
    );
    return value;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[finnhub] news failed for ${ticker}`, err);
    }
    return null;
  }
}

// -- Recommendation trends ------------------------------------------------
//
// Finnhub /stock/recommendation?symbol=<t>
// Response: array of { buy, hold, sell, strongBuy, strongSell, period }.
// We surface only the most recent period.

const RawRecSchema = z.array(
  z.object({
    buy: z.number(),
    hold: z.number(),
    sell: z.number(),
    strongBuy: z.number(),
    strongSell: z.number(),
    period: z.string(),
  }).passthrough(),
);

export type RecommendationContext = {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
};

const REC_TTL_SECONDS = 24 * 60 * 60;

async function fetchRecommendation(
  ticker: string,
): Promise<RecommendationContext | null> {
  const raw = await finnhubFetch(
    `/stock/recommendation?symbol=${encodeURIComponent(ticker)}`,
  );
  const parsed = RawRecSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FinnhubDataError(
      `unexpected /stock/recommendation payload: ${parsed.error.message}`,
      "schema-mismatch",
    );
  }
  const sorted = [...parsed.data].sort((a, b) =>
    b.period.localeCompare(a.period),
  );
  const latest = sorted[0];
  if (!latest) return null;
  return {
    period: latest.period,
    strongBuy: latest.strongBuy,
    buy: latest.buy,
    hold: latest.hold,
    sell: latest.sell,
    strongSell: latest.strongSell,
  };
}

export async function getRecommendationContext(
  rawTicker: string,
): Promise<RecommendationContext | null> {
  const ticker = normalizeTicker(rawTicker);
  try {
    const { value } = await cached<RecommendationContext | null>(
      `tp:ctx:rec:v1:${ticker}`,
      REC_TTL_SECONDS,
      () => fetchRecommendation(ticker),
    );
    return value;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[finnhub] recommendation failed for ${ticker}`, err);
    }
    return null;
  }
}

// -- Bundled fetch --------------------------------------------------------

export type TickerContext = {
  earnings: EarningsContext | null;
  news: NewsItem[] | null;
  recommendation: RecommendationContext | null;
};

/**
 * Fetch all three context streams for a ticker in parallel. Each section
 * resolves independently — if one Finnhub endpoint fails, the other two
 * still come back.
 */
export async function getTickerContext(
  rawTicker: string,
): Promise<TickerContext> {
  const ticker = normalizeTicker(rawTicker);
  const [earnings, news, recommendation] = await Promise.all([
    getEarningsContext(ticker),
    getNewsContext(ticker),
    getRecommendationContext(ticker),
  ]);
  return { earnings, news, recommendation };
}

export const __cache = {
  earnings: EARNINGS_TTL_SECONDS,
  news: NEWS_TTL_SECONDS,
  recommendation: REC_TTL_SECONDS,
} as const;
