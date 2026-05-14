import { describe, it, expect } from "vitest";
import { scoreWatchlistItem, scoreMomentum } from "./index";

// Helpers
const base = {
  price: 100,
  prevClose: 100,
  high: 101,
  low: 99,
  targetEntry: null,
  targetStop: null,
  targetPrice: null,
  daysToEarnings: null,
} as const;

describe("scoreWatchlistItem — trend", () => {
  it("neutral momentum (0%) → trend value 0.5", () => {
    const r = scoreWatchlistItem({ ...base, prevClose: 100 });
    expect(r.trend.value).toBeCloseTo(0.5);
    expect(r.trend.dataAvailable).toBe(true);
  });

  it("+3% momentum clips to trend value 1.0", () => {
    const r = scoreWatchlistItem({ ...base, price: 103, prevClose: 100 });
    expect(r.trend.value).toBeCloseTo(1.0);
  });

  it("-3% momentum clips to trend value 0.0", () => {
    const r = scoreWatchlistItem({ ...base, price: 97, prevClose: 100 });
    expect(r.trend.value).toBeCloseTo(0.0);
  });

  it("+6% momentum clips at 1.0 (no overshoot)", () => {
    const r = scoreWatchlistItem({ ...base, price: 106, prevClose: 100 });
    expect(r.trend.value).toBe(1.0);
  });

  it("null prevClose → trend 0.5 neutral, dataAvailable false", () => {
    const r = scoreWatchlistItem({ ...base, prevClose: null });
    expect(r.trend.value).toBe(0.5);
    expect(r.trend.dataAvailable).toBe(false);
  });
});

describe("scoreWatchlistItem — volatility", () => {
  it("zero day range → volatility value 1.0", () => {
    const r = scoreWatchlistItem({ ...base, high: 100, low: 100 });
    expect(r.volatility.value).toBeCloseTo(1.0);
    expect(r.volatility.dataAvailable).toBe(true);
  });

  it("5% day range → volatility value 0.0", () => {
    const r = scoreWatchlistItem({ ...base, high: 105, low: 100 });
    // range = 5/100 = 0.05 → value = 0
    expect(r.volatility.value).toBeCloseTo(0.0);
  });

  it("2.5% day range → volatility value 0.5", () => {
    const r = scoreWatchlistItem({ ...base, high: 102.5, low: 100 });
    expect(r.volatility.value).toBeCloseTo(0.5);
  });

  it("null high/low → volatility 0.5 neutral, dataAvailable false", () => {
    const r = scoreWatchlistItem({ ...base, high: null, low: null });
    expect(r.volatility.value).toBe(0.5);
    expect(r.volatility.dataAvailable).toBe(false);
  });

  it("range beyond 5% clamps at 0 (no undershoot)", () => {
    const r = scoreWatchlistItem({ ...base, high: 115, low: 100 });
    expect(r.volatility.value).toBe(0.0);
  });
});

describe("scoreWatchlistItem — R-multiple", () => {
  it("3R setup → rMultiple value 1.0", () => {
    const r = scoreWatchlistItem({
      ...base,
      targetEntry: 100,
      targetStop: 90,
      targetPrice: 130,
    });
    expect(r.rMultiple.value).toBeCloseTo(1.0);
    expect(r.rMultiple.dataAvailable).toBe(true);
  });

  it("1.5R setup → rMultiple value 0.5", () => {
    const r = scoreWatchlistItem({
      ...base,
      targetEntry: 100,
      targetStop: 90,
      targetPrice: 115,
    });
    expect(r.rMultiple.value).toBeCloseTo(0.5);
  });

  it("6R setup clamps at 1.0", () => {
    const r = scoreWatchlistItem({
      ...base,
      targetEntry: 100,
      targetStop: 90,
      targetPrice: 160,
    });
    expect(r.rMultiple.value).toBe(1.0);
  });

  it("missing targets → rMultiple value 0, dataAvailable false", () => {
    const r = scoreWatchlistItem({ ...base });
    expect(r.rMultiple.value).toBe(0);
    expect(r.rMultiple.dataAvailable).toBe(false);
  });

  it("entry equals stop → rMultiple value 0, dataAvailable false", () => {
    const r = scoreWatchlistItem({
      ...base,
      targetEntry: 100,
      targetStop: 100,
      targetPrice: 120,
    });
    expect(r.rMultiple.value).toBe(0);
    expect(r.rMultiple.dataAvailable).toBe(false);
  });

  it("short setup (stop above entry) with target below entry → scores correctly", () => {
    const r = scoreWatchlistItem({
      ...base,
      targetEntry: 100,
      targetStop: 110,
      targetPrice: 70,
    });
    expect(r.rMultiple.value).toBeCloseTo(1.0);
    expect(r.rMultiple.dataAvailable).toBe(true);
  });

  it("long setup with target below entry → invalid, value 0, dataAvailable false", () => {
    const r = scoreWatchlistItem({
      ...base,
      targetEntry: 100,
      targetStop: 90,
      targetPrice: 80,
    });
    expect(r.rMultiple.value).toBe(0);
    expect(r.rMultiple.dataAvailable).toBe(false);
  });

  it("short setup with target above entry → invalid, value 0, dataAvailable false", () => {
    const r = scoreWatchlistItem({
      ...base,
      targetEntry: 100,
      targetStop: 110,
      targetPrice: 120,
    });
    expect(r.rMultiple.value).toBe(0);
    expect(r.rMultiple.dataAvailable).toBe(false);
  });
});

