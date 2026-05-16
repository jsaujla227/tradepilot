import { describe, it, expect } from "vitest";
import { computeBarStats, suggestStopFromAtr } from "./bar-stats";
import type { Bar } from "./massive";

function makeBars(closes: number[], opts?: { volume?: number; range?: number }): Bar[] {
  const volume = opts?.volume ?? 1_000_000;
  const range = opts?.range ?? 1; // high-low spread per bar
  return closes.map((c, i) => ({
    time: (1_700_000_000 + i * 86_400) * 1000,
    open: c,
    high: c + range / 2,
    low: c - range / 2,
    close: c,
    volume,
  }));
}

describe("computeBarStats — bar count guards", () => {
  it("empty array returns nulls and barCount=0", () => {
    const s = computeBarStats([]);
    expect(s.barCount).toBe(0);
    expect(s.sma50).toBeNull();
    expect(s.sma200).toBeNull();
    expect(s.atr14).toBeNull();
    expect(s.avgDollarVolume).toBeNull();
    expect(s.historicalVol20).toBeNull();
    expect(s.lastClose).toBeNull();
  });

  it("19 bars → avgDollarVolume null, 20 bars → defined", () => {
    const closes19 = Array.from({ length: 19 }, (_, i) => 100 + i);
    const closes20 = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(computeBarStats(makeBars(closes19)).avgDollarVolume).toBeNull();
    expect(computeBarStats(makeBars(closes20)).avgDollarVolume).not.toBeNull();
  });

  it("49 bars → sma50 null, 50 bars → defined", () => {
    const closes = Array.from({ length: 50 }, () => 100);
    expect(computeBarStats(makeBars(closes.slice(0, 49))).sma50).toBeNull();
    expect(computeBarStats(makeBars(closes)).sma50).toBeCloseTo(100);
  });

  it("199 bars → sma200 null, 200 bars → defined", () => {
    const closes = Array.from({ length: 200 }, () => 50);
    expect(computeBarStats(makeBars(closes.slice(0, 199))).sma200).toBeNull();
    expect(computeBarStats(makeBars(closes)).sma200).toBeCloseTo(50);
  });
});

describe("computeBarStats — math correctness", () => {
  it("avgDollarVolume = close × volume averaged over last 20", () => {
    // 20 flat $100 closes at 1M shares → $100M/day
    const s = computeBarStats(makeBars(new Array(20).fill(100), { volume: 1_000_000 }));
    expect(s.avgDollarVolume).toBeCloseTo(100_000_000);
  });

  it("sma50 averages the last 50 closes only", () => {
    // first 50 closes = 50, last 50 closes = 150 → sma50 = 150, not 100
    const closes = [
      ...new Array(50).fill(50),
      ...new Array(50).fill(150),
    ];
    const s = computeBarStats(makeBars(closes));
    expect(s.sma50).toBeCloseTo(150);
  });

  it("historicalVol20 of constant prices is 0", () => {
    const s = computeBarStats(makeBars(new Array(25).fill(100)));
    expect(s.historicalVol20).toBeCloseTo(0);
  });

  it("historicalVol20 is positive when prices oscillate", () => {
    const closes: number[] = [];
    for (let i = 0; i < 25; i++) closes.push(i % 2 === 0 ? 100 : 102);
    const s = computeBarStats(makeBars(closes));
    expect(s.historicalVol20).toBeGreaterThan(0);
  });

  it("atr14 of flat bars with range=1 is 1", () => {
    // High-low = 1 for every bar, no gaps → TR = 1, ATR = 1
    const s = computeBarStats(makeBars(new Array(30).fill(100), { range: 1 }));
    expect(s.atr14).toBeCloseTo(1, 4);
  });

  it("lastClose matches the final bar's close", () => {
    const s = computeBarStats(makeBars([10, 20, 30, 40, 50]));
    expect(s.lastClose).toBe(50);
    expect(s.barCount).toBe(5);
  });
});

describe("suggestStopFromAtr", () => {
  it("null ATR returns null", () => {
    expect(
      suggestStopFromAtr({ entry: 100, atr14: null, side: "long" }),
    ).toBeNull();
  });

  it("long stop = entry − 2×ATR by default", () => {
    expect(suggestStopFromAtr({ entry: 100, atr14: 3, side: "long" })).toBe(94);
  });

  it("short stop = entry + 2×ATR by default", () => {
    expect(suggestStopFromAtr({ entry: 100, atr14: 3, side: "short" })).toBe(106);
  });

  it("respects custom multiplier", () => {
    expect(
      suggestStopFromAtr({
        entry: 100,
        atr14: 2,
        side: "long",
        multiplier: 3,
      }),
    ).toBe(94);
  });

  it("zero or negative ATR returns null", () => {
    expect(suggestStopFromAtr({ entry: 100, atr14: 0, side: "long" })).toBeNull();
    expect(suggestStopFromAtr({ entry: 100, atr14: -1, side: "long" })).toBeNull();
  });
});
