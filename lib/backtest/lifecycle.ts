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

/** Thresholds for promoting paper -> live_small. */
export const PAPER_GATE = {
  minPaperDays: 60,
  minTotalReturnPct: 0,
  maxDrawdownPct: 20,
  minTrades: 5,
} as const;

/**
 * Evaluates the paper -> live_small gate against a strategy's forward
 * paper-trading metrics and the length of its paper run.
 */
export function evaluatePaperGate(
  m: BacktestMetrics,
  paperDays: number,
): GateResult {
  const checks: GateCheck[] = [
    {
      label: "Long enough paper run",
      ok: paperDays >= PAPER_GATE.minPaperDays,
      detail: `${paperDays} trading days (need at least ${PAPER_GATE.minPaperDays})`,
    },
    {
      label: "Positive forward paper return",
      ok: m.totalReturnPct > PAPER_GATE.minTotalReturnPct,
      detail: `return ${m.totalReturnPct.toFixed(2)}% (need > ${PAPER_GATE.minTotalReturnPct}%)`,
    },
    {
      label: "Paper drawdown within limit",
      ok: m.maxDrawdownPct < PAPER_GATE.maxDrawdownPct,
      detail: `drawdown ${m.maxDrawdownPct.toFixed(2)}% (need < ${PAPER_GATE.maxDrawdownPct}%)`,
    },
    {
      label: "Enough paper trades",
      ok: m.tradeCount >= PAPER_GATE.minTrades,
      detail: `${m.tradeCount} trades (need at least ${PAPER_GATE.minTrades})`,
    },
  ];
  return { passed: checks.every((c) => c.ok), checks };
}

// -- Strategy decay --------------------------------------------------------

export type DecayResult = { decayed: boolean; reasons: string[] };

export const DECAY = {
  /** Live Sharpe below this fraction of the backtested Sharpe flags decay. */
  minSharpeRatio: 0.5,
  /** Live drawdown exceeding the backtested figure by this many points flags decay. */
  maxDrawdownExcessPct: 10,
} as const;

/**
 * Detects strategy decay — live performance drifting materially below the
 * profile the strategy was validated against (its backtest baseline).
 */
export function detectDecay(
  live: BacktestMetrics,
  baseline: BacktestMetrics,
): DecayResult {
  const reasons: string[] = [];
  if (
    baseline.sharpe > 0 &&
    live.sharpe < baseline.sharpe * DECAY.minSharpeRatio
  ) {
    reasons.push(
      `live Sharpe ${live.sharpe.toFixed(2)} is well below the backtested ${baseline.sharpe.toFixed(2)}`,
    );
  }
  if (
    live.maxDrawdownPct >
    baseline.maxDrawdownPct + DECAY.maxDrawdownExcessPct
  ) {
    reasons.push(
      `live drawdown ${live.maxDrawdownPct.toFixed(1)}% exceeds the backtested ${baseline.maxDrawdownPct.toFixed(1)}% by over ${DECAY.maxDrawdownExcessPct} points`,
    );
  }
  return { decayed: reasons.length > 0, reasons };
}

// -- Live -> approved gate -------------------------------------------------

/** Thresholds for promoting live_small -> approved. */
export const LIVE_GATE = {
  minLiveDays: 120,
  minTotalReturnPct: 0,
  maxDrawdownPct: 20,
} as const;

/**
 * Evaluates the live_small -> approved gate against a strategy's long-term
 * live metrics, the length of its live run, and whether decay was detected.
 */
export function evaluateLiveGate(
  m: BacktestMetrics,
  liveDays: number,
  decayed: boolean,
): GateResult {
  const checks: GateCheck[] = [
    {
      label: "Long-term live track record",
      ok: liveDays >= LIVE_GATE.minLiveDays,
      detail: `${liveDays} live trading days (need at least ${LIVE_GATE.minLiveDays})`,
    },
    {
      label: "Positive live return",
      ok: m.totalReturnPct > LIVE_GATE.minTotalReturnPct,
      detail: `return ${m.totalReturnPct.toFixed(2)}% (need > ${LIVE_GATE.minTotalReturnPct}%)`,
    },
    {
      label: "Live drawdown within limit",
      ok: m.maxDrawdownPct < LIVE_GATE.maxDrawdownPct,
      detail: `drawdown ${m.maxDrawdownPct.toFixed(2)}% (need < ${LIVE_GATE.maxDrawdownPct}%)`,
    },
    {
      label: "No strategy decay detected",
      ok: !decayed,
      detail: decayed
        ? "live performance has drifted from the validated profile"
        : "live performance tracks the validated profile",
    },
  ];
  return { passed: checks.every((c) => c.ok), checks };
}
