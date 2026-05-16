import type { HistoricalBar } from "./data";

// The strategy contract for the backtest engine.
//
// CAUSALITY GUARANTEE: a strategy only ever receives `history` — bars up to
// and including the current day, oldest-first. It is never handed a future
// bar, so lookahead bias is structurally impossible: the backtest engine
// (B3) controls the slice and only ever grows it one day at a time.

/** What a strategy wants to happen, acted on at the next bar's open. */
export type Signal = "enter" | "exit" | "hold";

/** The causal view a strategy sees on each step of the backtest. */
export type StrategyContext = {
  /**
   * Every bar from the start of the test up to and including today,
   * oldest-first. The last element is "today". Never includes future bars.
   */
  history: readonly HistoricalBar[];
  /** Whether a position is currently open. */
  inPosition: boolean;
};

export type Strategy = {
  /** Human-readable name, e.g. "SMA 50/200 crossover". */
  readonly name: string;
  /** Tunable numeric parameters — the search space for B5 walk-forward. */
  readonly params: Readonly<Record<string, number>>;
  /**
   * Decide the signal from the causal context. MUST be pure: the same
   * context always yields the same signal, with no I/O and no mutation.
   *
   * The engine treats `enter` while already in a position, and `exit` while
   * flat, as `hold` — so a strategy may return either without harm.
   */
  decide(ctx: StrategyContext): Signal;
};
