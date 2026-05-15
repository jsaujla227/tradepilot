// Pure position health monitor. No I/O, no side effects.
// Generates human-readable alerts for open positions based on
// stop proximity, R achieved, earnings risk, and concentration.

export type AlertType =
  | "stop_proximity"
  | "r_target_reached"
  | "earnings_risk"
  | "concentration_high"
  | "streak_caution";

export type AlertSeverity = "info" | "warning" | "critical";

export type PositionAlert = {
  ticker: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  message: string;
  why: string;
  suggested_review: string;
};

export type PositionInput = {
  ticker: string;
  qty: number;
  avg_cost: number;
};

export type ChecklistInput = {
  entry: number | null;
  stop: number | null;
  target: number | null;
};

export type ReviewInput = {
  realized_pnl: number;
  reviewed_at: string;
};

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Returns all active health alerts for one open position.
 *
 * @param position  Current holding (ticker, qty, avg_cost)
 * @param price     Latest quote price
 * @param checklist Pre-trade checklist entry (entry / stop / target); may be null
 * @param daysToEarnings  Days until next earnings; null = none scheduled
 * @param portfolioValue  Total portfolio market value (for concentration check)
 */
export function monitorPosition(
  position: PositionInput,
  price: number,
  checklist: ChecklistInput | null,
  daysToEarnings: number | null,
  portfolioValue: number,
): PositionAlert[] {
  const alerts: PositionAlert[] = [];
  const { ticker, qty, avg_cost } = position;

  // -- Stop proximity (long only: stop below avg_cost) ----------------------
  const stop = checklist?.stop;
  if (stop != null && stop > 0 && avg_cost > stop && price > 0) {
    const gapPct = (price - stop) / price;
    if (gapPct <= 0.05) {
      alerts.push({
        ticker,
        alert_type: "stop_proximity",
        severity: gapPct <= 0.02 ? "critical" : "warning",
        message: `${ticker} is ${(gapPct * 100).toFixed(1)}% above your stop. Review whether the stop still applies.`,
        why: `Price ${fmt(price)}, stop ${fmt(stop)}, gap = (${fmt(price)} − ${fmt(stop)}) / ${fmt(price)} = ${(gapPct * 100).toFixed(1)}%. Threshold: 5%.`,
        suggested_review:
          "Review whether the original stop reflects the current thesis. A close below stop invalidates the setup.",
      });
    }
  }

  // -- R-target reached (long only) -----------------------------------------
  const entry = checklist?.entry;
  if (
    entry != null &&
    stop != null &&
    entry > 0 &&
    stop > 0 &&
    entry !== stop &&
    stop < entry
  ) {
    const oneR = entry - stop;
    const unrealizedR = (price - entry) / oneR;
    if (unrealizedR >= 2.0) {
      alerts.push({
        ticker,
        alert_type: "r_target_reached",
        severity: unrealizedR >= 3.0 ? "warning" : "info",
        message: `${ticker} is up ${unrealizedR.toFixed(1)}R. Worth monitoring your target exit level.`,
        why: `Unrealized R = (${fmt(price)} − ${fmt(entry)}) / ${fmt(oneR)} = ${unrealizedR.toFixed(2)}R. 1R = ${fmt(oneR)} per share.`,
        suggested_review:
          "Consider whether to hold for your original target, take partial profit, or trail the stop to protect gains.",
      });
    }
  }

  // -- Earnings risk --------------------------------------------------------
  if (daysToEarnings != null && daysToEarnings <= 5) {
    alerts.push({
      ticker,
      alert_type: "earnings_risk",
      severity: daysToEarnings <= 3 ? "critical" : "warning",
      message: `${ticker} reports in ${daysToEarnings} day${daysToEarnings === 1 ? "" : "s"}. High risk of overnight gap past your stop.`,
      why: `Earnings in ${daysToEarnings}d. A surprise move can open the next session beyond your stop, creating slippage past planned 1R.`,
      suggested_review:
        "Review whether to exit before earnings, reduce size, or hold knowing the stop may not protect against a gap.",
    });
  }

  // -- High concentration ---------------------------------------------------
  if (portfolioValue > 0 && qty > 0 && price > 0) {
    const positionValue = qty * price;
    const pct = (positionValue / portfolioValue) * 100;
    if (pct > 25) {
      alerts.push({
        ticker,
        alert_type: "concentration_high",
        severity: pct > 50 ? "critical" : "warning",
        message: `${ticker} is ${pct.toFixed(1)}% of your portfolio. High single-name concentration.`,
        why: `Position value ${fmt(positionValue)} / portfolio ${fmt(portfolioValue)} = ${pct.toFixed(1)}%. Threshold: 25%.`,
        suggested_review: `A 10% adverse move in ${ticker} changes your portfolio by ${fmt(positionValue * 0.1)}. Review whether this concentration matches your risk tolerance.`,
      });
    }
  }

  return alerts;
}

/**
 * Returns a streak-caution alert if the user's last 3 closed trades were
 * all losses, suggesting reduced position size on the next trade.
 * Reviews should be provided in any order; this function sorts them.
 */
export function streakCaution(reviews: ReviewInput[]): PositionAlert | null {
  const sorted = [...reviews]
    .sort(
      (a, b) =>
        new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime(),
    )
    .slice(0, 3);

  if (sorted.length < 3) return null;
  if (!sorted.every((r) => (r.realized_pnl ?? 0) <= 0)) return null;

  return {
    ticker: "PORTFOLIO",
    alert_type: "streak_caution",
    severity: "warning",
    message:
      "Your last 3 closed trades were losses. Review position size on your next trade.",
    why: `Last 3 realized P&L: ${sorted.map((r) => fmt(r.realized_pnl)).join(", ")}. Three consecutive losses may signal reduced edge or adverse conditions.`,
    suggested_review:
      "Consider reducing position size on the next trade until you identify what changed in recent conditions.",
  };
}
