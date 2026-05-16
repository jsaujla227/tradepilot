import { describe, it, expect } from "vitest";
import {
  positionSize,
  rMultiple,
  lossScenarios,
  concentrationLabel,
  dailyLossBreached,
  portfolioHeat,
  RiskError,
} from "./index";

describe("positionSize", () => {
  it("computes shares for a standard long trade", () => {
    const out = positionSize({
      entry: 100,
      stop: 95,
      accountSize: 10000,
      maxRiskPct: 1,
    });
    expect(out.shares).toBe(20);
    expect(out.riskAmount).toBe(100);
    expect(out.perShareRisk).toBe(5);
    expect(out.capitalRequired).toBe(2000);
    expect(out.pctOfAccount).toBe(20);
    expect(out.direction).toBe("long");
  });

  it("detects a short trade when stop is above entry", () => {
    const out = positionSize({
      entry: 100,
      stop: 105,
      accountSize: 10000,
      maxRiskPct: 1,
    });
    expect(out.direction).toBe("short");
    expect(out.shares).toBe(20);
  });

  it("floors fractional shares", () => {
    // risk = 100, per-share = 3, raw = 33.33 → 33
    const out = positionSize({
      entry: 100,
      stop: 97,
      accountSize: 10000,
      maxRiskPct: 1,
    });
    expect(out.shares).toBe(33);
  });

  it("returns zero shares when one share already exceeds risk room", () => {
    // risk = 1, per-share = 200, raw = 0.005 → 0
    const out = positionSize({
      entry: 1000,
      stop: 800,
      accountSize: 100,
      maxRiskPct: 1,
    });
    expect(out.shares).toBe(0);
  });

  it("throws when entry equals stop", () => {
    expect(() =>
      positionSize({ entry: 100, stop: 100, accountSize: 10000, maxRiskPct: 1 }),
    ).toThrow(RiskError);
  });

  it("throws on zero account size", () => {
    expect(() =>
      positionSize({ entry: 100, stop: 95, accountSize: 0, maxRiskPct: 1 }),
    ).toThrow(RiskError);
  });

  it("throws on negative entry", () => {
    expect(() =>
      positionSize({ entry: -100, stop: 95, accountSize: 10000, maxRiskPct: 1 }),
    ).toThrow(RiskError);
  });

  it("throws on max risk >= 100%", () => {
    expect(() =>
      positionSize({ entry: 100, stop: 95, accountSize: 10000, maxRiskPct: 100 }),
    ).toThrow(RiskError);
  });

  it("throws on NaN inputs", () => {
    expect(() =>
      positionSize({ entry: NaN, stop: 95, accountSize: 10000, maxRiskPct: 1 }),
    ).toThrow(RiskError);
  });
});

describe("rMultiple", () => {
  it("computes planned R for a long trade", () => {
    const out = rMultiple({ entry: 100, stop: 95, target: 115 });
    expect(out.direction).toBe("long");
    expect(out.r).toBe(5);
    expect(out.plannedR).toBe(3);
    expect(out.actualR).toBeNull();
  });

  it("computes actual R when an exit is provided", () => {
    const out = rMultiple({ entry: 100, stop: 95, target: 115, exit: 110 });
    expect(out.actualR).toBe(2);
  });

  it("computes planned R for a short trade", () => {
    const out = rMultiple({ entry: 100, stop: 105, target: 85 });
    expect(out.direction).toBe("short");
    expect(out.plannedR).toBe(3);
  });

  it("returns negative R when target sits on the wrong side", () => {
    const out = rMultiple({ entry: 100, stop: 95, target: 90 });
    expect(out.plannedR).toBe(-2);
  });

  it("throws when entry equals stop", () => {
    expect(() => rMultiple({ entry: 100, stop: 100, target: 110 })).toThrow(
      RiskError,
    );
  });

  it("throws on negative target", () => {
    expect(() => rMultiple({ entry: 100, stop: 95, target: -1 })).toThrow(
      RiskError,
    );
  });
});

