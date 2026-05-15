import { redirect } from "next/navigation";
import { getUserAndProfile, DEFAULT_PROFILE } from "@/lib/profile";
import { getHoldingsView } from "@/lib/portfolio";
import { PreTradeChecklist } from "@/components/risk/pre-trade-checklist";
import { ExplainButton } from "@/components/ai/explain-button";
import { formatMoney, formatPct } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AlertDismissButton } from "./_components/alert-dismiss-button";
import { Sparkline } from "@/components/charts/sparkline";

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
  const holdings = await getHoldingsView();
  const totalMv = holdings.total_market_value;
  const totalPnl = holdings.total_open_pnl;
  const pnlPct =
    holdings.total_cost_basis > 0 && totalPnl != null
      ? (totalPnl / holdings.total_cost_basis) * 100
      : null;

  // Last 30 days of equity snapshots for the dashboard sparkline
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sparkSince = thirtyDaysAgo.toISOString().slice(0, 10);
  const { data: sparkRows } = supabase
    ? await supabase
        .from("portfolio_snapshots")
        .select("snapshot_date, total_value")
        .eq("user_id", session.userId)
        .gte("snapshot_date", sparkSince)
        .order("snapshot_date", { ascending: true })
        .limit(30)
    : { data: [] };
  const sparkData = (sparkRows ?? []) as { snapshot_date: string; total_value: number }[];
  const sparkIsUp =
    sparkData.length >= 2
      ? sparkData[sparkData.length - 1]!.total_value >= sparkData[0]!.total_value
      : true;

  // Fetch today's undismissed position alerts
  const today = new Date().toISOString().slice(0, 10);
  const { data: alertRows } = supabase
    ? await supabase
        .from("position_alerts")
        .select("id, ticker, alert_type, severity, message, why, suggested_review")
        .eq("user_id", session.userId)
        .is("dismissed_at", null)
        .gte("generated_at", `${today}T00:00:00Z`)
        .order("severity") // critical < info < warning alphabetically — we sort below
    : { data: [] };

  const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;
  type AlertRow = {
    id: string;
    ticker: string;
    alert_type: string;
    severity: "critical" | "warning" | "info";
    message: string;
    why: string;
    suggested_review: string;
  };
  const alerts = ((alertRows ?? []) as AlertRow[]).sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
  );

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

      {/* Position alerts */}
      {alerts.length > 0 && (
        <section className="space-y-2">
          {alerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </section>
      )}

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

      {/* Equity sparkline */}
      {sparkData.length >= 2 && (
        <section className="rounded-lg border border-border bg-card/50 px-4 pt-3 pb-1">
          <p className="text-xs text-muted-foreground mb-1">30-day equity</p>
          <Sparkline data={sparkData} isUp={sparkIsUp} />
        </section>
      )}

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
    </div>
  );
}

function AlertCard({
  alert,
}: {
  alert: {
    id: string;
    ticker: string;
    severity: "critical" | "warning" | "info";
    message: string;
    why: string;
    suggested_review: string;
  };
}) {
  const colors = {
    critical:
      "border-red-500/40 bg-red-950/30 text-red-300",
    warning:
      "border-amber-500/40 bg-amber-950/30 text-amber-300",
    info: "border-blue-500/40 bg-blue-950/30 text-blue-300",
  };
  const badges = { critical: "Critical", warning: "Review", info: "Info" };

  return (
    <details className={`rounded-lg border px-4 py-3 text-sm ${colors[alert.severity]}`}>
      <summary className="flex cursor-pointer items-center justify-between gap-3 list-none">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-xs uppercase tracking-wide">
            {alert.ticker}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider opacity-70">
            {badges[alert.severity]}
          </span>
          <span className="text-sm">{alert.message}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] opacity-60">Why?</span>
          <AlertDismissButton alertId={alert.id} />
        </div>
      </summary>
      <div className="mt-3 space-y-2 border-t border-current/20 pt-3 text-xs opacity-80">
        <p>
          <span className="font-semibold">Math:</span> {alert.why}
        </p>
        <p>
          <span className="font-semibold">Review:</span>{" "}
          {alert.suggested_review}
        </p>
      </div>
    </details>
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
