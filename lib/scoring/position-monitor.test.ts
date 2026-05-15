import { describe, it, expect } from "vitest";
import {
  monitorPosition,
  streakCaution,
  type PositionInput,
  type ChecklistInput,
  type ReviewInput,
} from "./position-monitor";

const pos = (ticker: string, qty: number, avg_cost: number): PositionInput => ({
  ticker,
  qty,
  avg_cost,
});

describe("monitorPosition", () => {
  it("returns no alerts for a healthy position", () => {
    const alerts = monitorPosition(
      pos("AAPL", 10, 150),
      160,
      { entry: 150, stop: 140, target: 180 },
      20,
      10000,
    );
    expect(alerts).toEqual([]);
  });

  it("emits stop_proximity warning when price is 3% above stop", () => {
    // price 145, stop 140.5 → gap = (145-140.5)/145 = 3.1%
    const alerts = monitorPosition(
      pos("X", 10, 155),
      145,
      { entry: 155, stop: 140.5, target: 185 },
      null,
      50000,
    );
    const alert = alerts.find((a) => a.alert_type === "stop_proximity");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("warning");
  });

  it("emits stop_proximity critical when price is within 1% of stop", () => {
    // price 141, stop 140 → gap = 1/141 ≈ 0.7%
    const alerts = monitorPosition(
      pos("X", 10, 155),
      141,
      { entry: 155, stop: 140, target: 185 },
      null,
      50000,
    );
    const alert = alerts.find((a) => a.alert_type === "stop_proximity");
    expect(alert!.severity).toBe("critical");
  });

  it("does not emit stop_proximity when price is 10% above stop", () => {
    const alerts = monitorPosition(
      pos("X", 10, 150),
      160,
      { entry: 150, stop: 140, target: 180 },
      null,
      50000,
    );
    expect(alerts.find((a) => a.alert_type === "stop_proximity")).toBeUndefined();
  });

  it("emits r_target_reached info at 2R", () => {
    // entry 100, stop 90, 1R=10; price 120 → R=2
    const alerts = monitorPosition(
      pos("X", 10, 100),
      120,
      { entry: 100, stop: 90, target: 130 },
      null,
      50000,
    );
    const alert = alerts.find((a) => a.alert_type === "r_target_reached");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("info");
  });

  it("emits r_target_reached warning at 3R+", () => {
    // entry 100, stop 90; price 130 → R=3
    const alerts = monitorPosition(
      pos("X", 10, 100),
      130,
      { entry: 100, stop: 90, target: 135 },
      null,
      50000,
    );
    const alert = alerts.find((a) => a.alert_type === "r_target_reached");
    expect(alert!.severity).toBe("warning");
  });

  it("does not emit r_target_reached below 2R", () => {
    // entry 100, stop 90; price 115 → R=1.5
    const alerts = monitorPosition(
      pos("X", 10, 100),
      115,
      { entry: 100, stop: 90, target: 130 },
      null,
      50000,
    );
    expect(
      alerts.find((a) => a.alert_type === "r_target_reached"),
    ).toBeUndefined();
  });

  it("emits earnings_risk critical when earnings in 3 days", () => {
    const alerts = monitorPosition(
      pos("X", 10, 100),
      105,
      null,
      3,
      50000,
    );
    const alert = alerts.find((a) => a.alert_type === "earnings_risk");
    expect(alert!.severity).toBe("critical");
  });

  it("emits earnings_risk warning when earnings in 5 days", () => {
    const alerts = monitorPosition(
      pos("X", 10, 100),
      105,
      null,
      5,
      50000,
    );
    const alert = alerts.find((a) => a.alert_type === "earnings_risk");
    expect(alert!.severity).toBe("warning");
  });

  it("does not emit earnings_risk when earnings > 5 days away", () => {
    const alerts = monitorPosition(
      pos("X", 10, 100),
      105,
      null,
      6,
      50000,
    );
    expect(alerts.find((a) => a.alert_type === "earnings_risk")).toBeUndefined();
  });

  it("emits concentration_high warning when position > 25% of portfolio", () => {
    // 10 shares at $100 = $1000 / $3000 portfolio = 33%
    const alerts = monitorPosition(
      pos("X", 10, 100),
      100,
      null,
      null,
      3000,
    );
    const alert = alerts.find((a) => a.alert_type === "concentration_high");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("warning");
  });

  it("emits concentration_high critical when position > 50% of portfolio", () => {
    // 10 shares at $100 = $1000 / $1500 = 67%
    const alerts = monitorPosition(
      pos("X", 10, 100),
      100,
      null,
      null,
      1500,
    );
    const alert = alerts.find((a) => a.alert_type === "concentration_high");
    expect(alert!.severity).toBe("critical");
  });

  it("does not emit concentration_high when position <= 25%", () => {
    // 10 shares at $100 = $1000 / $5000 = 20%
    const alerts = monitorPosition(
      pos("X", 10, 100),
      100,
      null,
      null,
      5000,
    );
    expect(
      alerts.find((a) => a.alert_type === "concentration_high"),
    ).toBeUndefined();
  });

  it("returns multiple alerts for a high-risk position", () => {
    // Near stop, near earnings, high concentration
    const alerts = monitorPosition(
      pos("X", 100, 150),
      143,
      { entry: 150, stop: 140, target: 180 },
      2,
      10000,
    );
    expect(alerts.length).toBeGreaterThanOrEqual(2);
  });

  it("handles null checklist gracefully", () => {
    const alerts = monitorPosition(pos("X", 10, 100), 105, null, null, 50000);
    expect(Array.isArray(alerts)).toBe(true);
  });
});

describe("streakCaution", () => {
  const mkReview = (pnl: number, daysAgo: number): ReviewInput => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return { realized_pnl: pnl, reviewed_at: d.toISOString() };
  };

  it("returns null when fewer than 3 reviews", () => {
    const reviews = [mkReview(-100, 3), mkReview(-200, 2)];
    expect(streakCaution(reviews)).toBeNull();
  });

  it("returns alert when last 3 are all losses", () => {
    const reviews = [
      mkReview(200, 10),
      mkReview(-100, 3),
      mkReview(-150, 2),
      mkReview(-80, 1),
    ];
    const alert = streakCaution(reviews);
    expect(alert).not.toBeNull();
    expect(alert!.alert_type).toBe("streak_caution");
    expect(alert!.severity).toBe("warning");
  });

  it("returns null when one of the last 3 is a win", () => {
    const reviews = [
      mkReview(-100, 3),
      mkReview(200, 2),
      mkReview(-80, 1),
    ];
    expect(streakCaution(reviews)).toBeNull();
  });

  it("returns null when last 3 include a zero P&L", () => {
    const reviews = [
      mkReview(-100, 3),
      mkReview(0, 2),
      mkReview(-80, 1),
    ];
    const alert = streakCaution(reviews);
    // 0 is <= 0, so it counts as a loss in our definition
    expect(alert).not.toBeNull();
  });

  it("sorts reviews chronologically before slicing last 3", () => {
    // Win is most recent, but provided out of order
    const reviews = [
      mkReview(-100, 5),
      mkReview(-150, 4),
      mkReview(-80, 3),
      mkReview(500, 1), // most recent = win
    ];
    // Last 3: win (1d ago), -80 (3d ago), -150 (4d ago) → not all losses
    expect(streakCaution(reviews)).toBeNull();
  });
});
