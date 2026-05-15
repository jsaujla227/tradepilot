import "server-only";
import { z } from "zod";
import { cached } from "@/lib/redis";
import { normalizeTicker } from "@/lib/finnhub/data";

// Alpha Vantage free tier: 5 req/min, 500 req/day.
// Unique value here: OVERVIEW endpoint with P/E, EPS, beta, 52-week range,
// sector — fundamental context not available from Massive or Finnhub free.

const BASE_URL = "https://www.alphavantage.co/query";

export class AlphaVantageError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "AlphaVantageError";
    this.code = code;
  }
}

function getApiKey(): string {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) {
    throw new AlphaVantageError(
      "Alpha Vantage credentials missing — set ALPHA_VANTAGE_API_KEY",
      "missing-credentials",
    );
  }
  return key;
}

async function avFetch(
  func: string,
  params: Record<string, string>,
): Promise<unknown> {
  const key = getApiKey();
  const qs = new URLSearchParams({ function: func, apikey: key, ...params });
  const res = await fetch(`${BASE_URL}?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AlphaVantageError(
      `Alpha Vantage request failed (${res.status}): ${body.slice(0, 200)}`,
      "request-failed",
    );
  }
  const json = (await res.json()) as Record<string, unknown>;
  // AV free tier returns a rate-limit note instead of data
  if ("Note" in json || "Information" in json) {
    throw new AlphaVantageError(
      `Alpha Vantage rate limit: ${String(json["Note"] ?? json["Information"]).slice(0, 120)}`,
      "rate-limited",
    );
  }
  return json;
}

// -- Company Overview --------------------------------------------------------

// AV returns everything as strings — coerce numeric fields.
const CompanyOverviewSchema = z.object({
  Symbol: z.string(),
  Name: z.string().optional(),
  Sector: z.string().optional(),
  Industry: z.string().optional(),
  MarketCapitalization: z.coerce.number().nullable().optional(),
  PERatio: z.preprocess(
    (v) => (v === "None" || v === "-" ? null : v),
    z.coerce.number().nullable().optional(),
  ),
  EPS: z.preprocess(
    (v) => (v === "None" || v === "-" ? null : v),
    z.coerce.number().nullable().optional(),
  ),
  Beta: z.preprocess(
    (v) => (v === "None" || v === "-" ? null : v),
    z.coerce.number().nullable().optional(),
  ),
  "52WeekHigh": z.preprocess(
    (v) => (v === "None" || v === "-" ? null : v),
    z.coerce.number().nullable().optional(),
  ),
  "52WeekLow": z.preprocess(
    (v) => (v === "None" || v === "-" ? null : v),
    z.coerce.number().nullable().optional(),
  ),
  DividendYield: z.preprocess(
    (v) => (v === "None" || v === "-" ? null : v),
    z.coerce.number().nullable().optional(),
  ),
  ForwardPE: z.preprocess(
    (v) => (v === "None" || v === "-" ? null : v),
    z.coerce.number().nullable().optional(),
  ),
  PriceToBookRatio: z.preprocess(
    (v) => (v === "None" || v === "-" ? null : v),
    z.coerce.number().nullable().optional(),
  ),
  AnalystTargetPrice: z.preprocess(
    (v) => (v === "None" || v === "-" ? null : v),
    z.coerce.number().nullable().optional(),
  ),
});

export type CompanyOverview = {
  ticker: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  peRatio: number | null;
  eps: number | null;
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  dividendYield: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  analystTargetPrice: number | null;
};

// 24 h cache — fundamentals don't change intraday.
const OVERVIEW_TTL = 86_400;

async function fetchCompanyOverview(ticker: string): Promise<CompanyOverview | null> {
  let raw: unknown;
  try {
    raw = await avFetch("OVERVIEW", { symbol: ticker });
  } catch (err) {
    if (err instanceof AlphaVantageError && err.code === "rate-limited") {
      throw err; // propagate rate-limit so callers can back off
    }
    return null;
  }
  const parsed = CompanyOverviewSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const d = parsed.data;
  // AV returns an empty object for unknown tickers
  if (!d.Symbol) return null;
  return {
    ticker: d.Symbol,
    name: d.Name ?? null,
    sector: d.Sector ?? null,
    industry: d.Industry ?? null,
    marketCap: d.MarketCapitalization ?? null,
    peRatio: d.PERatio ?? null,
    eps: d.EPS ?? null,
    beta: d.Beta ?? null,
    week52High: d["52WeekHigh"] ?? null,
    week52Low: d["52WeekLow"] ?? null,
    dividendYield: d.DividendYield ?? null,
    forwardPE: d.ForwardPE ?? null,
    priceToBook: d.PriceToBookRatio ?? null,
    analystTargetPrice: d.AnalystTargetPrice ?? null,
  };
}

/**
 * Company fundamentals from Alpha Vantage. Cached 24 h.
 * Returns null gracefully if the ticker is unknown or the rate limit is hit.
 */
export async function getCompanyOverview(
  rawTicker: string,
): Promise<{ overview: CompanyOverview | null; cacheHit: boolean }> {
  const ticker = normalizeTicker(rawTicker);
  const { value, hit } = await cached<CompanyOverview | null>(
    `tp:av:overview:v1:${ticker}`,
    OVERVIEW_TTL,
    () => fetchCompanyOverview(ticker),
  );
  return { overview: value, cacheHit: hit };
}
