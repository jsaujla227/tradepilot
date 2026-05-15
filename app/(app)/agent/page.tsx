import { redirect } from "next/navigation";
import { getUserAndProfile } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent · TradePilot" };

type AgentTrade = {
  id: string;
  ticker: string;
  action: "enter" | "exit" | "hold" | "skip";
  confidence: "low" | "medium" | "high";
  reasoning: string;
  pattern_matches: string[];
  risk_gates: string[];
  context_snapshot: Record<string, unknown>;
  cost_usd: number;
  decided_at: string;
  order_id: string | null;
};

export default async function AgentPage() {
  const session = await getUserAndProfile();
  if (!session) redirect("/login?next=/agent");

  const { profile } = session;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data: trades } = await supabase
    .from("agent_trades")
    .select(
      "id, ticker, action, confidence, reasoning, pattern_matches, risk_gates, context_snapshot, cost_usd, decided_at, order_id",
    )
    .eq("user_id", session.userId)
    .order("decided_at", { ascending: false })
    .limit(100);

  const today = new Date().toISOString().slice(0, 10);
  const todayTrades = (trades ?? []).filter((t: AgentTrade) =>
    t.decided_at.startsWith(today),
  );
  const ordersToday = todayTrades.filter(
    (t: AgentTrade) => t.order_id != null,
  ).length;
  const capitalToday = todayTrades.reduce((sum: number, t: AgentTrade) => {
    if (t.action !== "enter" || !t.order_id) return sum;
    const snap = t.context_snapshot;
    return sum + Number(snap.price ?? 0) * Number(snap.qty ?? 0);
  }, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Agent log</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every decision the autonomous agent made, including skips.
          </p>
        </div>
        <div
          className={`rounded-full px-3 py-1 text-xs font-mono font-semibold ${
            profile.agent_enabled
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {profile.agent_enabled ? "Active" : "Disabled"}
        </div>
      </div>

      {/* Today's stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Decisions today" value={String(todayTrades.length)} />
        <StatCard label="Orders placed today" value={String(ordersToday)} />
        <StatCard
          label="Capital deployed today"
          value={formatMoney(capitalToday)}
          sub={`Limit: ${formatMoney(profile.agent_daily_capital_limit)}`}
        />
      </div>

      {!profile.agent_enabled && (
        <div className="rounded-lg border border-border bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">
          The agent is disabled. Enable it in{" "}
          <a
            href="/settings"
            className="text-foreground underline underline-offset-2"
          >
            Settings
          </a>{" "}
          to start autonomous paper trading.
        </div>
      )}

      {/* Trade log */}
      <section className="space-y-3">
        {(trades ?? []).length === 0 ? (
          <div className="rounded-lg border border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            No agent decisions yet. Once enabled, the agent will evaluate top
            momentum tickers every 15 minutes during market hours.
          </div>
        ) : (
          (trades as AgentTrade[]).map((trade) => (
            <TradeCard key={trade.id} trade={trade} />
          ))
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Educational and decision-support only. Not financial advice. Markets
        involve risk.
      </p>
    </div>
  );
}

function TradeCard({ trade }: { trade: AgentTrade }) {
  const actionColors = {
    enter: "bg-emerald-500/20 text-emerald-400",
    exit: "bg-amber-500/20 text-amber-400",
    hold: "bg-blue-500/20 text-blue-400",
    skip: "bg-muted text-muted-foreground",
  };
  const confidenceColors = {
    high: "text-emerald-400",
    medium: "text-amber-400",
    low: "text-muted-foreground",
  };

  const snap = trade.context_snapshot;
  const price = snap.price as number | undefined;
  const qty = snap.qty as number | undefined;

  return (
    <details className="rounded-lg border border-border bg-card/40 text-sm">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 list-none">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono font-semibold text-xs">{trade.ticker}</span>
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide ${actionColors[trade.action]}`}
          >
            {trade.action}
          </span>
          <span
            className={`text-[10px] font-mono ${confidenceColors[trade.confidence]}`}
          >
            {trade.confidence}
          </span>
          <span className="truncate text-muted-foreground text-xs">
            {trade.reasoning}
          </span>
        </div>
        <div className="shrink-0 text-right text-[10px] text-muted-foreground space-y-0.5">
          <div>{new Date(trade.decided_at).toLocaleTimeString()}</div>
          {trade.cost_usd > 0 && (
            <div>${(Number(trade.cost_usd) * 1000).toFixed(3)}m</div>
          )}
        </div>
      </summary>

      <div className="border-t border-border/60 px-4 py-3 space-y-3 text-xs text-muted-foreground">
        {price != null && qty != null && (
          <p>
            <span className="text-foreground/70">Position:</span>{" "}
            {qty} shares @ {formatMoney(price)} ={" "}
            {formatMoney(price * qty)}
          </p>
        )}

        {trade.pattern_matches.length > 0 && (
          <div>
            <p className="text-foreground/70 mb-1">Pattern matches:</p>
            <ul className="space-y-0.5 pl-3">
              {trade.pattern_matches.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="text-foreground/70 mb-1">Risk gates:</p>
          <ul className="space-y-0.5 pl-3">
            {trade.risk_gates.map((g, i) => (
              <li
                key={i}
                className={
                  g.includes("FAIL") ? "text-red-400" : "text-emerald-400/80"
                }
              >
                {g}
              </li>
            ))}
          </ul>
        </div>

        <details className="mt-1">
          <summary className="cursor-pointer text-foreground/50">
            Full context snapshot
          </summary>
          <pre className="mt-2 rounded bg-background/60 p-2 text-[10px] leading-relaxed overflow-x-auto">
            {JSON.stringify(trade.context_snapshot, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