describe("lossScenarios", () => {
  it("computes losses at default drop scenarios", () => {
    const out = lossScenarios({ shares: 100, entry: 50 });
    expect(out.positionValue).toBe(5000);
    expect(out.scenarios).toHaveLength(5);
    const first = out.scenarios[0]!;
    expect(first.dropPct).toBe(-1);
    expect(first.priceAtDrop).toBeCloseTo(49.5);
    expect(first.loss).toBeCloseTo(50);
    const last = out.scenarios[4]!;
    expect(last.dropPct).toBe(-20);
    expect(last.loss).toBeCloseTo(1000);
  });

  it("accepts custom drop scenarios", () => {
    const out = lossScenarios({ shares: 10, entry: 100, dropPcts: [-50] });
    expect(out.scenarios[0]!.priceAtDrop).toBe(50);
    expect(out.scenarios[0]!.loss).toBe(500);
  });

  it("returns zero losses when shares is 0", () => {
    const out = lossScenarios({ shares: 0, entry: 100 });
    for (const s of out.scenarios) expect(s.loss).toBe(0);
    expect(out.positionValue).toBe(0);
  });

  it("throws when a drop pct is positive", () => {
    expect(() =>
      lossScenarios({ shares: 10, entry: 100, dropPcts: [5] }),
    ).toThrow(RiskError);
  });

  it("throws on negative shares", () => {
    expect(() => lossScenarios({ shares: -1, entry: 100 })).toThrow(RiskError);
  });
});

describe("concentrationLabel", () => {
  it("labels diversified positions", () => {
    const out = concentrationLabel({
      positionValue: 500,
      portfolioValue: 10000,
    });
    expect(out.pct).toBe(5);
    expect(out.severity).toBe("low");
    expect(out.label).toBe("diversified");
  });

  it("labels concentrated positions (10–25%)", () => {
    const out = concentrationLabel({
      positionValue: 2000,
      portfolioValue: 10000,
    });
    expect(out.severity).toBe("moderate");
    expect(out.label).toBe("concentrated");
  });

  it("labels high concentration (25–50%)", () => {
    const out = concentrationLabel({
      positionValue: 3000,
      portfolioValue: 10000,
    });
    expect(out.severity).toBe("high");
    expect(out.label).toBe("high concentration");
  });

  it("labels single-name risk at ≥50%", () => {
    const out = concentrationLabel({
      positionValue: 6000,
      portfolioValue: 10000,
    });
    expect(out.severity).toBe("critical");
    expect(out.label).toBe("single-name risk");
  });

  it("places the 10% boundary in the concentrated bucket", () => {
    const out = concentrationLabel({
      positionValue: 1000,
      portfolioValue: 10000,
    });
    expect(out.severity).toBe("moderate");
  });

  it("returns zero pct when position is empty", () => {
    const out = concentrationLabel({
      positionValue: 0,
      portfolioValue: 10000,
    });
    expect(out.pct).toBe(0);
    expect(out.severity).toBe("low");
  });

  it("throws when position exceeds portfolio", () => {
    expect(() =>
      concentrationLabel({ positionValue: 11000, portfolioValue: 10000 }),
    ).toThrow(RiskError);
  });
});

describe("dailyLossBreached", () => {
  it("flags not breached when loss is below the limit", () => {
    const out = dailyLossBreached({
      accountSize: 10000,
      dailyLossLimitPct: 3,
      realizedToday: -100,
      openPnL: -50,
    });
    expect(out.totalToday).toBe(-150);
    expect(out.limit).toBe(300);
    expect(out.breached).toBe(false);
    expect(out.remaining).toBe(150);
  });

  it("flags breached when loss exactly hits the limit", () => {
    const out = dailyLossBreached({
      accountSize: 10000,
      dailyLossLimitPct: 3,
      realizedToday: -300,
      openPnL: 0,
    });
    expect(out.breached).toBe(true);
    expect(out.remaining).toBe(0);
  });

  it("flags breached when combined realized + open exceeds the limit", () => {
    const out = dailyLossBreached({
      accountSize: 10000,
      dailyLossLimitPct: 3,
      realizedToday: -200,
      openPnL: -200,
    });
    expect(out.breached).toBe(true);
  });

  it("never breached on a winning day", () => {
    const out = dailyLossBreached({
      accountSize: 10000,
      dailyLossLimitPct: 3,
      realizedToday: 500,
      openPnL: -100,
    });
    expect(out.totalToday).toBe(400);
    expect(out.breached).toBe(false);
    expect(out.remaining).toBe(300);
  });

  it("throws on non-finite P/L", () => {
    expect(() =>
      dailyLossBreached({
        accountSize: 10000,
        dailyLossLimitPct: 3,
        realizedToday: NaN,
        openPnL: 0,
      }),
    ).toThrow(RiskError);
  });
});

