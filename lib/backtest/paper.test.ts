import { describe, it, expect } from "vitest";
import type { HistoricalBar } from "./data";
import { paperRun } from "./paper";

const bars = (closes: number[]): HistoricalBar[] =>
  closes.map((c, i) => ({
    ticker: "TEST",
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000,
  }));

describe("paperRun", () => {
  it("returns metrics and an equity curve over the given bars", () => {
    const series = bars([10, 11, 12, 13, 14, 13, 12, 11, 10, 9, 10, 11]);
    const run = paperRun(series, 2, 3);
    expect(run.barCount).toBe(series.length);
    expect(run.equityCurve).toHaveLength(series.length);
    expect(Number.isFinite(run.metrics.totalReturnPct)).toBe(true);
  });

  it("handles an empty bar series without throwing", () => {
    const run = paperRun([], 50, 200);
    expect(run.barCount).toBe(0);
    expect(run.equityCurve).toEqual([]);
    expect(run.metrics.tradeCount).toBe(0);
  });
});
