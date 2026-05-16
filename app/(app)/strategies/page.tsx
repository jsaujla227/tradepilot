import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BacktestMetrics } from "@/lib/backtest/metrics";
import { getHistoricalBars } from "@/lib/backtest/data";
import { paperRun, type PaperRun } from "@/lib/backtest/paper";
import {
  STATUS_LABEL,
  evaluatePaperGate,
  evaluateLiveGate,
  detectDecay,
  type StrategyStatus,
  type GateResult,
} from "@/lib/backtest/lifecycle";
import { CreateStrategyForm } from "./_components/create-strategy-form";
import {
  backtestAndPromote,
  advanceStage,
  promoteToLive,
  approveStrategy,
  rejectStrategy,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Strategies · TradePilot" };

type BacktestSnapshot = {
  from: string;
  to: string;
  evaluatedAt?: string;
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
  stage_metrics: {
    backtest?: BacktestSnapshot;
    paper?: { startedAt?: string };
    live?: { startedAt?: string; capitalCap?: number };
    approval?: { approvedAt?: string };
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

function metricRows(
  a: BacktestMetrics | undefined,
  b: BacktestMetrics,
): { label: string; a: string; b: string }[] {
  const pct = (v: number) => `${v.toFixed(2)}%`;
  return [
    { label: "Total return", a: a ? pct(a.totalReturnPct) : "—", b: pct(b.totalReturnPct) },
    { label: "Sharpe", a: a ? a.sharpe.toFixed(2) : "—", b: b.sharpe.toFixed(2) },
    {
      label: "Win rate",
      a: a ? `${a.winRatePct.toFixed(0)}%` : "—",
      b: `${b.winRatePct.toFixed(0)}%`,
    },
    {
      label: "Max drawdown",
      a: a ? pct(a.maxDrawdownPct) : "—",
      b: pct(b.maxDrawdownPct),
    },
    { label: "Trades", a: a ? String(a.tradeCount) : "—", b: String(b.tradeCount) },
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

function ComparisonTable({
  rightLabel,
  rows,
}: {
  rightLabel: string;
  rows: { label: string; a: string; b: string }[];
}) {
  return (
    <table className="w-full text-[11px] tabular-nums">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left font-normal">Metric</th>
          <th className="text-right font-normal">Backtest</th>
          <th className="text-right font-normal">{rightLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="text-muted-foreground">{r.label}</td>
            <td className="text-right">{r.a}</td>
            <td className="text-right">{r.b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Journey({ s }: { s: StrategyRow }) {
  const sm = s.stage_metrics;
  const steps = [
    { label: "Created", date: s.created_at.slice(0, 10) },
    sm?.backtest?.evaluatedAt
      ? { label: "Backtested", date: sm.backtest.evaluatedAt }
      : null,
    sm?.paper?.startedAt
      ? { label: "Paper trading", date: sm.paper.startedAt }
      : null,
    sm?.live?.startedAt
      ? { label: "Live (small size)", date: sm.live.startedAt }
      : null,
    sm?.approval?.approvedAt
      ? { label: "Approved", date: sm.approval.approvedAt }
      : null,
  ].filter((x): x is { label: string; date: string } => x !== null);

  return (
    <div className="rounded-md border border-border/50 bg-background/30 px-3 py-2">
      <p className="text-[11px] font-medium text-muted-foreground mb-1">
        Journey
      </p>
      <ol className="space-y-0.5">
        {steps.map((step) => (
          <li
            key={step.label}
            className="flex justify-between text-[11px] text-muted-foreground tabular-nums"
          >
            <span>{step.label}</span>
            <span>{step.date}</span>
          </li>
        ))}
      </ol>
    </div>
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

  // Live-compute the forward run for paper and live_small strategies.
  const today = new Date().toISOString().slice(0, 10);
  const forwardRuns = new Map<string, PaperRun>();
  for (const s of strategies) {
    const start =
      s.status === "paper"
        ? s.stage_metrics?.paper?.startedAt
        : s.status === "live_small"
          ? s.stage_metrics?.live?.startedAt
          : undefined;
    if (!start) continue;
    const bars = await getHistoricalBars(supabase, s.ticker, start, today);
    if (bars.length > 0) {
      forwardRuns.set(
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
            const live = s.stage_metrics?.live;
            const run = forwardRuns.get(s.id);
            const advanced =
              s.status === "live_small" || s.status === "approved";

            // Gate previews computed from the live forward run.
            const paperGate =
              s.status === "paper" && run
                ? evaluatePaperGate(run.metrics, run.barCount)
                : null;
            const decay =
              s.status === "live_small" && run && snap?.metrics
                ? detectDecay(run.metrics, snap.metrics)
                : null;
            const liveGate =
              s.status === "live_small" && run
                ? evaluateLiveGate(
                    run.metrics,
                    run.barCount,
                    decay?.decayed ?? false,
                  )
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

                {/* Paper run */}
                {s.status === "paper" && (
                  <div className="rounded-md border border-border/50 bg-background/30 px-3 py-2 space-y-1.5">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Backtest-expected vs paper-actual
                    </p>
                    {!run ? (
                      <p className="text-[11px] text-muted-foreground">
                        No paper trading days recorded yet — the forward run
                        accumulates as historical bars arrive.
                      </p>
                    ) : (
                      <>
                        <ComparisonTable
                          rightLabel={`Paper (${run.barCount}d)`}
                          rows={metricRows(snap?.metrics, run.metrics)}
                        />
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

                {/* Live (small) run + decay + approval gate */}
                {s.status === "live_small" && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 space-y-1.5">
                    <p className="text-[11px] text-amber-300">
                      Live (small size)
                      {live?.startedAt ? ` since ${live.startedAt}` : ""} ·
                      hard capital cap{" "}
                      <span className="font-mono">${live?.capitalCap ?? 0}</span>
                    </p>
                    {!run ? (
                      <p className="text-[11px] text-muted-foreground">
                        No live trading days recorded yet.
                      </p>
                    ) : (
                      <>
                        <ComparisonTable
                          rightLabel={`Live (${run.barCount}d)`}
                          rows={metricRows(snap?.metrics, run.metrics)}
                        />
                        {decay?.decayed &&
                          decay.reasons.map((r) => (
                            <p key={r} className="text-[11px] text-red-400">
                              ✗ Strategy decay — {r}
                            </p>
                          ))}
                        {liveGate && (
                          <div className="border-t border-border/40 pt-1.5">
                            <p className="text-[11px] text-muted-foreground mb-0.5">
                              Approval gate
                            </p>
                            <GateChecks gate={liveGate} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Approved */}
                {s.status === "approved" && (
                  <div className="rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2">
                    <p className="text-[11px] text-green-300">
                      Approved
                      {s.stage_metrics?.approval?.approvedAt
                        ? ` ${s.stage_metrics.approval.approvedAt}`
                        : ""}{" "}
                      — cleared the backtest, paper, and long-term live gates.
                    </p>
                  </div>
                )}

                {advanced && <Journey s={s} />}

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
                    <form action={approveStrategy.bind(null, s.id)}>
                      <button
                        type="submit"
                        className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition hover:bg-foreground/90"
                      >
                        Approve strategy
                      </button>
                    </form>
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
