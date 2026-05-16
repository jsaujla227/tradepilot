import type { StrategyStatus } from "./lifecycle";

// Small real-money routing controls.
//
// A strategy that clears the paper gate reaches the `live_small` stage, where
// it may route orders to the live broker — but only at a hard-capped, small
// size. `cappedLiveCapital` is the single chokepoint: every live order sizing
// passes through it, and it clamps to LIVE_CAPITAL_CAP_MAX, so no per-strategy
// setting can lift the ceiling. All functions here are pure.

/** Hard ceiling on per-strategy live capital. Small-size only — cannot be exceeded. */
export const LIVE_CAPITAL_CAP_MAX = 500;

/**
 * Clamps a requested per-strategy live capital to the hard small-size ceiling.
 * A non-positive or non-finite request yields 0 (no routing).
 */
export function cappedLiveCapital(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.min(requested, LIVE_CAPITAL_CAP_MAX);
}

/** Whole shares affordable at `price` within `capital`. */
export function liveOrderShares(price: number, capital: number): number {
  if (price <= 0 || capital <= 0) return 0;
  return Math.floor(capital / price);
}

/**
 * Whether a strategy may route orders to the live broker. Only the
 * live_small and approved stages are eligible — everything earlier is
 * still under validation.
 */
export function isLiveRoutingEligible(status: StrategyStatus): boolean {
  return status === "live_small" || status === "approved";
}
