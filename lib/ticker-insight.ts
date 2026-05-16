import "server-only";
import { getTickerContext, type TickerContext } from "@/lib/finnhub/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getHoldingsView } from "@/lib/portfolio";
import { tickerSchema } from "@/lib/ticker";
import {
  getCompanyOverview,
  getRSI,
  getMACD,
  hasAlphaVantageCreds,
  type CompanyOverview,
  type IndicatorReading,
  type MacdReading,
} from "@/lib/market-data/alphavantage";

// Decision-support snapshot for a single ticker: known events, recent news,
// analyst consensus, and a sector-exposure projection if the user supplies a
// proposed notional. All sections degrade gracefully — a failure in one does
// not block the others.

const SECTOR_THRESHOLD_PCT = 25;

export type SectorExposure = {
  /** Sector tag from `ticker_meta`, null when the user hasn't tagged the ticker. */
  sector: string | null;
  /** Current sector weight in the portfolio, 0–100. */
  currentPct: number;
  /** Weight after adding the proposed position; null when portfolio is empty
   *  or the proposed notional was not provided. */
  projectedPct: number | null;
  /** True when projectedPct exceeds the 25 % threshold. */
  exceedsThreshold: boolean;
  threshold: number;
};

export type TickerInsight = {
  ticker: string;
  context: TickerContext;
  sectorExposure: SectorExposure | null;
  fundamentals: CompanyOverview | null;
  rsi: IndicatorReading | null;
  macd: MacdReading | null;
};

export async function getTickerInsight(
  rawTicker: string,
  proposedNotional: number | null,
): Promise<TickerInsight | null> {
  const parsed = tickerSchema.safeParse(rawTicker);
  if (!parsed.success) return null;
  const ticker = parsed.data;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    const context = await getTickerContext(ticker);
    return { ticker, context, sectorExposure: null, fundamentals: null, rsi: null, macd: null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Alpha Vantage calls are best-effort — free tier is 5 calls/min, so any
  // single panel load could hit a rate limit. We swallow per-source errors
  // and return null for that field rather than failing the whole insight.
  const avEnabled = hasAlphaVantageCreds();

  const [context, sectorRow, holdingsView, fundamentals, rsi, macd] = await Promise.all([
    getTickerContext(ticker),
    supabase
      .from("ticker_meta")
      .select("sector")
      .eq("user_id", user.id)
      .eq("ticker", ticker)
      .maybeSingle(),
    getHoldingsView(),
    avEnabled ? getCompanyOverview(ticker).catch(() => null) : Promise.resolve(null),
    avEnabled ? getRSI(ticker).catch(() => null) : Promise.resolve(null),
    avEnabled ? getMACD(ticker).catch(() => null) : Promise.resolve(null),
  ]);

  const sector = (sectorRow.data?.sector as string | null) ?? null;
  const sectorExposure = await buildSectorExposure({
    supabase,
    userId: user.id,
    ticker,
    sector,
    proposedNotional,
    portfolioValue: holdingsView.total_market_value ?? holdingsView.total_cost_basis,
    holdings: holdingsView.holdings,
  });

  return { ticker, context, sectorExposure, fundamentals, rsi, macd };
}

type SupabaseLike = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

async function buildSectorExposure(args: {
  supabase: SupabaseLike;
  userId: string;
  ticker: string;
  sector: string | null;
  proposedNotional: number | null;
  portfolioValue: number;
  holdings: Awaited<ReturnType<typeof getHoldingsView>>["holdings"];
}): Promise<SectorExposure | null> {
  const { supabase, userId, ticker, sector, proposedNotional, portfolioValue, holdings } = args;

  // No sector tag → we can't classify exposure. Surface this so the UI can
  // prompt the user to tag the ticker.
  if (!sector) {
    return {
      sector: null,
      currentPct: 0,
      projectedPct: null,
      exceedsThreshold: false,
      threshold: SECTOR_THRESHOLD_PCT,
    };
  }

  const tickers = holdings.map((h) => h.ticker).filter((t) => t !== ticker);
  let sectorMap = new Map<string, string>();
  if (tickers.length > 0) {
    const { data } = await supabase
      .from("ticker_meta")
      .select("ticker, sector")
      .eq("user_id", userId)
      .in("ticker", tickers);
    sectorMap = new Map(
      (data ?? [])
        .filter((r) => typeof r.sector === "string")
        .map((r) => [r.ticker as string, r.sector as string]),
    );
  }

  const currentSectorValue = holdings.reduce((sum, h) => {
    const value = h.market_value ?? h.cost_basis;
    if (h.ticker === ticker) return sum + value;
    return sectorMap.get(h.ticker) === sector ? sum + value : sum;
  }, 0);

  const safePortfolioValue = portfolioValue > 0 ? portfolioValue : 0;
  const currentPct =
    safePortfolioValue > 0
      ? (currentSectorValue / safePortfolioValue) * 100
      : 0;

  let projectedPct: number | null = null;
  if (proposedNotional != null && proposedNotional > 0) {
    const newPortfolioValue = safePortfolioValue + proposedNotional;
    const newSectorValue = currentSectorValue + proposedNotional;
    projectedPct =
      newPortfolioValue > 0
        ? (newSectorValue / newPortfolioValue) * 100
        : null;
  }

  const exceedsThreshold =
    projectedPct != null && projectedPct > SECTOR_THRESHOLD_PCT;

  return {
    sector,
    currentPct,
    projectedPct,
    exceedsThreshold,
    threshold: SECTOR_THRESHOLD_PCT,
  };
}
