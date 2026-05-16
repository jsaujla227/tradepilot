import { describe, it, expect } from "vitest";
import type { BacktestResult, EquityPoint, Trade } from "./engine";
import { computeMetrics } from "./metrics";

const mkTrade = (
  pnl: number,
  returnPct: number,
  entryDate = "2024-01-01",
  exitDate = "2024-01-02",
): Trade => ({
  entryDate,
  entryPrice: 10,
  exitDate,
  exitPrice: 11,
  shares: 1,
  pnl,
  returnPct,
});

const curve = (pairs: [string, number][]): EquityPoint[] =>
  pairs.map(([date, equity]) => ({ date, equity }));

describe("computeMetrics", () => {
  it("handles a run with no trades", () => {
    const result: BacktestResult = {
      trades: [],
      equityCurve: curve([
        ["2024-01-01", 1000],
        ["2024-01-02", 1100],
      ]),
      finalEquity: 1100,
    };
    const m = computeMetrics(result, 1000);
    expect(m.totalReturnPct).toBeCloseTo(10, 6);
    expect(m.tradeCount).toBe(0);
    expect(m.winRatePct).toBe(0);
    expect(m.profitFactor).toBeNull();
    expect(m.expectancyPct).toBe(0);
    expect(m.maxDrawdownPct).toBe(0);
    expect(m.exposurePct).toBe(0);
  });

  it("computes max drawdown from the equity curve peak", () => {
    const result: BacktestResult = {
      trades: [],
      equityCurve: curve([
        ["2024-01-01", 100],
        ["2024-01-02", 120],
        ["2024-01-03", 90],
        ["2024-01-04", 110],
      ]),
      finalEquity: 110,
    };
    // peak 120, trough 90 -> drawdown 30/120 = 25%.
    expect(computeMetrics(result, 100).maxDrawdownPct).toBeCloseTo(25, 6);
  });

  it("computes win rate, profit factor and expectancy from trades", () => {
    const result: BacktestResult = {
      trades: [
        mkTrade(100, 0.1),
        mkTrade(-50, -0.05),
        mkTrade(60, 0.06),
      ],
      equityCurve: curve([
        ["2024-01-01", 1000],
        ["2024-01-02", 1110],
      ]),
      finalEquity: 1110,
    };
    const m = computeMetrics(result, 1000);
    expect(m.tradeCount).toBe(3);
    expect(m.winRatePct).toBeCloseTo((2 / 3) * 100, 6);
    // gross win 160, gross loss 50.
    expect(m.profitFactor).toBeCloseTo(3.2, 6);
    // winFrac 2/3, avgWin 0.08, avgLoss 0.05.
    expect(m.expectancyPct).toBeCloseTo(
      ((2 / 3) * 0.08 - (1 / 3) * 0.05) * 100,
      6,
    );
  });

  it("computes exposure as the share of days holding a position", () => {
    const result: BacktestResult = {
      trades: [mkTrade(10, 0.01, "2024-01-02", "2024-01-04")],
      equityCurve: curve([
        ["2024-01-01", 1000],
        ["2024-01-02", 1000],
        ["2024-01-03", 1005],
        ["2024-01-04", 1010],
        ["2024-01-05", 1010],
      ]),
      finalEquity: 1010,
    };
    // entry idx 1, exit idx 3 -> 2 of 5 days in market.
    expect(computeMetrics(result, 1000).exposurePct).toBeCloseTo(40, 6);
  });

  it("returns finite, zeroed metrics for an empty result", () => {
    const m = computeMetrics(
      { trades: [], equityCurve: [], finalEquity: 1000 },
      1000,
    );
    expect(m.totalReturnPct).toBe(0);
    expect(m.cagrPct).toBe(0);
    expect(m.sharpe).toBe(0);
    expect(m.sortino).toBe(0);
  });
});
