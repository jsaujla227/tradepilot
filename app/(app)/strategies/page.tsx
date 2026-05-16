import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BacktestMetrics } from "@/lib/backtest/metrics";
import { getHistoricalBars } from "@/lib/backtest/data";
import { paperRun, type PaperRun } from "@/lib/backtest/paper";
import {
  STATUS_LABEL,
  evaluatePaperGate,
  type StrategyStatus,
  type GateResult,
} from "@/lib/backtest/lifecycle";
import { CreateStrategyForm } from "./_components/create-strategy-form";
import {
  backtestAndPromote,
  advanceStage,
  promoteToLive,
  rejectStrategy,
} from "./actions";

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

type LiveSnapshot = {
  evaluatedAt?: string;
  gate?: GateResult;
  startedAt?: string;
  capitalCap?: number;
};

type StrategyRow = {
  id: string;
  name: string;
  ticker: string;
  params: { fast?: number; slow?: number } | null;
  status: StrategyStatus;
  stage_metrics: {
    backtest?: BacktestSnapshot;
    paper?: { startedAt?: string };
    live?: LiveSnapshot;
  } | null;
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

function comparisonRows(
  bt: BacktestMetrics | undefined,
  paper: BacktestMetrics,
): { label: string; backtest: string; paper: string }[] {
  const pct = (v: number) => `${v.toFixed(2)}%`;
  return [
    {
      label: "Total return",
      backtest: bt ? pct(bt.totalReturnPct) : "—",
      paper: pct(paper.totalReturnPct),
    },
    {
      label: "Sharpe",
      backtest: bt ? bt.sharpe.toFixed(2) : "—",
      paper: paper.sharpe.toFixed(2),
    },
    {
      label: "Win rate",
      backtest: bt ? `${bt.winRatePct.toFixed(0)}%` : "—",
      paper: `${paper.winRatePct.toFixed(0)}%`,
    },
    {
      label: "Max drawdown",
      backtest: bt ? pct(bt.maxDrawdownPct) : "—",
      paper: pct(paper.maxDrawdownPct),
    },
    {
      label: "Trades",
      backtest: bt ? String(bt.tradeCount) : "—",
      paper: String(paper.tradeCount),
    },
  ];
}

function GateChecks({ gate }: { gate: GateResult }) {
  return (
    <>
      {gate.checks.map((c) => (
        <p
          key={c.label}
          className={`text-[11px] ${c.ok ? "text-green-400" : "text-red-400"}`}
        >
          {c.ok ? "✓" : "✗"} {c.label} — {c.detail}
        </p>
      ))}
    </>
  );
}

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

  // Live-compute the forward paper run for every strategy in the paper stage.
  const today = new Date().toISOString().slice(0, 10);
  const paperRuns = new Map<string, PaperRun>();
  for (const s of strategies) {
    if (s.status !== "paper") continue;
    const startedAt = s.stage_metrics?.paper?.startedAt;
    if (!startedAt) continue;
    const bars = await getHistoricalBars(supabase, s.ticker, startedAt, today);
    if (bars.length > 0) {
      paperRuns.set(
        s.id,
        paperRun(bars, s.params?.fast ?? 50, s.params?.slow ?? 200),
      );
    }
  }

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
            const paperStartedAt = s.stage_metrics?.paper?.startedAt;
            const live = s.stage_metrics?.live;
            const run = paperRuns.get(s.id);
            const paperGate = run
              ? evaluatePaperGate(run.metrics, run.barCount)
              : null;
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
                          Walk-forward {snap.from} → {snap.to} · {snap.windows}{" "}
                          windows · OOS return{" "}
                          {(snap.metrics?.totalReturnPct ?? 0).toFixed(2)}% ·
                          Sharpe {(snap.metrics?.sharpe ?? 0).toFixed(2)}
                        </p>
                        {snap.gate && <GateChecks gate={snap.gate} />}
                      </>
                    )}
                  </div>
                )}

                {/* Paper run: backtest-expected vs paper-actual + paper gate */}
                {s.status === "paper" && (
                  <div className="rounded-md border border-border/50 bg-background/30 px-3 py-2 space-y-1.5">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Backtest-expected vs paper-actual
                      {paperStartedAt ? ` · paper since ${paperStartedAt}` : ""}
                    </p>
                    {!run ? (
                      <p className="text-[11px] text-muted-foreground">
                        No paper trading days recorded yet — the forward run
                        accumulates as historical bars arrive.
                      </p>
                    ) : (
                      <>
                        <table className="w-full text-[11px] tabular-nums">
                          <thead>
                            <tr className="text-muted-foreground">
                              <th className="text-left font-normal">Metric</th>
                              <th className="text-right font-normal">
                                Backtest
                              </th>
                              <th className="text-right font-normal">
                                Paper ({run.barCount}d)
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {comparisonRows(snap?.metrics, run.metrics).map(
                              (r) => (
                                <tr key={r.label}>
                                  <td className="text-muted-foreground">
                                    {r.label}
                                  </td>
                                  <td className="text-right">{r.backtest}</td>
                                  <td className="text-right">{r.paper}</td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                        {paperGate && (
                          <div className="border-t border-border/40 pt-1.5">
                            <p className="text-[11px] text-muted-foreground mb-0.5">
                              Live (small) gate
                            </p>
                            <GateChecks gate={paperGate} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Live (small) evidence */}
                {s.status === "live_small" && live && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 space-y-1">
                    <p className="text-[11px] text-amber-300">
                      Live (small size)
                      {live.startedAt ? ` since ${live.startedAt}` : ""} · hard
                      capital cap{" "}
                      <span className="font-mono">
                        ${live.capitalCap ?? 0}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Orders route through the broker adapter at this capped
                      size only — the cap cannot be raised per strategy.
                    </p>
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
                    <form action={promoteToLive.bind(null, s.id)}>
                      <button
                        type="submit"
                        className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition hover:bg-foreground/90"
                      >
                        Promote to live (small)
                      </button>
                    </form>
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
