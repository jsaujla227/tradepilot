import { redirect } from "next/navigation";
import { getUserAndProfile } from "@/lib/profile";
import {
  getHoldingsView,
  getRecentTransactions,
  getPortfolioHeat,
} from "@/lib/portfolio";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HoldingsTable } from "./_components/holdings-table";
import { PortfolioHeatCard } from "./_components/portfolio-heat-card";
import { AddTransactionForm } from "./_components/add-transaction-form";
import { TransactionsList } from "./_components/transactions-list";
import { formatPct } from "@/lib/format";

export const metadata = { title: "Portfolio · TradePilot" };

// Holdings query hits Alpaca for live quotes — skip Next.js's static cache so
// every reload reads through to the 60s Upstash layer.
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const session = await getUserAndProfile();
  if (!session) redirect("/login?next=/portfolio");

  const supabase = await createSupabaseServerClient();

  const [holdingsSettled, txSettled] = await Promise.allSettled([
    getHoldingsView(),
    getRecentTransactions(50),
  ]);
  const holdingsView =
    holdingsSettled.status === "fulfilled"
      ? holdingsSettled.value
      : {
          holdings: [],
          total_cost_basis: 0,
          total_market_value: null,
          total_open_pnl: null,
          priced_count: 0,
          quotes_attempted: false,
        };
  const transactions =
    txSettled.status === "fulfilled" ? txSettled.value : [];

  const heat = await getPortfolioHeat(
    holdingsView,
    session.profile.account_size_initial,
    session.profile.max_portfolio_heat_pct,
  );

  // Sector concentration: warn when any sector > 25% of priced holdings.
  // ticker_meta read is non-essential, so a failure should not break the page.
  const tickers = holdingsView.holdings.map((h) => h.ticker);
  let concentratedSectors: { sector: string; pct: number }[] = [];
  if (tickers.length > 0 && supabase && holdingsView.total_market_value) {
    const { data: metaRows, error: metaErr } = await supabase
      .from("ticker_meta")
      .select("ticker, sector")
      .eq("user_id", session.userId)
      .in("ticker", tickers);

    if (!metaErr) {
      const sectorMap = Object.fromEntries(
        (metaRows ?? []).map((r) => [r.ticker as string, r.sector as string]),
      );
      const sectorMv: Record<string, number> = {};
      for (const h of holdingsView.holdings) {
        if (h.market_value == null) continue;
        const sector = sectorMap[h.ticker] ?? "Untagged";
        sectorMv[sector] = (sectorMv[sector] ?? 0) + h.market_value;
      }
      const totalMv = holdingsView.total_market_value;
      concentratedSectors = Object.entries(sectorMv)
        .filter(([, mv]) => (mv / totalMv) * 100 > 25)
        .map(([sector, mv]) => ({
          sector,
          pct: (mv / totalMv) * 100,
        }));
    }
  }

  const description = holdingsView.quotes_attempted
    ? "Live prices refresh every 60 seconds. Open P/L is market value minus cost basis."
    : "Set FINNHUB_API_KEY to unlock live prices and open P/L.";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:py-14 space-y-8">
      <header>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <div aria-hidden className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
          <span>My portfolio</span>
        </div>
        <div className="mt-2 flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed max-w-2xl">
              {description}
            </p>
          </div>
          <a
            href="/api/portfolio/export"
            className="text-xs rounded-md border border-border bg-card px-3 py-1.5 text-foreground hover:bg-card/80 transition"
            download
          >
            Export CSV
          </a>
        </div>
      </header>

      {heat && (
        <PortfolioHeatCard
          heat={heat}
          maxHeatPct={session.profile.max_portfolio_heat_pct}
        />
      )}

      {concentratedSectors.length > 0 && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 space-y-1">
          <p className="text-sm font-medium text-yellow-400">
            High sector concentration — review position size
          </p>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {concentratedSectors.map(({ sector, pct }) => (
              <li key={sector}>
                <span className="font-medium">{sector}</span>:{" "}
                {formatPct(pct)} of portfolio — above 25% threshold.
                {" "}
                <span className="opacity-70">
                  Why? Concentration in one sector amplifies losses if that sector corrects.
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <HoldingsTable view={holdingsView} />

      <AddTransactionForm />

      <TransactionsList transactions={transactions} />
    </div>
  );
}
