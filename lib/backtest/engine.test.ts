import { describe, it, expect } from "vitest";
import type { HistoricalBar } from "./data";
import type { Strategy, Signal } from "./strategy";
import { runBacktest, type BacktestConfig } from "./engine";
import { smaCrossover } from "./strategies/sma-crossover";

const mkBar = (
  date: string,
  open: number,
  close: number,
): HistoricalBar => ({
  ticker: "TEST",
  date,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  volume: 1000,
});

/** A strategy whose signal on day t is `script[t]` (decided at day t close). */
function scripted(script: Signal[]): Strategy {
  return {
    name: "scripted",
    params: {},
    decide: (ctx) => script[ctx.history.length - 1] ?? "hold",
  };
}

// Shared fixture: distinct open/close so fills (open) and equity marks
// (close) are exercised independently.
const FIXTURE: HistoricalBar[] = [
  mkBar("2024-01-01", 10, 10.5),
  mkBar("2024-01-02", 11, 11.5),
  mkBar("2024-01-03", 12, 12.5),
  mkBar("2024-01-04", 13, 13.5),
];

const NO_COST: BacktestConfig = {
  initialCapital: 1000,
  slippage: 0,
  commission: 0,
};

describe("runBacktest", () => {
  it("returns the initial capital for an empty bar series", () => {
    const r = runBacktest([], scripted([]), NO_COST);
    expect(r.finalEquity).toBe(1000);
    expect(r.trades).toEqual([]);
    expect(r.equityCurve).toEqual([]);
  });

  it("fills at the next open and marks equity at the close", () => {
    // enter@day0 -> fill day1 open 11; exit@day2 -> fill day3 open 13.
    const r = runBacktest(
      FIXTURE,
      scripted(["enter", "hold", "exit", "hold"]),
      NO_COST,
    );
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0]!;
    expect(t.entryDate).toBe("2024-01-02");
    expect(t.entryPrice).toBe(11);
    expect(t.exitDate).toBe("2024-01-04");
    expect(t.exitPrice).toBe(13);
    expect(t.shares).toBe(90); // floor(1000 / 11)
    expect(t.pnl).toBeCloseTo(180, 6); // 90 * (13 - 11)
    expect(r.finalEquity).toBeCloseTo(1180, 6);
    expect(r.equityCurve.map((p) => p.equity)).toEqual([
      1000, // day1 flat
      1045, // 10 cash + 90 * 11.5
      1135, // 10 cash + 90 * 12.5
      1180, // exited, all cash
    ]);
  });

  it("charges commission on entry and exit", () => {
    const r = runBacktest(
      FIXTURE,
      scripted(["enter", "hold", "exit", "hold"]),
      { initialCapital: 1000, slippage: 0, commission: 1 },
    );
    // shares = floor((1000 - 1) / 11) = 90; entryCost = 991; exit proceeds 1169.
    expect(r.trades[0]!.pnl).toBeCloseTo(178, 6);
    expect(r.finalEquity).toBeCloseTo(1178, 6);
  });

  it("applies slippage against the trader", () => {
    const r = runBacktest(
      FIXTURE,
      scripted(["enter", "hold", "exit", "hold"]),
      { initialCapital: 1000, slippage: 0.01, commission: 0 },
    );
    // buy fill 11.11, sell fill 12.87, 90 shares.
    expect(r.trades[0]!.entryPrice).toBeCloseTo(11.11, 6);
    expect(r.trades[0]!.exitPrice).toBeCloseTo(12.87, 6);
    expect(r.finalEquity).toBeCloseTo(1158.4, 4);
  });

  it("force-closes a position still open at the end of the data", () => {
    const r = runBacktest(
      FIXTURE,
      scripted(["enter", "hold", "hold", "hold"]),
      NO_COST,
    );
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.exitDate).toBe("2024-01-04");
    expect(r.trades[0]!.exitPrice).toBe(13.5); // final close, not open
    expect(r.finalEquity).toBeCloseTo(1225, 6); // 10 + 90 * 13.5
    expect(r.equityCurve.at(-1)!.equity).toBeCloseTo(1225, 6);
  });

  it("is deterministic — identical inputs give identical results", () => {
    const a = runBacktest(FIXTURE, smaCrossover(2, 3), NO_COST);
    const b = runBacktest(FIXTURE, smaCrossover(2, 3), NO_COST);
    expect(a).toEqual(b);
  });

  it("is causal — future bars never affect past equity points", () => {
    const base: HistoricalBar[] = [
      mkBar("2024-02-01", 10, 10),
      mkBar("2024-02-02", 11, 11),
      mkBar("2024-02-03", 12, 12),
      mkBar("2024-02-04", 13, 13),
      mkBar("2024-02-05", 14, 14),
      mkBar("2024-02-06", 15, 15),
    ];
    // Same as `base` but with the last three bars' prices changed.
    const mutatedFuture: HistoricalBar[] = [
      ...base.slice(0, 3),
      mkBar("2024-02-04", 99, 88),
      mkBar("2024-02-05", 77, 66),
      mkBar("2024-02-06", 55, 44),
    ];
    const script: Signal[] = [
      "enter",
      "hold",
      "exit",
      "hold",
      "hold",
      "hold",
    ];
    const a = runBacktest(base, scripted(script), NO_COST);
    const b = runBacktest(mutatedFuture, scripted(script), NO_COST);
    // Equity points for days 0-2 are fixed before the day-3 exit fill.
    expect(a.equityCurve.slice(0, 3)).toEqual(b.equityCurve.slice(0, 3));
  });

  it("runs the SMA crossover end to end and produces realised trades", () => {
    const closes = [10, 11, 12, 13, 14, 13, 12, 11, 10, 9];
    const bars = closes.map((c, i) =>
      mkBar(`2024-03-${String(i + 1).padStart(2, "0")}`, c, c),
    );
    const r = runBacktest(bars, smaCrossover(2, 3), NO_COST);
    expect(r.trades.length).toBeGreaterThan(0);
    expect(Number.isFinite(r.finalEquity)).toBe(true);
    expect(r.equityCurve).toHaveLength(bars.length);
  });
});
