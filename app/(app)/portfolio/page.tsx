import { redirect } from "next/navigation";
import { getUserAndProfile, DEFAULT_PROFILE } from "@/lib/profile";
import { getHoldingsView, getRecentTransactions } from "@/lib/portfolio";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HoldingsTable } from "./_components/holdings-table";
import { AddTransactionForm } from "./_components/add-transaction-form";
import { TransactionsList } from "./_components/transactions-list";
import { EquityCurve } from "./_components/equity-curve";
import { formatPct, formatMoney } from "@/lib/format";

export const metadata = { title: "Portfolio · TradePilot" };

// Holdings query hits Alpaca for live quotes — skip Next.js's static cache so
// every reload reads through to the 60s Upstash layer.
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const session = await getUserAndProfile();
  if (!session) redirect("/login?next=/portfolio");

  const supabase = await createSupabaseServerClient();

  // Last 90 days of daily equity snapshots for the chart
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sinceDate = ninetyDaysAgo.toISOString().slice(0, 10);

  const [holdingsView, transactions, snapshotResult] = await Promise.all([
    getHoldingsView(),
    getRecentTransactions(50),
    supabase
      ? supabase
          .from("portfolio_snapshots")
          .select("snapshot_date, total_value")
          .eq("user_id", session.userId)
          .gte("snapshot_date", sinceDate)
          .order("snapshot_date", { ascending: true })
          .limit(90)
      : Promise.resolve({ data: null }),
  ]);

  const snapshots = (snapshotResult.data ?? []) as {
    snapshot_date: string;
    total_value: number;
  }[];

  // Sector concentration: warn when any sector > 25% of priced holdings
  const tickers = holdingsView.holdings.map((h) => h.ticker);
  let concentratedSectors: { sector: string; pct: number }[] = [];
  if (tickers.length > 0 && supabase && holdingsView.total_market_value) {
    const { data: metaRows } = await supabase
      .from("ticker_meta")
      .select("ticker, sector")
      .eq("user_id", session.userId)
      .in("ticker", tickers);

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

      {/* Equity curve */}
      <section className="rounded-md border border-border bg-card/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Equity curve — last 90 days
          </p>
          {snapshots.length >= 2 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatMoney(snapshots[0]!.total_value)} → {formatMoney(snapshots[snapshots.length - 1]!.total_value)}
            </span>
          )}
        </div>
        <EquityCurve
          snapshots={snapshots}
          initialAccountSize={session.profile.account_size_initial ?? DEFAULT_PROFILE.account_size_initial}
        />
      </section>

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
