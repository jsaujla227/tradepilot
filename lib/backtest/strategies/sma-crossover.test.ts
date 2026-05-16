import { describe, it, expect } from "vitest";
import type { HistoricalBar } from "../data";
import type { Signal, StrategyContext } from "../strategy";
import { smaCrossover } from "./sma-crossover";

const mkBar = (date: string, close: number): HistoricalBar => ({
  ticker: "TEST",
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1000,
});

/** Replays a close series through the strategy the way the engine will. */
function replay(closes: number[], fast: number, slow: number): Signal[] {
  const bars = closes.map((c, i) =>
    mkBar(`2024-01-${String(i + 1).padStart(2, "0")}`, c),
  );
  const strat = smaCrossover(fast, slow);
  const signals: Signal[] = [];
  let inPosition = false;
  for (let i = 0; i < bars.length; i++) {
    const ctx: StrategyContext = { history: bars.slice(0, i + 1), inPosition };
    const sig = strat.decide(ctx);
    signals.push(sig);
    if (sig === "enter") inPosition = true;
    if (sig === "exit") inPosition = false;
  }
  return signals;
}

describe("smaCrossover", () => {
  it("exposes name and params", () => {
    const s = smaCrossover();
    expect(s.name).toBe("SMA 50/200 crossover");
    expect(s.params).toEqual({ fast: 50, slow: 200 });
  });

  it("holds until there is enough history for the slow SMA", () => {
    // fast=2, slow=3 → first two bars cannot form the slow SMA.
    const signals = replay([10, 11], 2, 3);
    expect(signals).toEqual(["hold", "hold"]);
  });

  it("enters on a bullish cross and exits on a bearish cross", () => {
    // closes: 10 11 12 13 12 11 10 (fast=2, slow=3)
    //  i=2  sma2=11.5 > sma3=11.00  bullish, flat   -> enter
    //  i=3  sma2=12.5 > sma3=12.00  bullish, held   -> hold
    //  i=4  sma2=12.5 > sma3=12.33  bullish, held   -> hold
    //  i=5  sma2=11.5 < sma3=12.00  bearish, held   -> exit
    //  i=6  sma2=10.5 < sma3=11.00  bearish, flat   -> hold
    const signals = replay([10, 11, 12, 13, 12, 11, 10], 2, 3);
    expect(signals).toEqual([
      "hold",
      "hold",
      "enter",
      "hold",
      "hold",
      "exit",
      "hold",
    ]);
  });

  it("is pure — same context yields the same signal", () => {
    const strat = smaCrossover(2, 3);
    const bars = [10, 11, 12].map((c, i) => mkBar(`2024-01-0${i + 1}`, c));
    const ctx: StrategyContext = { history: bars, inPosition: false };
    expect(strat.decide(ctx)).toBe(strat.decide(ctx));
  });
});
