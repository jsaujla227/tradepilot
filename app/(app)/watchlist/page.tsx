import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getQuotesMap } from "@/lib/finnhub/data";
import { getEarningsContext } from "@/lib/finnhub/context";
import { getIndicators } from "@/lib/massive/indicators";
import { getPreviousClose } from "@/lib/massive/data";
import { scoreWatchlistItem } from "@/lib/scoring";
import { type ScoredWatchlistItem, WatchlistTable } from "./_components/watchlist-table";
import { AddWatchlistForm } from "./_components/add-watchlist-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchlist · TradePilot" };

export default async function WatchlistPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [watchlistResult, metaResult] = await Promise.all([
    supabase
      .from("watchlist")
      .select(
        "id, ticker, target_entry, target_stop, target_price, reason, notes, added_at",
      )
      .order("added_at", { ascending: false }),
    supabase
      .from("ticker_meta")
      .select("ticker, sector")
      .eq("user_id", user.id),
  ]);

  const items = watchlistResult.data ?? [];
  const metaRows = metaResult.data ?? [];
  const sectorMap = Object.fromEntries(
    metaRows.map((r) => [r.ticker as string, r.sector as string | null]),
  );

  // Fetch live quotes (Upstash 60 s cache), earnings context, and technical
  // indicators. Indicator + earnings caches are warmed by the context-refresh
  // cron — cache misses fall through to a live fetch. All vendor calls are
  // best-effort: failures return null and the score degrades gracefully.
  const tickers = items.map((i) => i.ticker as string);
  const [quotesMap, earningsList, indicatorsList, prevCloseList] = await Promise.all([
    tickers.length > 0
      ? getQuotesMap(tickers)
      : Promise.resolve({} as Awaited<ReturnType<typeof getQuotesMap>>),
    Promise.all(tickers.map((t) => getEarningsContext(t).catch(() => null))),
    Promise.all(
      tickers.map((t) =>
        getIndicators(t).catch(() => ({ sma50: null, sma200: null, rsi14: null })),
      ),
    ),
    Promise.all(
      tickers.map((t) => getPreviousClose(t).catch(() => ({ bar: null, cacheHit: false }))),
    ),
  ]);
  type Earnings = Awaited<ReturnType<typeof getEarningsContext>>;
  const earningsMap = new Map<string, Earnings>(
    tickers.map((t, i) => [t, earningsList[i] ?? null]),
  );
  const indicatorsMap = new Map(tickers.map((t, i) => [t, indicatorsList[i]!]));
  const prevCloseMap = new Map(tickers.map((t, i) => [t, prevCloseList[i]!.bar]));

  const scored: ScoredWatchlistItem[] = items.map((item) => {
    const ticker = item.ticker as string;
    const quote = quotesMap[ticker] ?? null;
    const earnings = earningsMap.get(ticker) ?? null;
    const indicators = indicatorsMap.get(ticker);
    const prevCloseBar = prevCloseMap.get(ticker) ?? null;
    const avgDollarVolume =
      prevCloseBar != null
        ? prevCloseBar.volume * (prevCloseBar.vwap ?? prevCloseBar.close)
        : null;
    const score = quote
      ? scoreWatchlistItem({
          price: quote.price,
          prevClose: quote.prevClose,
          high: quote.high,
          low: quote.low,
          targetEntry:
            item.target_entry != null ? Number(item.target_entry) : null,
          targetStop:
            item.target_stop != null ? Number(item.target_stop) : null,
          targetPrice:
            item.target_price != null ? Number(item.target_price) : null,
          daysToEarnings: earnings?.daysUntil ?? null,
          avgDollarVolume,
          sma50: indicators?.sma50 ?? null,
          sma200: indicators?.sma200 ?? null,
          rsi14: indicators?.rsi14 ?? null,
        })
      : null;

    return {
      id: item.id as string,
      ticker,
      sector: sectorMap[ticker] ?? null,
      target_entry:
        item.target_entry != null ? Number(item.target_entry) : null,
      target_stop: item.target_stop != null ? Number(item.target_stop) : null,
      target_price:
        item.target_price != null ? Number(item.target_price) : null,
      reason: (item.reason as string | null) ?? null,
      notes: (item.notes as string | null) ?? null,
      added_at: item.added_at as string,
      price: quote?.price ?? null,
      score,
    };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">My watchlist</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Score = trend ×20% + volatility ×15% + R-multiple ×20% + liquidity
          ×10% + event risk ×15% + long trend ×12% + RSI ×8%. Click any input
          row to see the math.
        </p>
      </div>

      <AddWatchlistForm />

      <WatchlistTable items={scored} />
    </div>
  );
}
