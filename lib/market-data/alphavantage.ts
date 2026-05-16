import "server-only";
import { z } from "zod";
import { cached } from "@/lib/redis";
import { TICKER_REGEX } from "@/lib/ticker";

// Alpha Vantage client. Used for fundamentals (P/E, EPS, market cap, sector)
// and technical indicators (RSI, MACD).
//
// Free tier: 5 calls/min, 500/day. We cache aggressively:
//   - Company overview: 24h (changes only on filings)
//   - RSI / MACD daily: 1h (changes once per trading day)
//
// Auth: ?apikey=<key> query parameter (the only auth option Alpha Vantage
// offers; the key is server-only and never reaches the browser).

const BASE_URL = "https://www.alphavantage.co/query";

export class AlphaVantageError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.name = "AlphaVantageError";
    this.code = code;
    this.status = status;
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

export function hasAlphaVantageCreds(): boolean {
  return Boolean(process.env.ALPHA_VANTAGE_API_KEY);
}

async function alphaFetch(params: Record<string, string>): Promise<unknown> {
  const key = getApiKey();
  const qs = new URLSearchParams({ ...params, apikey: key });
  const res = await fetch(`${BASE_URL}?${qs.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AlphaVantageError(
      `alpha vantage request failed (${res.status}): ${body.slice(0, 200)}`,
      "request-failed",
      res.status,
    );
  }
  const json = (await res.json()) as unknown;
  // Alpha Vantage returns 200 OK with a `Note` or `Information` field when
  // the rate limit is exceeded. We surface it as a typed error so callers
  // can distinguish "no data" from "throttled".
  if (typeof json === "object" && json !== null) {
    const j = json as Record<string, unknown>;
    if (typeof j["Note"] === "string") {
      throw new AlphaVantageError(String(j["Note"]), "rate-limited", 429);
    }
    if (typeof j["Information"] === "string" && !j["Symbol"]) {
      throw new AlphaVantageError(
        String(j["Information"]),
        "rate-limited",
        429,
      );
    }
  }
  return json;
}

function normalizeTicker(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (!TICKER_REGEX.test(t)) {
    throw new AlphaVantageError(`invalid ticker: ${raw}`, "invalid-ticker");
  }
  return t;
}

function parseNum(v: unknown): number | null {
  if (typeof v !== "string") return null;
  if (v === "None" || v === "-" || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// -- Company Overview (fundamentals) --------------------------------------
//
// function=OVERVIEW returns ~50 fields. We expose a curated subset that's
// directly useful in the cockpit (decision support, not statement parsing).

const RawOverviewSchema = z
  .object({
    Symbol: z.string().optional(),
    Name: z.string().optional(),
    Sector: z.string().optional(),
    Industry: z.string().optional(),
    MarketCapitalization: z.string().optional(),
    PERatio: z.string().optional(),
    EPS: z.string().optional(),
    DividendYield: z.string().optional(),
    Beta: z.string().optional(),
    "52WeekHigh": z.string().optional(),
    "52WeekLow": z.string().optional(),
    AnalystTargetPrice: z.string().optional(),
  })
  .passthrough();

export type CompanyOverview = {
  ticker: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  peRatio: number | null;
  eps: number | null;
  dividendYield: number | null;
  beta: number | null;
  weekHigh52: number | null;
  weekLow52: number | null;
  analystTargetPrice: number | null;
};

const OVERVIEW_TTL_SECONDS = 24 * 60 * 60; // 24h

export async function getCompanyOverview(
  rawTicker: string,
): Promise<CompanyOverview | null> {
  const ticker = normalizeTicker(rawTicker);
  const { value } = await cached<CompanyOverview | null>(
    `tp:av:overview:v1:${ticker}`,
    OVERVIEW_TTL_SECONDS,
    async () => {
      const raw = await alphaFetch({ function: "OVERVIEW", symbol: ticker });
      const parsed = RawOverviewSchema.safeParse(raw);
      if (!parsed.success || !parsed.data.Symbol) return null;
      return {
        ticker,
        name: parsed.data.Name ?? null,
        sector: parsed.data.Sector ?? null,
        industry: parsed.data.Industry ?? null,
        marketCap: parseNum(parsed.data.MarketCapitalization),
        peRatio: parseNum(parsed.data.PERatio),
        eps: parseNum(parsed.data.EPS),
        dividendYield: parseNum(parsed.data.DividendYield),
        beta: parseNum(parsed.data.Beta),
        weekHigh52: parseNum(parsed.data["52WeekHigh"]),
        weekLow52: parseNum(parsed.data["52WeekLow"]),
        analystTargetPrice: parseNum(parsed.data.AnalystTargetPrice),
      };
    },
  );
  return value;
}

// -- RSI -------------------------------------------------------------------
//
// function=RSI returns { "Technical Analysis: RSI": { "YYYY-MM-DD": { RSI: "x" } } }.
// We return only the most recent value — that's what the agent and UI use.

const INDICATOR_TTL_SECONDS = 60 * 60; // 1h

export type IndicatorReading = {
  value: number;
  asOf: string;
};

export async function getRSI(
  rawTicker: string,
  period = 14,
  interval: "daily" | "60min" | "30min" | "15min" | "5min" = "daily",
): Promise<IndicatorReading | null> {
  const ticker = normalizeTicker(rawTicker);
  const { value } = await cached<IndicatorReading | null>(
    `tp:av:rsi:v1:${ticker}:${period}:${interval}`,
    INDICATOR_TTL_SECONDS,
    async () => {
      const raw = await alphaFetch({
        function: "RSI",
        symbol: ticker,
        interval,
        time_period: String(period),
        series_type: "close",
      });
      const series = (raw as Record<string, unknown>)["Technical Analysis: RSI"];
      if (!series || typeof series !== "object") return null;
      const entries = Object.entries(series as Record<string, unknown>);
      if (entries.length === 0) return null;
      // entries are ordered most-recent-first by Alpha Vantage convention
      const [asOf, payload] = entries[0]!;
      const rsi = parseNum(
        (payload as Record<string, unknown>)["RSI"],
      );
      if (rsi == null) return null;
      return { value: rsi, asOf };
    },
  );
  return value;
}

// -- MACD ------------------------------------------------------------------

export type MacdReading = {
  macd: number;
  signal: number;
  histogram: number;
  asOf: string;
};

export async function getMACD(
  rawTicker: string,
  interval: "daily" | "60min" | "30min" | "15min" | "5min" = "daily",
): Promise<MacdReading | null> {
  const ticker = normalizeTicker(rawTicker);
  const { value } = await cached<MacdReading | null>(
    `tp:av:macd:v1:${ticker}:${interval}`,
    INDICATOR_TTL_SECONDS,
    async () => {
      const raw = await alphaFetch({
        function: "MACD",
        symbol: ticker,
        interval,
        series_type: "close",
      });
      const series = (raw as Record<string, unknown>)["Technical Analysis: MACD"];
      if (!series || typeof series !== "object") return null;
      const entries = Object.entries(series as Record<string, unknown>);
      if (entries.length === 0) return null;
      const [asOf, payload] = entries[0]!;
      const p = payload as Record<string, unknown>;
      const macd = parseNum(p["MACD"]);
      const signal = parseNum(p["MACD_Signal"]);
      const hist = parseNum(p["MACD_Hist"]);
      if (macd == null || signal == null || hist == null) return null;
      return { macd, signal, histogram: hist, asOf };
    },
  );
  return value;
}
