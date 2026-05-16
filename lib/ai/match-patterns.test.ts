import { describe, it, expect } from "vitest";
import { matchPatterns, type SetupInput } from "./match-patterns";
import type { TradePattern } from "./patterns";

const mkPattern = (
  type: "winning" | "losing" | "neutral",
  conditions: TradePattern["conditions"],
  sample_count = 5,
): TradePattern => ({
  pattern_type: type,
  description: "Test pattern",
  conditions,
  stats: {
    win_rate: 0.6,
    avg_r: 1.5,
    avg_win_r: 2.0,
    avg_loss_r: 1.0,
    expectancy: 0.5,
    profit_factor: 1.8,
    sample_count,
  },
});

const setup: SetupInput = {
  sector: "Tech",
  direction: "long",
  r_at_entry: 2.5,
};

describe("matchPatterns", () => {
  it("returns empty when no patterns match", () => {
    const patterns = [mkPattern("winning", { sector: "Energy" })];
    expect(matchPatterns(patterns, setup)).toEqual([]);
  });

  it("matches on sector alone", () => {
    const patterns = [mkPattern("winning", { sector: "Tech" })];
    const result = matchPatterns(patterns, setup);
    expect(result).toHaveLength(1);
    expect(result[0]!.match_reason).toContain("Tech");
  });

  it("matches on direction alone", () => {
    const patterns = [mkPattern("winning", { direction: "long" })];
    const result = matchPatterns(patterns, setup);
    expect(result).toHaveLength(1);
    expect(result[0]!.match_reason).toContain("long");
  });

  it("matches on r_tier alone — 2.5 maps to 2-3", () => {
    const patterns = [mkPattern("winning", { r_tier: "2-3" })];
    const result = matchPatterns(patterns, setup);
    expect(result).toHaveLength(1);
    expect(result[0]!.match_reason).toContain("2-3");
  });

  it("does not match when r_tier differs", () => {
    const patterns = [mkPattern("winning", { r_tier: ">3" })];
    expect(matchPatterns(patterns, setup)).toHaveLength(0);
  });

  it("matches all conditions present simultaneously", () => {
    const patterns = [
      mkPattern("winning", { sector: "Tech", direction: "long", r_tier: "2-3" }),
    ];
    const result = matchPatterns(patterns, setup);
    expect(result).toHaveLength(1);
    expect(result[0]!.match_reason).toContain("Tech");
    expect(result[0]!.match_reason).toContain("long");
    expect(result[0]!.match_reason).toContain("2-3");
  });

  it("rejects when one condition mismatches in a multi-condition pattern", () => {
    const patterns = [
      mkPattern("winning", { sector: "Tech", direction: "short" }),
    ];
    expect(matchPatterns(patterns, setup)).toHaveLength(0);
  });

  it("sorts winning before neutral before losing", () => {
    const patterns = [
      mkPattern("losing", { sector: "Tech" }),
      mkPattern("neutral", { direction: "long" }),
      mkPattern("winning", { r_tier: "2-3" }),
    ];
    const result = matchPatterns(patterns, setup);
    expect(result[0]!.pattern.pattern_type).toBe("winning");
    expect(result[1]!.pattern.pattern_type).toBe("neutral");
    expect(result[2]!.pattern.pattern_type).toBe("losing");
  });

  it("sorts by sample_count descending within same type", () => {
    const patterns = [
      mkPattern("winning", { direction: "long" }, 3),
      mkPattern("winning", { r_tier: "2-3" }, 10),
    ];
    const result = matchPatterns(patterns, setup);
    expect(result[0]!.pattern.stats.sample_count).toBe(10);
  });

  it("skips catch-all patterns with no conditions", () => {
    const patterns = [mkPattern("neutral", {})];
    expect(matchPatterns(patterns, setup)).toHaveLength(0);
  });

  it("r_at_entry < 2 maps to <2 tier", () => {
    const patterns = [mkPattern("losing", { r_tier: "<2" })];
    const s: SetupInput = { direction: "long", r_at_entry: 1.5 };
    expect(matchPatterns(patterns, s)).toHaveLength(1);
  });

  it("r_at_entry > 3 maps to >3 tier", () => {
    const patterns = [mkPattern("winning", { r_tier: ">3" })];
    const s: SetupInput = { direction: "long", r_at_entry: 3.5 };
    expect(matchPatterns(patterns, s)).toHaveLength(1);
  });
});
