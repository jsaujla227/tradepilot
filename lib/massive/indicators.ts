import "server-only";
import { z } from "zod";
import { cached } from "@/lib/redis";
import { normalizeTicker } from "@/lib/finnhub/data";
import { massiveFetch, MassiveDataError } from "./data";

// Technical indicators via the Massive API (Polygon.io rebranded).
// Endpoints: /v1/indicators/{sma|ema|rsi|macd}/{ticker}
// All return a `results.values` array ordered newest-first.

// 24 h cache — indicators only change each trading day.
const INDICATOR_TTL = 86_400;

const IndicatorValueSchema = z.object({
  timestamp: z.number(),
  value: z.number(),
});

const IndicatorResponseSchema = z.object({
  status: z.string(),
  results: z.object({
    values: z.array(IndicatorValueSchema),
  }),
});

const MACDValueSchema = z.object({
  timestamp: z.number(),
  value: z.number(),
  signal: z.number(),
  histogram: z.number(),
});

const MACDResponseSchema = z.object({
  status: z.string(),
  results: z.object({
    values: z.array(MACDValueSchema),
  }),
});

export type IndicatorPoint = { timestamp: number; value: number };
export type MACDPoint = {
  timestamp: number;
  value: number;
  signal: number;
  histogram: number;
};

async function fetchSMA(ticker: string, period: number): Promise<IndicatorPoint[]> {
  const raw = await massiveFetch(
    `/v1/indicators/sma/${encodeURIComponent(ticker)}?timespan=day&adjusted=true&window=${period}&series_type=close&limit=2`,
  );
  const parsed = IndicatorResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MassiveDataError(
      `unexpected SMA payload for ${ticker}: ${parsed.error.message}`,
      "schema-mismatch",
    );
  }
  return parsed.data.results.values;
}

async function fetchRSI(ticker: string, window: number): Promise<IndicatorPoint[]> {
  const raw = await massiveFetch(
    `/v1/indicators/rsi/${encodeURIComponent(ticker)}?timespan=day&adjusted=true&window=${window}&series_type=close&limit=2`,
  );
  const parsed = IndicatorResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MassiveDataError(
      `unexpected RSI payload for ${ticker}: ${parsed.error.message}`,
      "schema-mismatch",
    );
  }
  return parsed.data.results.values;
}

async function fetchMACD(ticker: string): Promise<MACDPoint[]> {
  const raw = await massiveFetch(
    `/v1/indicators/macd/${encodeURIComponent(ticker)}?timespan=day&adjusted=true&short_window=12&long_window=26&signal_window=9&series_type=close&limit=2`,
  );
  const parsed = MACDResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MassiveDataError(
      `unexpected MACD payload for ${ticker}: ${parsed.error.message}`,
      "schema-mismatch",
    );
  }
  return parsed.data.results.values;
}

/** Latest SMA for a given period (e.g. 50, 200). Returns null if unavailable. */
export async function getSMA(
  rawTicker: string,
  period: 50 | 200,
): Promise<{ value: number | null; cacheHit: boolean }> {
  const ticker = normalizeTicker(rawTicker);
  const { value, hit } = await cached<number | null>(
    `tp:massive:sma${period}:v1:${ticker}`,
    INDICATOR_TTL,
    async () => {
      const pts = await fetchSMA(ticker, period);
      return pts[0]?.value ?? null;
    },
  );
  return { value, cacheHit: hit };
}

/** Latest RSI-14. Returns null if unavailable. */
export async function getRSI(
  rawTicker: string,
): Promise<{ value: number | null; cacheHit: boolean }> {
  const ticker = normalizeTicker(rawTicker);
  const { value, hit } = await cached<number | null>(
    `tp:massive:rsi14:v1:${ticker}`,
    INDICATOR_TTL,
    async () => {
      const pts = await fetchRSI(ticker, 14);
      return pts[0]?.value ?? null;
    },
  );
  return { value, cacheHit: hit };
}

/** Latest MACD line, signal, and histogram. Returns null if unavailable. */
export async function getMACDSignal(
  rawTicker: string,
): Promise<{ value: MACDPoint | null; cacheHit: boolean }> {
  const ticker = normalizeTicker(rawTicker);
  const { value, hit } = await cached<MACDPoint | null>(
    `tp:massive:macd:v1:${ticker}`,
    INDICATOR_TTL,
    async () => {
      const pts = await fetchMACD(ticker);
      return pts[0] ?? null;
    },
  );
  return { value, cacheHit: hit };
}

/**
 * Fetch SMA50, SMA200, and RSI14 in parallel for a single ticker.
 * Returns nulls for any indicator that fails — callers must handle gracefully.
 */
export async function getIndicators(rawTicker: string): Promise<{
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
}> {
  const ticker = normalizeTicker(rawTicker);
  const [sma50Result, sma200Result, rsiResult] = await Promise.allSettled([
    getSMA(ticker, 50),
    getSMA(ticker, 200),
    getRSI(ticker),
  ]);
  return {
    sma50: sma50Result.status === "fulfilled" ? sma50Result.value.value : null,
    sma200: sma200Result.status === "fulfilled" ? sma200Result.value.value : null,
    rsi14: rsiResult.status === "fulfilled" ? rsiResult.value.value : null,
  };
}
