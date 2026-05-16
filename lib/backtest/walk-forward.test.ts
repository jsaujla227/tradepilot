import { describe, it, expect } from "vitest";
import type { HistoricalBar } from "./data";
import type { BacktestConfig } from "./engine";
import {
  sweep,
  walkForward,
  smaParamGrid,
  buildSmaStrategy,
  sharpeObjective,
  totalReturnObjective,
} from "./walk-forward";

const NO_COST: BacktestConfig = {
  initialCapital: 10_000,
  slippage: 0,
  commission: 0,
};

/** A deterministic wave so crossovers actually occur over the series. */
function waveBars(n: number): HistoricalBar[] {
  const bars: HistoricalBar[] = [];
  for (let i = 0; i < n; i++) {
    const close = 100 + 20 * Math.sin(i / 4);
    bars.push({
      ticker: "TEST",
      date: `2024-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(
        1 + (i % 28),
      ).padStart(2, "0")}`,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000,
    });
  }
  return bars;
}

describe("smaParamGrid", () => {
  it("keeps only fast < slow pairs", () => {
    const grid = smaParamGrid([2, 5], [3, 10]);
    expect(grid).toEqual([
      { fast: 2, slow: 3 },
      { fast: 2, slow: 10 },
      { fast: 5, slow: 10 },
    ]);
  });
});

describe("sweep", () => {
  it("ranks param sets by the objective, best first", () => {
    const bars = waveBars(60);
    const grid = smaParamGrid([2, 3, 5], [8, 13]);
    const ranked = sweep(bars, grid, buildSmaStrategy, totalReturnObjective, NO_COST);
    expect(ranked).toHaveLength(grid.length);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
    expect(ranked[0]!.metrics).toBeDefined();
  });
});

describe("walkForward", () => {
  it("produces contiguous, rolling in-sample / out-of-sample windows", () => {
    const bars = waveBars(60);
    const grid = smaParamGrid([2, 3], [8, 13]);
    const report = walkForward(
      bars,
      grid,
      buildSmaStrategy,
      sharpeObjective,
      { inSampleBars: 20, outOfSampleBars: 10 },
      NO_COST,
    );
    // (60 - 20) / 10 = 4 windows.
    expect(report.windows).toHaveLength(4);
    for (const w of report.windows) {
      expect(w.inSampleRange.from <= w.inSampleRange.to).toBe(true);
      expect(w.outOfSampleRange.from <= w.outOfSampleRange.to).toBe(true);
      expect(w.chosenParams.fast!).toBeLessThan(w.chosenParams.slow!);
    }
    expect(Number.isFinite(report.overfittingGap)).toBe(true);
    expect(Number.isFinite(report.aggregateOutOfSample.totalReturnPct)).toBe(
      true,
    );
  });

  it("returns no windows when there are too few bars", () => {
    const report = walkForward(
      waveBars(10),
      smaParamGrid([2], [5]),
      buildSmaStrategy,
      sharpeObjective,
      { inSampleBars: 20, outOfSampleBars: 10 },
      NO_COST,
    );
    expect(report.windows).toEqual([]);
    expect(report.overfittingGap).toBe(0);
    expect(report.aggregateOutOfSample.tradeCount).toBe(0);
  });

  it("is deterministic", () => {
    const bars = waveBars(60);
    const grid = smaParamGrid([2, 3], [8, 13]);
    const run = () =>
      walkForward(bars, grid, buildSmaStrategy, sharpeObjective, {
        inSampleBars: 20,
        outOfSampleBars: 10,
      }, NO_COST);
    expect(run()).toEqual(run());
  });
});