describe("portfolioHeat", () => {
  it("sums open risk from entry when no price is supplied", () => {
    const out = portfolioHeat({
      accountSize: 10000,
      maxHeatPct: 6,
      positions: [
        { ticker: "AAA", shares: 100, entry: 50, stop: 48 },
        { ticker: "BBB", shares: 50, entry: 80, stop: 76 },
      ],
    });
    // AAA: 2/sh * 100 = 200; BBB: 4/sh * 50 = 200
    expect(out.totalRisk).toBe(400);
    expect(out.totalRiskPct).toBeCloseTo(4);
    expect(out.maxHeat).toBe(600);
    expect(out.remaining).toBe(200);
    expect(out.breached).toBe(false);
    expect(out.unquantifiedCount).toBe(0);
  });

  it("uses live price as the open-risk basis when provided", () => {
    const out = portfolioHeat({
      accountSize: 10000,
      maxHeatPct: 6,
      positions: [
        { ticker: "AAA", shares: 100, entry: 50, stop: 48, price: 55 },
      ],
    });
    // risk from price 55 down to stop 48 = 7/sh * 100
    expect(out.totalRisk).toBe(700);
  });

  it("clamps risk to zero when a long's stop is locked in above price", () => {
    const out = portfolioHeat({
      accountSize: 10000,
      maxHeatPct: 6,
      positions: [
        {
          ticker: "AAA",
          shares: 100,
          entry: 50,
          stop: 52,
          price: 51,
          direction: "long",
        },
      ],
    });
    expect(out.totalRisk).toBe(0);
    expect(out.positions[0]!.riskAmount).toBe(0);
    expect(out.positions[0]!.direction).toBe("long");
  });

  it("computes open risk for a short position", () => {
    const out = portfolioHeat({
      accountSize: 10000,
      maxHeatPct: 6,
      positions: [
        { ticker: "AAA", shares: 100, entry: 50, stop: 54, price: 50 },
      ],
    });
    // short: stop 54 - price 50 = 4/sh * 100
    expect(out.totalRisk).toBe(400);
    expect(out.positions[0]!.direction).toBe("short");
  });

  it("respects an explicit direction for a long with a trailed stop", () => {
    // Long position whose stop has trailed above entry: still long, and
    // open risk is price down to stop — not the inferred "short" reading.
    const out = portfolioHeat({
      accountSize: 10000,
      maxHeatPct: 6,
      positions: [
        {
          ticker: "AAA",
          shares: 100,
          entry: 50,
          stop: 52,
          price: 55,
          direction: "long",
        },
      ],
    });
    expect(out.positions[0]!.direction).toBe("long");
    expect(out.totalRisk).toBe(300); // (55 - 52) * 100
  });

  it("flags positions with no stop on file as unquantified", () => {
    const out = portfolioHeat({
      accountSize: 10000,
      maxHeatPct: 6,
      positions: [
        { ticker: "AAA", shares: 100, entry: 50, stop: 48 },
        { ticker: "BBB", shares: 50, entry: 80, stop: null },
      ],
    });
    expect(out.unquantifiedCount).toBe(1);
    expect(out.totalRisk).toBe(200);
    const bbb = out.positions[1]!;
    expect(bbb.hasStop).toBe(false);
    expect(bbb.riskAmount).toBeNull();
    expect(bbb.riskPct).toBeNull();
  });

  it("breaches when total risk reaches the ceiling", () => {
    const out = portfolioHeat({
      accountSize: 10000,
      maxHeatPct: 6,
      positions: [
        { ticker: "AAA", shares: 300, entry: 50, stop: 48 },
      ],
    });
    // 2/sh * 300 = 600 = ceiling
    expect(out.totalRisk).toBe(600);
    expect(out.breached).toBe(true);
    expect(out.remaining).toBe(0);
  });

  it("handles an empty portfolio", () => {
    const out = portfolioHeat({
      accountSize: 10000,
      maxHeatPct: 6,
      positions: [],
    });
    expect(out.totalRisk).toBe(0);
    expect(out.breached).toBe(false);
    expect(out.remaining).toBe(600);
    expect(out.unquantifiedCount).toBe(0);
  });

  it("throws when a position's stop equals its entry", () => {
    expect(() =>
      portfolioHeat({
        accountSize: 10000,
        maxHeatPct: 6,
        positions: [{ ticker: "AAA", shares: 100, entry: 50, stop: 50 }],
      }),
    ).toThrow(RiskError);
  });

  it("throws on max heat >= 100%", () => {
    expect(() =>
      portfolioHeat({ accountSize: 10000, maxHeatPct: 100, positions: [] }),
    ).toThrow(RiskError);
  });
});
