import { describe, it, expect } from "vitest";
import { calcCost, calcSonnetCost } from "./pricing";

describe("calcCost", () => {
  it("returns 0 for all-zero token counts", () => {
    expect(calcCost(0, 0, 0, 0)).toBe(0);
  });

  it("prices 1M input tokens at $15.00", () => {
    expect(calcCost(1_000_000, 0, 0, 0)).toBeCloseTo(15.0);
  });

  it("prices 1M output tokens at $75.00", () => {
    expect(calcCost(0, 1_000_000, 0, 0)).toBeCloseTo(75.0);
  });

  it("prices 1M cache-read tokens at $1.50", () => {
    expect(calcCost(0, 0, 1_000_000, 0)).toBeCloseTo(1.5);
  });

  it("prices 1M cache-creation tokens at $18.75", () => {
    expect(calcCost(0, 0, 0, 1_000_000)).toBeCloseTo(18.75);
  });

  it("sums all token types correctly", () => {
    // 1000 input = $0.015; 500 output = $0.0375; 200 cacheRead = $0.0003; 100 cacheCreate = $0.001875
    const cost = calcCost(1000, 500, 200, 100);
    expect(cost).toBeCloseTo(0.015 + 0.0375 + 0.0003 + 0.001875, 8);
  });

  it("cache-read input costs 0.10× the rate of regular input tokens", () => {
    const normal = calcCost(1_000_000, 0, 0, 0);
    const cacheRead = calcCost(0, 0, 1_000_000, 0);
    expect(cacheRead).toBeCloseTo(normal * 0.1);
  });
});

describe("calcSonnetCost", () => {
  it("prices 1M input tokens at $3.00", () => {
    expect(calcSonnetCost(1_000_000, 0, 0, 0)).toBeCloseTo(3.0);
  });

  it("prices 1M output tokens at $15.00", () => {
    expect(calcSonnetCost(0, 1_000_000, 0, 0)).toBeCloseTo(15.0);
  });

  it("is roughly 5× cheaper than Opus for matched workloads", () => {
    const opus = calcCost(10_000, 1_000, 0, 0);
    const sonnet = calcSonnetCost(10_000, 1_000, 0, 0);
    expect(sonnet * 5).toBeCloseTo(opus, 4);
  });
});