describe("scoreWatchlistItem — liquidity", () => {
  it("always 0.5 neutral, dataAvailable false (no bars data)", () => {
    const r = scoreWatchlistItem({ ...base });
    expect(r.liquidity.value).toBe(0.5);
    expect(r.liquidity.dataAvailable).toBe(false);
  });
});

describe("scoreWatchlistItem — eventRisk", () => {
  it("null daysToEarnings → 0.5 neutral, dataAvailable false", () => {
    const r = scoreWatchlistItem({ ...base, daysToEarnings: null });
    expect(r.eventRisk.value).toBe(0.5);
    expect(r.eventRisk.dataAvailable).toBe(false);
  });

  it("more than 5 days out → 1.0 (clear)", () => {
    const r = scoreWatchlistItem({ ...base, daysToEarnings: 10 });
    expect(r.eventRisk.value).toBe(1.0);
    expect(r.eventRisk.dataAvailable).toBe(true);
  });

  it("exactly 5 days out → 0.5 (caution)", () => {
    const r = scoreWatchlistItem({ ...base, daysToEarnings: 5 });
    expect(r.eventRisk.value).toBe(0.5);
  });

  it("4 days out → 0.5 (caution)", () => {
    const r = scoreWatchlistItem({ ...base, daysToEarnings: 4 });
    expect(r.eventRisk.value).toBe(0.5);
  });

  it("3 days out → 0.0 (gap risk)", () => {
    const r = scoreWatchlistItem({ ...base, daysToEarnings: 3 });
    expect(r.eventRisk.value).toBe(0.0);
  });

  it("0 days out (today) → 0.0 (gap risk)", () => {
    const r = scoreWatchlistItem({ ...base, daysToEarnings: 0 });
    expect(r.eventRisk.value).toBe(0.0);
  });
});

describe("scoreWatchlistItem — total", () => {
  it("all-neutral inputs (zero range, no R, no earnings) → total 47.5", () => {
    // trend=0.5, vol=1.0, rMultiple=0, liquidity=0.5, eventRisk=0.5
    // 0.5*0.25 + 1.0*0.20 + 0*0.25 + 0.5*0.10 + 0.5*0.20 = 0.475 → 47.5
    const r = scoreWatchlistItem({
      ...base,
      prevClose: 100,
      high: 100,
      low: 100,
    });
    expect(r.total).toBeCloseTo(47.5, 1);
  });

  it("near-earnings position scores meaningfully lower than safe one", () => {
    const safe = scoreWatchlistItem({
      price: 103,
      prevClose: 100,
      high: 103.5,
      low: 102.5,
      targetEntry: 100,
      targetStop: 90,
      targetPrice: 130,
      daysToEarnings: 14,
    });
    const earningsWeek = scoreWatchlistItem({
      price: 103,
      prevClose: 100,
      high: 103.5,
      low: 102.5,
      targetEntry: 100,
      targetStop: 90,
      targetPrice: 130,
      daysToEarnings: 2,
    });
    // 20% weight × 1.0 difference = 20 points
    expect(safe.total - earningsWeek.total).toBeCloseTo(20, 1);
  });

  it("scores visibly differ between a strong and weak setup", () => {
    const strong = scoreWatchlistItem({
      price: 103,
      prevClose: 100,
      high: 103.5,
      low: 102.5,
      targetEntry: 100,
      targetStop: 90,
      targetPrice: 130,
      daysToEarnings: 14,
    });
    const weak = scoreWatchlistItem({
      price: 97,
      prevClose: 100,
      high: 115,
      low: 97,
      targetEntry: null,
      targetStop: null,
      targetPrice: null,
      daysToEarnings: 2,
    });
    expect(strong.total).toBeGreaterThan(weak.total + 20);
  });

  it("total is within 0–100", () => {
    const r = scoreWatchlistItem({
      price: 106,
      prevClose: 100,
      high: 106,
      low: 106,
      targetEntry: 100,
      targetStop: 90,
      targetPrice: 160,
      daysToEarnings: 30,
    });
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
  });
});

describe("scoreMomentum", () => {
  it("all-neutral inputs (zero range, no earnings) → momentum 67.5", () => {
    // trend=0.5, vol=1.0, eventRisk=0.5
    // 0.5*0.45 + 1.0*0.35 + 0.5*0.20 = 0.225 + 0.35 + 0.10 = 0.675 → 67.5
    const r = scoreMomentum({
      price: 100,
      prevClose: 100,
      high: 100,
      low: 100,
      daysToEarnings: null,
    });
    expect(r.momentum).toBeCloseTo(67.5, 1);
    expect(r.breakdown.trend.value).toBeCloseTo(0.5);
    expect(r.breakdown.eventRisk.value).toBe(0.5);
  });

  it("earnings in 2 days drops momentum by 20 (eventRisk weight)", () => {
    const clear = scoreMomentum({
      price: 103,
      prevClose: 100,
      high: 103.5,
      low: 102.5,
      daysToEarnings: 14,
    });
    const risky = scoreMomentum({
      price: 103,
      prevClose: 100,
      high: 103.5,
      low: 102.5,
      daysToEarnings: 2,
    });
    expect(clear.momentum - risky.momentum).toBeCloseTo(20, 1);
  });

  it("momentum is within 0–100", () => {
    const r = scoreMomentum({
      price: 106,
      prevClose: 100,
      high: 106,
      low: 106,
      daysToEarnings: 30,
    });
    expect(r.momentum).toBeGreaterThanOrEqual(0);
    expect(r.momentum).toBeLessThanOrEqual(100);
  });
});
