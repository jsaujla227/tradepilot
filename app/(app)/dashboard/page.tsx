import { redirect } from "next/navigation";
import { getUserAndProfile, DEFAULT_PROFILE } from "@/lib/profile";
import { getHoldingsView } from "@/lib/portfolio";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PreTradeChecklist } from "@/components/risk/pre-trade-checklist";
import { ExplainButton } from "@/components/ai/explain-button";
import { PortfolioChart } from "@/components/portfolio/portfolio-chart";
import { formatMoney, formatPct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · TradePilot" };

export default async function DashboardPage() {
  const session = await getUserAndProfile();
  if (!session) redirect("/login");

  const { profile } = session;
  const accountSize =
    profile.account_size_initial ?? DEFAULT_PROFILE.account_size_initial;
  const maxRiskPct =
    profile.max_risk_per_trade_pct ?? DEFAULT_PROFILE.max_risk_per_trade_pct;
  const dailyLossLimitPct =
    profile.daily_loss_limit_pct ?? DEFAULT_PROFILE.daily_loss_limit_pct;

  const supabase = await createSupabaseServerClient();
  const [holdingsResult, snapshotResult] = await Promise.all([
    getHoldingsView(),
    supabase
      ? supabase
          .from("portfolio_snapshots")
          .select("snapshot_date, total_value")
          .eq("user_id", session.userId)
          .order("snapshot_date", { ascending: true })
          .limit(90)
      : Promise.resolve({ data: [] }),
  ]);

  const holdings = holdingsResult;
  const snapshots = (
    (snapshotResult as { data: Array<{ snapshot_date: string; total_value: number }> | null }).data ?? []
  ).map((s) => ({
    snapshot_date: String(s.snapshot_date),
    total_value: Number(s.total_value),
  }));
  const totalMv = holdings.total_market_value;
  const totalPnl = holdings.total_open_pnl;
  const pnlPct =
    holdings.total_cost_basis > 0 && totalPnl != null
      ? (totalPnl / holdings.total_cost_basis) * 100
      : null;

  const dailyLossLimit = (accountSize * dailyLossLimitPct) / 100;
  const lossRemaining =
    totalPnl != null
      ? Math.max(0, dailyLossLimit - (totalPnl < 0 ? Math.abs(totalPnl) : 0))
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Portfolio snapshot and trade entry.
          </p>
        </div>
        <PreTradeChecklist
          accountSize={accountSize}
          maxRiskPct={maxRiskPct}
        />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Account size"
          value={formatMoney(accountSize)}
        />
        <StatCard
          label="Portfolio value"
          value={totalMv != null ? formatMoney(totalMv) : "—"}
          sub={
            pnlPct != null
              ? `${pnlPct >= 0 ? "+" : ""}${formatPct(pnlPct)} open P&L`
              : undefined
          }
          subColor={
            pnlPct != null ? (pnlPct >= 0 ? "text-green-400" : "text-red-400") : undefined
          }
        />
        <StatCard
          label="Open P&L"
          value={totalPnl != null ? formatMoney(totalPnl) : "—"}
          valueColor={
            totalPnl != null
              ? totalPnl >= 0
                ? "text-green-400"
                : "text-red-400"
              : undefined
          }
        />
        <StatCard
          label="Daily loss room"
          value={lossRemaining != null ? formatMoney(lossRemaining) : "—"}
          sub={`Limit: ${formatMoney(dailyLossLimit)}`}
          subColor={
            lossRemaining != null && lossRemaining < dailyLossLimit * 0.25
              ? "text-red-400"
              : "text-muted-foreground"
          }
        />
      </div>

      {/* Holdings summary */}
      {holdings.holdings.length > 0 && (
        <section className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Open positions
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4">Ticker</th>
                  <th className="pb-2 pr-4 text-right">Qty</th>
                  <th className="pb-2 pr-4 text-right">Avg cost</th>
                  <th className="pb-2 pr-4 text-right">Price</th>
                  <th className="pb-2 pr-4 text-right">Open P&L</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {holdings.holdings.map((h) => (
                  <tr key={h.ticker} className="hover:bg-foreground/5 transition">
                    <td className="py-1.5 pr-4 font-mono font-medium">{h.ticker}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{h.qty}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {formatMoney(h.avg_cost)}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {h.price != null ? formatMoney(h.price) : "—"}
                    </td>
                    <td
                      className={`py-1.5 pr-4 text-right tabular-nums ${
                        h.open_pnl == null
                          ? ""
                          : h.open_pnl >= 0
                            ? "text-green-400"
                            : "text-red-400"
                      }`}
                    >
                      {h.open_pnl != null ? formatMoney(h.open_pnl) : "—"}
                    </td>
                    <td className="py-1.5 text-right">
                      <ExplainButton
                        label="Explain"
                        prompt={`Explain my ${h.ticker} position: what is my risk exposure, open P&L, and what could go wrong?`}
                        dataProvided={{
                          ticker: h.ticker,
                          qty: h.qty,
                          avgCost: h.avg_cost,
                          currentPrice: h.price,
                          openPnl: h.open_pnl,
                          marketValue: h.market_value,
                          totalPortfolioValue: holdings.total_market_value,
                          accountSize,
                          maxRiskPct,
                          dailyLossLimitPct,
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {holdings.holdings.length === 0 && (
        <div className="rounded-lg border border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          No open positions. Click <strong>New trade</strong> to enter your first paper trade.
        </div>
      )}

      {/* Portfolio performance chart */}
      <PortfolioChart snapshots={snapshots} accountSize={accountSize} />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  valueColor,
  subColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  subColor?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${valueColor ?? ""}`}>
        {value}
      </p>
      {sub && (
        <p className={`mt-0.5 text-xs ${subColor ?? "text-muted-foreground"}`}>{sub}</p>
      )}
    </div>
  );
}
