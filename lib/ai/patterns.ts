// Pure pattern-extraction engine. No I/O, no side effects.
// Groups the user's closed trades by sector + direction + R-tier,
// then classifies each group as winning, losing, or neutral.

export type TradeReviewRow = {
  ticker: string;
  realized_pnl: number;
  r_realized: number | null;
  reviewed_at: string;
};

export type TradeChecklistRow = {
  ticker: string;
  side: "buy" | "sell";
  r_at_entry: number | null;
};

export type TickerMetaRow = {
  ticker: string;
  sector: string | null;
};

export type RTier = "<2" | "2-3" | ">3";

export type TradePattern = {
  pattern_type: "winning" | "losing" | "neutral";
  description: string;
  conditions: {
    sector?: string;
    direction?: "long" | "short";
    r_tier?: RTier;
  };
  stats: {
    win_rate: number;
    avg_r: number;
    expectancy: number;
    sample_count: number;
  };
};

function toRTier(r: number | null): RTier | undefined {
  if (r == null || !Number.isFinite(r)) return undefined;
  if (r < 2) return "<2";
  if (r <= 3) return "2-3";
  return ">3";
}

type EnrichedTrade = {
  sector: string | undefined;
  direction: "long" | "short" | undefined;
  r_tier: RTier | undefined;
  win: boolean;
  r_realized: number;
};

/**
 * Extracts personal trading patterns from a user's trade history.
 * Groups trades by (sector, direction, R-tier). Only produces a pattern
 * when a group has ≥ 3 samples.
 *
 * Winning: win_rate > 0.55 AND expectancy > 0
 * Losing:  win_rate < 0.45 OR expectancy < 0
 * Neutral: everything else
 */
export function extractPatterns(
  reviews: TradeReviewRow[],
  checklists: TradeChecklistRow[],
  tickerMeta: TickerMetaRow[],
): TradePattern[] {
  // Last checklist wins when multiple exist for same ticker
  const checklistByTicker = new Map<string, TradeChecklistRow>();
  for (const c of checklists) {
    checklistByTicker.set(c.ticker, c);
  }

  const sectorByTicker = new Map<string, string>();
  for (const m of tickerMeta) {
    if (m.sector) sectorByTicker.set(m.ticker, m.sector);
  }

  const enriched: EnrichedTrade[] = reviews.map((r) => {
    const c = checklistByTicker.get(r.ticker);
    const sector = sectorByTicker.get(r.ticker);
    const direction =
      c?.side === "buy" ? "long" : c?.side === "sell" ? "short" : undefined;
    return {
      sector,
      direction,
      r_tier: toRTier(c?.r_at_entry ?? null),
      win: (r.realized_pnl ?? 0) > 0,
      r_realized: r.r_realized ?? 0,
    };
  });

  // Group key: sector|direction|r_tier
  const groups = new Map<string, EnrichedTrade[]>();
  for (const trade of enriched) {
    const key = [
      trade.sector ?? "unknown",
      trade.direction ?? "unknown",
      trade.r_tier ?? "unknown",
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(trade);
  }

  const patterns: TradePattern[] = [];

  for (const [key, trades] of groups) {
    if (trades.length < 3) continue;

    const [sectorPart, dirPart, rTierPart] = key.split("|");

    const wins = trades.filter((t) => t.win);
    const losses = trades.filter((t) => !t.win);
    const win_rate = wins.length / trades.length;
    const avg_r =
      trades.reduce((s, t) => s + t.r_realized, 0) / trades.length;
    const avg_win_r = wins.length
      ? wins.reduce((s, t) => s + t.r_realized, 0) / wins.length
      : 0;
    const avg_loss_r = losses.length
      ? Math.abs(
          losses.reduce((s, t) => s + t.r_realized, 0) / losses.length,
        )
      : 0;
    const expectancy =
      win_rate * avg_win_r - (1 - win_rate) * avg_loss_r;

    const sector =
      sectorPart !== "unknown" ? sectorPart : undefined;
    const direction =
      dirPart === "long" || dirPart === "short" ? dirPart : undefined;
    const r_tier =
      rTierPart === "<2" || rTierPart === "2-3" || rTierPart === ">3"
        ? (rTierPart as RTier)
        : undefined;

    const descParts = [
      sector,
      direction ? `${direction} setup` : undefined,
      r_tier ? `R target ${r_tier}` : undefined,
    ].filter(Boolean);
    const description =
      descParts.length > 0 ? descParts.join(", ") : "Mixed setups";

    const pattern_type: "winning" | "losing" | "neutral" =
      win_rate > 0.55 && expectancy > 0
        ? "winning"
        : win_rate < 0.45 || expectancy < 0
          ? "losing"
          : "neutral";

    const conditions: TradePattern["conditions"] = {};
    if (sector) conditions.sector = sector;
    if (direction) conditions.direction = direction;
    if (r_tier) conditions.r_tier = r_tier;

    patterns.push({
      pattern_type,
      description,
      conditions,
      stats: { win_rate, avg_r, expectancy, sample_count: trades.length },
    });
  }

  return patterns;
}
