import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BacktestMetrics } from "@/lib/backtest/metrics";
import {
  STATUS_LABEL,
  type StrategyStatus,
  type GateResult,
} from "@/lib/backtest/lifecycle";
import { CreateStrategyForm } from "./_components/create-strategy-form";
import { backtestAndPromote, advanceStage, rejectStrategy } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Strategies · TradePilot" };

type BacktestSnapshot = {
  from: string;
  to: string;
  error?: string;
  windows?: number;
  overfittingGap?: number;
  metrics?: BacktestMetrics;
  gate?: GateResult;
};

type StrategyRow = {
  id: string;
  name: string;
  ticker: string;
  params: { fast?: number; slow?: number } | null;
  status: StrategyStatus;
  stage_metrics: { backtest?: BacktestSnapshot } | null;
  notes: string | null;
  created_at: string;
};

const STATUS_STYLE: Record<StrategyStatus, string> = {
  draft: "bg-foreground/10 text-muted-foreground",
  backtested: "bg-blue-500/15 text-blue-400",
  paper: "bg-yellow-500/15 text-yellow-400",
  live_small: "bg-amber-500/15 text-amber-400",
  approved: "bg-green-500/15 text-green-400",
  rejected: "bg-red-500/15 text-red-400",
};

export default async function StrategiesPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("strategies")
    .select("id, name, ticker, params, status, stage_metrics, notes, created_at")
    .order("created_at", { ascending: false });
  const strategies = (data ?? []) as StrategyRow[];

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Strategies</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each strategy climbs a ladder of evidence — draft, backtested, paper
          trading, live (small size), approved. A stage is reached only when
          its gate passes; promotion is enforced in the server action and by a
          database trigger.
        </p>
      </div>

      <CreateStrategyForm />

      {strategies.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No strategies yet. Create a draft above.
        </p>
      ) : (
        <section className="space-y-3">
          {strategies.map((s) => {
            const snap = s.stage_metrics?.backtest;
            return (
              <div
                key={s.id}
                className="rounded-lg border border-border bg-card/50 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{s.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {s.ticker}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      SMA {s.params?.fast ?? "?"}/{s.params?.slow ?? "?"}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLE[s.status]}`}
                  >
                    {STATUS_LABEL[s.status]}
                  </span>
                </div>

                {/* Backtest evidence */}
                {snap && (
                  <div className="rounded-md border border-border/50 bg-background/30 px-3 py-2 space-y-1.5">
                    {snap.error ? (
                      <p className="text-[11px] text-destructive">
                        {snap.error}
                      </p>
                    ) : (
                      <>
                        <p className="text-[11px] text-muted-foreground">
                          Walk-forward {snap.from} → {snap.to} ·{" "}
                          {snap.windows} windows · OOS return{" "}
                          {(snap.metrics?.totalReturnPct ?? 0).toFixed(2)}% ·
                          Sharpe {(snap.metrics?.sharpe ?? 0).toFixed(2)}
                        </p>
                        {snap.gate?.checks.map((c) => (
                          <p
                            key={c.label}
                            className={`text-[11px] ${c.ok ? "text-green-400" : "text-red-400"}`}
                          >
                            {c.ok ? "✓" : "✗"} {c.label} — {c.detail}
                          </p>
                        ))}
                      </>
                    )}
                  </div>
                )}

                {s.notes && (
                  <p className="text-[11px] text-muted-foreground">{s.notes}</p>
                )}

                {/* Stage actions */}
                <div className="flex flex-wrap items-center gap-2">
                  {s.status === "draft" && (
                    <form action={backtestAndPromote.bind(null, s.id)}>
                      <button
                        type="submit"
                        className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition hover:bg-foreground/90"
                      >
                        Backtest &amp; promote
                      </button>
                    </form>
                  )}
                  {s.status === "backtested" && (
                    <form action={advanceStage.bind(null, s.id)}>
                      <button
                        type="submit"
                        className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition hover:bg-foreground/90"
                      >
                        Move to paper trading
                      </button>
                    </form>
                  )}
                  {s.status === "paper" && (
                    <span className="text-[11px] text-muted-foreground">
                      Forward paper-trading validation is wired up in phase B7.
                    </span>
                  )}
                  {s.status === "live_small" && (
                    <span className="text-[11px] text-muted-foreground">
                      Long-term live validation is wired up in phase B9.
                    </span>
                  )}
                  {s.status !== "approved" && s.status !== "rejected" && (
                    <form action={rejectStrategy.bind(null, s.id)}>
                      <button
                        type="submit"
                        className="text-xs text-muted-foreground transition hover:text-destructive"
                      >
                        Reject
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
