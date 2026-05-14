import { describe, it, expect } from "vitest";
import { scoreWatchlistItem } from "./index";

// Helpers
const base = {
  price: 100,
  prevClose: 100,
  high: 101,
  low: 99,
  targetEntry: null,
  targetStop: null,
  targetPrice: null,
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
    // entry=100, stop=90 → 1R=10; target=130 → plannedR=3
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
    // entry=100, stop=90 → 1R=10; target=115 → plannedR=1.5
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
});

describe("scoreWatchlistItem — liquidity", () => {
  it("always 0.5 neutral, dataAvailable false (no bars data)", () => {
    const r = scoreWatchlistItem({ ...base });
    expect(r.liquidity.value).toBe(0.5);
    expect(r.liquidity.dataAvailable).toBe(false);
  });
});

describe("scoreWatchlistItem — total", () => {
  it("all-neutral inputs → total ≈ 50", () => {
    // trend=0.5, vol=0.5, rMultiple=0, liquidity=0.5
    // 0.5*0.30 + 0.5*0.25 + 0*0.30 + 0.5*0.15 = 0.35 → 35
    const r = scoreWatchlistItem({ ...base, prevClose: 100, high: 100, low: 100 });
    // zero day range → vol=1.0; 0% momentum → trend=0.5; no R → 0; liq=0.5
    // 0.5*0.30 + 1.0*0.25 + 0*0.30 + 0.5*0.15 = 0.15+0.25+0+0.075 = 0.475 → 47.5
    expect(r.total).toBeCloseTo(47.5, 1);
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
    });
    const weak = scoreWatchlistItem({
      price: 97,
      prevClose: 100,
      high: 115,
      low: 97,
      targetEntry: null,
      targetStop: null,
      targetPrice: null,
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
    });
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
  });
});
