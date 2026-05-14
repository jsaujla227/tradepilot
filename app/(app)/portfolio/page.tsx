import { redirect } from "next/navigation";
import { getUserAndProfile } from "@/lib/profile";
import { getHoldings, getRecentTransactions } from "@/lib/portfolio";
import { HoldingsTable } from "./_components/holdings-table";
import { AddTransactionForm } from "./_components/add-transaction-form";
import { TransactionsList } from "./_components/transactions-list";

export const metadata = { title: "Portfolio · TradePilot" };

export default async function PortfolioPage() {
  const session = await getUserAndProfile();
  if (!session) redirect("/login?next=/portfolio");

  const [holdings, transactions] = await Promise.all([
    getHoldings(),
    getRecentTransactions(50),
  ]);

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
              Holdings are computed from your transactions using average cost
              on the net position. Live prices and market value land in M5.
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

      <HoldingsTable holdings={holdings} />

      <AddTransactionForm />

      <TransactionsList transactions={transactions} />
    </div>
  );
}
