import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getHoldings } from "@/lib/portfolio";

export type UserTicker = {
  ticker: string;
  source: "watchlist" | "holding" | "both";
};

/**
 * Returns the signed-in user's distinct tickers — union of their watchlist
 * and current holdings. Used by the ticker picker to auto-populate prices in
 * the order form and risk calculators. Sorted alphabetically.
 *
 * Returns [] when not signed in or when both queries fail.
 */
export async function getUserTickers(): Promise<UserTicker[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  const [watchlistRes, holdings] = await Promise.all([
    supabase.from("watchlist").select("ticker"),
    getHoldings(),
  ]);

  const watchSet = new Set<string>(
    (watchlistRes.data ?? []).map((row) => String(row.ticker).toUpperCase()),
  );
  const holdSet = new Set<string>(
    holdings.map((h) => h.ticker.toUpperCase()),
  );

  const all = new Set<string>([...watchSet, ...holdSet]);
  return Array.from(all)
    .sort()
    .map((ticker) => {
      const inWatch = watchSet.has(ticker);
      const inHold = holdSet.has(ticker);
      const source: UserTicker["source"] =
        inWatch && inHold ? "both" : inHold ? "holding" : "watchlist";
      return { ticker, source };
    });
}
