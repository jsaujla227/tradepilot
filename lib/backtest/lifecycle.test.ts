import { describe, it, expect } from "vitest";
import type { BacktestMetrics } from "./metrics";
import {
  nextStatus,
  isLegalTransition,
  evaluateBacktestGate,
} from "./lifecycle";

const metrics = (over: Partial<BacktestMetrics>): BacktestMetrics => ({
  totalReturnPct: 0,
  cagrPct: 0,
  sharpe: 0,
  sortino: 0,
  maxDrawdownPct: 10,
  tradeCount: 20,
  winRatePct: 50,
  avgTradeReturnPct: 0,
  expectancyPct: 1,
  profitFactor: 1.5,
  exposurePct: 50,
  ...over,
});

describe("lifecycle transitions", () => {
  it("steps the ladder forward one stage at a time", () => {
    expect(nextStatus("draft")).toBe("backtested");
    expect(nextStatus("backtested")).toBe("paper");
    expect(nextStatus("paper")).toBe("live_small");
    expect(nextStatus("live_small")).toBe("approved");
    expect(nextStatus("approved")).toBeNull();
    expect(nextStatus("rejected")).toBeNull();
  });

  it("allows only single forward steps", () => {
    expect(isLegalTransition("draft", "backtested")).toBe(true);
    expect(isLegalTransition("draft", "paper")).toBe(false);
    expect(isLegalTransition("draft", "approved")).toBe(false);
    expect(isLegalTransition("paper", "live_small")).toBe(true);
  });

  it("allows rejection from any non-terminal stage", () => {
    expect(isLegalTransition("draft", "rejected")).toBe(true);
    expect(isLegalTransition("paper", "rejected")).toBe(true);
    expect(isLegalTransition("approved", "rejected")).toBe(false);
    expect(isLegalTransition("rejected", "draft")).toBe(false);
  });
});

describe("evaluateBacktestGate", () => {
  it("passes when every criterion is met", () => {
    const r = evaluateBacktestGate(
      metrics({ expectancyPct: 0.8, maxDrawdownPct: 12, tradeCount: 25 }),
      0.3,
    );
    expect(r.passed).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("fails on negative expectancy", () => {
    const r = evaluateBacktestGate(metrics({ expectancyPct: -0.5 }), 0.2);
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.label.includes("expectancy"))!.ok).toBe(
      false,
    );
  });

  it("fails on excessive drawdown, thin trade count, or overfitting", () => {
    expect(evaluateBacktestGate(metrics({ maxDrawdownPct: 40 }), 0.2).passed).toBe(
      false,
    );
    expect(evaluateBacktestGate(metrics({ tradeCount: 4 }), 0.2).passed).toBe(
      false,
    );
    expect(evaluateBacktestGate(metrics({}), 2.5).passed).toBe(false);
  });
});
