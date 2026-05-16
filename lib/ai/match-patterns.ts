// Pure pattern-matching. No I/O, no side effects.
// Finds which of a user's learned_patterns match a new trade setup.

import type { TradePattern, RTier } from "./patterns";

export type PatternMatch = {
  pattern: TradePattern;
  match_reason: string;
};

export type SetupInput = {
  sector?: string;
  direction: "long" | "short";
  r_at_entry: number;
};

function toRTier(r: number): RTier {
  if (r < 2) return "<2";
  if (r <= 3) return "2-3";
  return ">3";
}

/**
 * Returns patterns that match the given setup, sorted by pattern_type
 * (winning first, then neutral, then losing) and sample_count descending.
 *
 * A pattern matches only when every condition it defines matches the setup,
 * and it defines at least one condition — fully unconstrained patterns are
 * skipped rather than treated as catch-alls.
 */
export function matchPatterns(
  patterns: TradePattern[],
  setup: SetupInput,
): PatternMatch[] {
  const setupRTier = toRTier(setup.r_at_entry);
  const matches: PatternMatch[] = [];

  for (const pattern of patterns) {
    const reasons: string[] = [];

    if (pattern.conditions.sector != null) {
      if (pattern.conditions.sector !== setup.sector) continue;
      reasons.push(`Same sector (${setup.sector})`);
    }

    if (pattern.conditions.direction != null) {
      if (pattern.conditions.direction !== setup.direction) continue;
      reasons.push(`${setup.direction} setup`);
    }

    if (pattern.conditions.r_tier != null) {
      if (pattern.conditions.r_tier !== setupRTier) continue;
      reasons.push(
        `R ${setup.r_at_entry.toFixed(1)} fits your ${setupRTier} R tier`,
      );
    }

    // Must match at least one named condition (skip unconstrained catch-alls)
    if (reasons.length === 0) continue;

    matches.push({ pattern, match_reason: reasons.join(" + ") });
  }

  return matches.sort((a, b) => {
    const order = { winning: 0, neutral: 1, losing: 2 } as const;
    const diff =
      order[a.pattern.pattern_type] - order[b.pattern.pattern_type];
    if (diff !== 0) return diff;
    return b.pattern.stats.sample_count - a.pattern.stats.sample_count;
  });
}
