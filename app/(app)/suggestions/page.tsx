import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AddToWatchlistButton } from "./_components/add-to-watchlist-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suggestions · TradePilot" };

type ScanRow = {
  ticker: string;
  momentum: number;
  quote: { price: number; prevClose: number | null; high: number | null; low: number | null };
  breakdown: {
    trend: { value: number; rawLabel: string };
    volatility: { value: number; rawLabel: string };
  };
};

function MomentumBadge({ score }: { score: number }) {
  const color =
    score >= 65
      ? "bg-green-500/15 text-green-400"
      : score >= 40
        ? "bg-yellow-500/15 text-yellow-400"
        : "bg-red-500/15 text-red-400";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}

export default async function SuggestionsPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const today = new Date().toISOString().slice(0, 10);

  const [scanResult, watchlistResult] = await Promise.all([
    supabase
      .from("scanner_results")
      .select("ticker, momentum, quote, breakdown")
      .eq("user_id", user.id)
      .eq("scan_date", today)
      .order("momentum", { ascending: false })
      .limit(20),
    supabase
      .from("watchlist")
      .select("ticker")
      .eq("user_id", user.id),
  ]);

  const rows = (scanResult.data ?? []) as ScanRow[];
  const watchlistTickers = new Set(
    (watchlistResult.data ?? []).map((r) => r.ticker as string),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Suggestions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Top S&amp;P 500 tickers by today&apos;s momentum score — trend (55%) + volatility (45%).
          Scan runs automatically at 9:35 AM ET on weekdays.
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Scores reflect today&apos;s price action only. Set up entry / stop / target in
          my watchlist to unlock the full 4-factor score.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card/50 px-6 py-12 text-center space-y-2">
          <p className="text-sm font-medium text-foreground">No scan data for today yet</p>
          <p className="text-xs text-muted-foreground">
            The scanner runs weekdays at 9:35 AM ET. Check back after market open,
            or trigger a manual scan via the cron endpoint.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-card/30">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-8">#</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Ticker</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Price</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Momentum</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Trend</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Volatility</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-32"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const onWatchlist = watchlistTickers.has(row.ticker);
                const price = row.quote?.price ?? null;
                return (
                  <tr
                    key={row.ticker}
                    className="border-b border-border/50 last:border-0 hover:bg-foreground/[0.02] transition"
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono font-semibold text-sm">{row.ticker}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">
                      {price != null
                        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(price)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MomentumBadge score={row.momentum} />
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums">
                      {row.breakdown?.trend?.rawLabel ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums">
                      {row.breakdown?.volatility?.rawLabel ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {onWatchlist ? (
                        <span className="text-[11px] text-muted-foreground">On watchlist</span>
                      ) : (
                        <AddToWatchlistButton ticker={row.ticker} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Educational and decision-support only. Not financial advice. Markets involve risk.
      </p>
    </div>
  );
}
