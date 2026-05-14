import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getQuotesMap } from "@/lib/finnhub/data";
import { getEarningsContext } from "@/lib/finnhub/context";
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

  // Fetch live quotes (Upstash 60 s cache) and cached earnings context.
  // Earnings cache is warmed by the daily context-refresh cron, so this is
  // essentially a Redis read for each ticker.
  const tickers = items.map((i) => i.ticker as string);
  const [quotesMap, earningsList] = await Promise.all([
    tickers.length > 0
      ? getQuotesMap(tickers)
      : Promise.resolve({} as Awaited<ReturnType<typeof getQuotesMap>>),
    Promise.all(tickers.map((t) => getEarningsContext(t))),
  ]);
  type Earnings = Awaited<ReturnType<typeof getEarningsContext>>;
  const earningsMap = new Map<string, Earnings>(
    tickers.map((t, i) => [t, earningsList[i] ?? null]),
  );

  const scored: ScoredWatchlistItem[] = items.map((item) => {
    const ticker = item.ticker as string;
    const quote = quotesMap[ticker] ?? null;
    const earnings = earningsMap.get(ticker) ?? null;
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
          Score = trend ×25% + volatility ×20% + R-multiple ×25% + liquidity
          ×10% + event risk ×20%. Click any input row to see the math.
        </p>
      </div>

      <AddWatchlistForm />

      <WatchlistTable items={scored} />
    </div>
  );
}
