import type { HistoricalBar } from "./data";
import type { Strategy } from "./strategy";
import { smaCrossover } from "./strategies/sma-crossover";
import {
  runBacktest,
  DEFAULT_CONFIG,
  type BacktestConfig,
  type BacktestResult,
  type Trade,
  type EquityPoint,
} from "./engine";
import { computeMetrics, type BacktestMetrics } from "./metrics";

// Walk-forward analysis — the guard against overfitting.
//
// A parameter sweep alone is dangerous: pick the best params on a stretch of
// history and you have almost certainly curve-fit. Walk-forward instead
// optimises on a rolling IN-SAMPLE window, then evaluates the chosen params
// on the next, unseen OUT-OF-SAMPLE window, and rolls forward. The honest
// result is the stitched-together out-of-sample performance; the gap between
// in-sample and out-of-sample scores is the overfitting tell.
//
// All functions here are pure.

/** A parameter combination — e.g. { fast: 50, slow: 200 }. */
export type ParamSet = Record<string, number>;

/** Builds a Strategy from a ParamSet. */
export type StrategyFactory = (params: ParamSet) => Strategy;

/** A scalar to maximise; higher is better. */
export type Objective = (metrics: BacktestMetrics) => number;

export const sharpeObjective: Objective = (m) => m.sharpe;
export const totalReturnObjective: Objective = (m) => m.totalReturnPct;

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

export type SweepEntry = {
  params: ParamSet;
  metrics: BacktestMetrics;
  /** objective(metrics) — the value the sweep ranks on. */
  score: number;
};

/**
 * Runs a backtest for every param set over `bars` and returns them ranked by
 * the objective, best first.
 */
export function sweep(
  bars: readonly HistoricalBar[],
  paramSets: ParamSet[],
  buildStrategy: StrategyFactory,
  objective: Objective,
  config: BacktestConfig = DEFAULT_CONFIG,
): SweepEntry[] {
  return paramSets
    .map((params) => {
      const result = runBacktest(bars, buildStrategy(params), config);
      const metrics = computeMetrics(result, config.initialCapital);
      return { params, metrics, score: objective(metrics) };
    })
    .sort((a, b) => b.score - a.score);
}

export type WalkForwardConfig = {
  /** Bars in each in-sample optimisation window. */
  inSampleBars: number;
  /** Bars in each out-of-sample evaluation window. */
  outOfSampleBars: number;
};

export type WalkForwardWindow = {
  inSampleRange: { from: string; to: string };
  outOfSampleRange: { from: string; to: string };
  /** Params that scored best on the in-sample window. */
  chosenParams: ParamSet;
  /** Metrics of the chosen params ON the in-sample window. */
  inSampleMetrics: BacktestMetrics;
  /** Metrics of those same params ON the unseen out-of-sample window. */
  outOfSampleMetrics: BacktestMetrics;
};

export type WalkForwardReport = {
  windows: WalkForwardWindow[];
  /** Metrics over every out-of-sample window stitched together. */
  aggregateOutOfSample: BacktestMetrics;
  /**
   * Mean in-sample score minus mean out-of-sample score, under the objective.
   * A large positive gap means the optimiser was fitting noise.
   */
  overfittingGap: number;
};

/**
 * Walk-forward analysis: optimise on a rolling in-sample window, evaluate the
 * winner out-of-sample, roll forward by one out-of-sample window. Capital is
 * carried across the out-of-sample windows so the aggregate is a realistic
 * forward run.
 */
export function walkForward(
  bars: readonly HistoricalBar[],
  paramSets: ParamSet[],
  buildStrategy: StrategyFactory,
  objective: Objective,
  wfConfig: WalkForwardConfig,
  config: BacktestConfig = DEFAULT_CONFIG,
): WalkForwardReport {
  const { inSampleBars, outOfSampleBars } = wfConfig;
  const windows: WalkForwardWindow[] = [];
  const allTrades: Trade[] = [];
  const allEquity: EquityPoint[] = [];
  let capital = config.initialCapital;

  for (
    let isStart = 0;
    isStart + inSampleBars + outOfSampleBars <= bars.length;
    isStart += outOfSampleBars
  ) {
    const isBars = bars.slice(isStart, isStart + inSampleBars);
    const oosBars = bars.slice(
      isStart + inSampleBars,
      isStart + inSampleBars + outOfSampleBars,
    );

    // Optimise on the in-sample window (hypothetical — fixed capital base).
    const ranked = sweep(isBars, paramSets, buildStrategy, objective, config);
    const best = ranked[0];
    if (!best) break;

    // Evaluate the winner out-of-sample, carrying real capital forward.
    const oosResult = runBacktest(oosBars, buildStrategy(best.params), {
      ...config,
      initialCapital: capital,
    });
    const outOfSampleMetrics = computeMetrics(oosResult, capital);

    windows.push({
      inSampleRange: {
        from: isBars[0]!.date,
        to: isBars[isBars.length - 1]!.date,
      },
      outOfSampleRange: {
        from: oosBars[0]!.date,
        to: oosBars[oosBars.length - 1]!.date,
      },
      chosenParams: best.params,
      inSampleMetrics: best.metrics,
      outOfSampleMetrics,
    });
    allTrades.push(...oosResult.trades);
    allEquity.push(...oosResult.equityCurve);
    capital = oosResult.finalEquity;
  }

  const combined: BacktestResult = {
    trades: allTrades,
    equityCurve: allEquity,
    finalEquity: capital,
  };

  return {
    windows,
    aggregateOutOfSample: computeMetrics(combined, config.initialCapital),
    overfittingGap:
      mean(windows.map((w) => objective(w.inSampleMetrics))) -
      mean(windows.map((w) => objective(w.outOfSampleMetrics))),
  };
}

/** Every { fast, slow } pair with fast < slow. */
export function smaParamGrid(fasts: number[], slows: number[]): ParamSet[] {
  const sets: ParamSet[] = [];
  for (const fast of fasts) {
    for (const slow of slows) {
      if (fast < slow) sets.push({ fast, slow });
    }
  }
  return sets;
}

/** StrategyFactory for the SMA-crossover strategy. */
export const buildSmaStrategy: StrategyFactory = (p) =>
  smaCrossover(p.fast, p.slow);
