import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PaperStats = {
  totalReviewed: number;
  winRate: number | null;
  expectancy: number | null;
  maxDrawdownPct: number | null;
};

export const PERF_THRESHOLDS = {
  minReviewed: 10,
  winRatePct: 40,
  expectancyMin: 0,
  maxDrawdownPct: 15,
} as const;

export type UnlockCriteria = {
  minReviewedMet: boolean;
  winRateMet: boolean;
  expectancyMet: boolean;
  maxDrawdownMet: boolean;
  allMet: boolean;
  stats: PaperStats;
};

export async function getPaperTradingCriteria(
  accountSize: number,
): Promise<UnlockCriteria> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return emptyResult();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return emptyResult();

  const [{ data: reviews }, { data: snapshots }] = await Promise.all([
    supabase
      .from("trade_reviews")
      .select("realized_pnl")
      .eq("user_id", user.id),
    supabase
      .from("portfolio_snapshots")
      .select("snapshot_date, total_value")
      .eq("user_id", user.id)
      .order("snapshot_date", { ascending: true }),
  ]);

  const pnls = (reviews ?? []).map((r) => Number(r.realized_pnl ?? 0));
  const totalReviewed = pnls.length;
  const wins = pnls.filter((v) => v > 0);
  const losses = pnls.filter((v) => v <= 0);

  const winRate =
    totalReviewed > 0 ? (wins.length / totalReviewed) * 100 : null;
  const avgWin =
    wins.length > 0
      ? wins.reduce((s, v) => s + v, 0) / wins.length
      : null;
  const avgLoss =
    losses.length > 0
      ? Math.abs(losses.reduce((s, v) => s + v, 0) / losses.length)
      : null;
  const expectancy =
    winRate != null && avgWin != null && avgLoss != null
      ? (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss
      : null;

  let maxDrawdownPct = 0;
  if (snapshots && snapshots.length > 0) {
    let peak = accountSize;
    for (const s of snapshots) {
      const val = Number(s.total_value);
      if (val > peak) peak = val;
      const dd = peak > 0 ? ((peak - val) / peak) * 100 : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  const minReviewedMet = totalReviewed >= PERF_THRESHOLDS.minReviewed;
  const winRateMet = winRate != null && winRate >= PERF_THRESHOLDS.winRatePct;
  const expectancyMet =
    expectancy != null && expectancy > PERF_THRESHOLDS.expectancyMin;
  const maxDrawdownMet = maxDrawdownPct < PERF_THRESHOLDS.maxDrawdownPct;

  return {
    minReviewedMet,
    winRateMet,
    expectancyMet,
    maxDrawdownMet,
    allMet: minReviewedMet && winRateMet && expectancyMet && maxDrawdownMet,
    stats: { totalReviewed, winRate, expectancy, maxDrawdownPct },
  };
}

function emptyResult(): UnlockCriteria {
  return {
    minReviewedMet: false,
    winRateMet: false,
    expectancyMet: false,
    maxDrawdownMet: false,
    allMet: false,
    stats: {
      totalReviewed: 0,
      winRate: null,
      expectancy: null,
      maxDrawdownPct: null,
    },
  };
}
