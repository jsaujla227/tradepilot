import { formatMoney, formatPct } from "@/lib/format";
import { PERF_THRESHOLDS, type UnlockCriteria } from "@/lib/performance";
import { UnlockLiveButton } from "./unlock-live-button";

function Criterion({
  label,
  met,
  current,
  threshold,
}: {
  label: string;
  met: boolean;
  current: string;
  threshold: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-mono ${met ? "text-green-400" : "text-zinc-600"}`}
          aria-label={met ? "met" : "not met"}
        >
          {met ? "✓" : "○"}
        </span>
        <span className="text-foreground/80">{label}</span>
      </div>
      <div className="text-right">
        <span
          className={`tabular-nums font-mono ${
            met ? "text-green-400" : "text-foreground/60"
          }`}
        >
          {current}
        </span>
        <span className="ml-2 text-xs text-muted-foreground">
          (need {threshold})
        </span>
      </div>
    </div>
  );
}

export function PerformanceScorecard({
  criteria,
  realMoneyUnlocked,
}: {
  criteria: UnlockCriteria;
  realMoneyUnlocked: boolean;
}) {
  const { stats, minReviewedMet, winRateMet, expectancyMet, maxDrawdownMet, allMet } =
    criteria;

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
        Paper-trading performance
      </p>
      <div className="rounded-lg border border-border/60 bg-background/30 px-4 divide-y divide-border/40">
        <Criterion
          label="Reviewed trades"
          met={minReviewedMet}
          current={String(stats.totalReviewed)}
          threshold={`≥ ${PERF_THRESHOLDS.minReviewed}`}
        />
        <Criterion
          label="Win rate"
          met={winRateMet}
          current={stats.winRate != null ? formatPct(stats.winRate, 0) : "—"}
          threshold={`≥ ${PERF_THRESHOLDS.winRatePct}%`}
        />
        <Criterion
          label="Expectancy per trade"
          met={expectancyMet}
          current={
            stats.expectancy != null ? formatMoney(stats.expectancy) : "—"
          }
          threshold="> $0"
        />
        <Criterion
          label="Max drawdown"
          met={maxDrawdownMet}
          current={
            stats.maxDrawdownPct != null
              ? formatPct(stats.maxDrawdownPct, 1)
              : "0.0%"
          }
          threshold={`< ${PERF_THRESHOLDS.maxDrawdownPct}%`}
        />
      </div>
      {realMoneyUnlocked ? (
        <p className="text-xs font-medium text-emerald-400">
          Live trading is unlocked. Switch mode in the Broker section above.
        </p>
      ) : allMet ? (
        <div className="space-y-2">
          <p className="text-xs text-emerald-400">
            All criteria met. You may unlock live trading.
          </p>
          <UnlockLiveButton />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Complete all criteria on paper before switching to live. Why? Consistent
          paper results reduce the chance of real-money losses from process errors.
        </p>
      )}
    </div>
  );
}
