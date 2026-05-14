import { redirect } from "next/navigation";
import { getUserAndProfile } from "@/lib/profile";
import { getHoldingsView, getRecentTransactions } from "@/lib/portfolio";
import { HoldingsTable } from "./_components/holdings-table";
import { AddTransactionForm } from "./_components/add-transaction-form";
import { TransactionsList } from "./_components/transactions-list";

export const metadata = { title: "Portfolio · TradePilot" };

// Holdings query hits Alpaca for live quotes — skip Next.js's static cache so
// every reload reads through to the 60s Upstash layer.
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const session = await getUserAndProfile();
  if (!session) redirect("/login?next=/portfolio");

  const [holdingsView, transactions] = await Promise.all([
    getHoldingsView(),
    getRecentTransactions(50),
  ]);

  const description = holdingsView.quotes_attempted
    ? "Live prices refresh every 60 seconds. Open P/L is market value minus cost basis."
    : "Set ALPACA_API_KEY_ID + ALPACA_API_SECRET_KEY to unlock live prices and open P/L.";

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

      <HoldingsTable view={holdingsView} />

      <AddTransactionForm />

      <TransactionsList transactions={transactions} />
    </div>
  );
}
