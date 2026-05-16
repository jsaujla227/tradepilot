import type { BacktestMetrics } from "./metrics";

// The strategy validation lifecycle.
//
// A strategy climbs a ladder of evidence before it is trusted:
//   draft -> backtested -> paper -> live_small -> approved
// and may be rejected from any non-terminal stage. Each forward step is
// gated: the transition graph is enforced (here and by a DB trigger), and
// the metric criteria for each stage are enforced in the server actions.
//
// All functions here are pure.

export type StrategyStatus =
  | "draft"
  | "backtested"
  | "paper"
  | "live_small"
  | "approved"
  | "rejected";

const FORWARD: Record<string, StrategyStatus> = {
  draft: "backtested",
  backtested: "paper",
  paper: "live_small",
  live_small: "approved",
};

const TERMINAL: StrategyStatus[] = ["approved", "rejected"];

export const STATUS_LABEL: Record<StrategyStatus, string> = {
  draft: "Draft",
  backtested: "Backtested",
  paper: "Paper trading",
  live_small: "Live (small size)",
  approved: "Approved",
  rejected: "Rejected",
};

/** The single forward stage after `from`, or null if terminal. */
export function nextStatus(from: StrategyStatus): StrategyStatus | null {
  return FORWARD[from] ?? null;
}

/**
 * Whether `from -> to` is a legal transition: one forward step, or a
 * rejection from any non-terminal stage.
 */
export function isLegalTransition(
  from: StrategyStatus,
  to: StrategyStatus,
): boolean {
  if (from === to) return false;
  if (TERMINAL.includes(from)) return false;
  if (to === "rejected") return true;
  return FORWARD[from] === to;
}

// -- Gate criteria ---------------------------------------------------------

export type GateCheck = { label: string; ok: boolean; detail: string };
export type GateResult = { passed: boolean; checks: GateCheck[] };

/** Thresholds for promoting draft -> backtested. */
export const BACKTEST_GATE = {
  minExpectancyPct: 0,
  maxDrawdownPct: 25,
  minTrades: 10,
  maxOverfittingGap: 1,
} as const;

/**
 * Evaluates the draft -> backtested gate against a strategy's aggregate
 * out-of-sample walk-forward metrics and its overfitting gap.
 */
export function evaluateBacktestGate(
  m: BacktestMetrics,
  overfittingGap: number,
): GateResult {
  const checks: GateCheck[] = [
    {
      label: "Positive out-of-sample expectancy",
      ok: m.expectancyPct > BACKTEST_GATE.minExpectancyPct,
      detail: `expectancy ${m.expectancyPct.toFixed(2)}% (need > ${BACKTEST_GATE.minExpectancyPct}%)`,
    },
    {
      label: "Max drawdown within limit",
      ok: m.maxDrawdownPct < BACKTEST_GATE.maxDrawdownPct,
      detail: `drawdown ${m.maxDrawdownPct.toFixed(2)}% (need < ${BACKTEST_GATE.maxDrawdownPct}%)`,
    },
    {
      label: "Enough trades to be meaningful",
      ok: m.tradeCount >= BACKTEST_GATE.minTrades,
      detail: `${m.tradeCount} trades (need at least ${BACKTEST_GATE.minTrades})`,
    },
    {
      label: "Not overfit to the in-sample window",
      ok: overfittingGap < BACKTEST_GATE.maxOverfittingGap,
      detail: `overfitting gap ${overfittingGap.toFixed(2)} (need < ${BACKTEST_GATE.maxOverfittingGap})`,
    },
  ];
  return { passed: checks.every((c) => c.ok), checks };
}
