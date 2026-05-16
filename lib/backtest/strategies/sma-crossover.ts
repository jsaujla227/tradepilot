import type { HistoricalBar } from "../data";
import type { Strategy, StrategyContext, Signal } from "../strategy";

// Reference strategy: simple-moving-average crossover. Long-only.
// Go long when the fast SMA is above the slow SMA; exit when it crosses back
// below. Deliberately simple and well-understood — it is the reference
// implementation that exercises the Strategy contract and, later, the engine.

/** Mean close over the last `period` bars, or null if there aren't enough. */
function sma(bars: readonly HistoricalBar[], period: number): number | null {
  if (period <= 0 || bars.length < period) return null;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    sum += bars[i]!.close;
  }
  return sum / period;
}

/**
 * Builds an SMA-crossover strategy. `fast` must be shorter than `slow`.
 * Until there are `slow` bars of history the strategy holds (no opinion).
 */
export function smaCrossover(fast = 50, slow = 200): Strategy {
  return {
    name: `SMA ${fast}/${slow} crossover`,
    params: { fast, slow },
    decide(ctx: StrategyContext): Signal {
      const fastSma = sma(ctx.history, fast);
      const slowSma = sma(ctx.history, slow);
      if (fastSma == null || slowSma == null) return "hold";

      const bullish = fastSma > slowSma;
      if (!ctx.inPosition && bullish) return "enter";
      if (ctx.inPosition && !bullish) return "exit";
      return "hold";
    },
  };
}
