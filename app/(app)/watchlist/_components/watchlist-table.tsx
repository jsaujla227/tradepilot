import { type WatchlistScore } from "@/lib/scoring";
import { formatMoney, formatNumber } from "@/lib/format";
import { removeWatchlistItem } from "../actions";
import { ExplainButton } from "@/components/ai/explain-button";

export type ScoredWatchlistItem = {
  id: string;
  ticker: string;
  sector: string | null;
  target_entry: number | null;
  target_stop: number | null;
  target_price: number | null;
  reason: string | null;
  notes: string | null;
  added_at: string;
  price: number | null;
  score: WatchlistScore | null;
};

function ScoreBadge({ total }: { total: number }) {
  const color =
    total >= 65
      ? "bg-green-500/15 text-green-400"
      : total >= 40
        ? "bg-yellow-500/15 text-yellow-400"
        : "bg-red-500/15 text-red-400";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${color}`}>
      {formatNumber(total, 1)}
    </span>
  );
}

function InputRow({
  label,
  rawLabel,
  value,
  dataAvailable,
  why,
}: {
  label: string;
  rawLabel: string;
  value: number;
  dataAvailable: boolean;
  why: string;
}) {
  const barWidth = `${Math.round(value * 100)}%`;
  return (
    <details className="group">
      <summary className="flex cursor-pointer items-center gap-2 py-0.5 list-none [&::-webkit-details-marker]:hidden">
        <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{label}</span>
        <div className="flex-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
          <div
            className={`h-full rounded-full ${dataAvailable ? "bg-foreground/50" : "bg-foreground/20"}`}
            style={{ width: barWidth }}
          />
        </div>
        <span className="w-28 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {rawLabel}
        </span>
        <span className="text-[10px] text-muted-foreground/50 group-open:rotate-180 transition-transform">
          ▾
        </span>
      </summary>
      <p className="mt-1 ml-22 text-[11px] text-muted-foreground leading-relaxed pl-[5.5rem]">
        {why}
      </p>
    </details>
  );
}

export function WatchlistTable({ items }: { items: ScoredWatchlistItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No tickers yet. Add one above.
      </p>
    );
  }

  return (
    <section className="space-y-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-lg border border-border bg-card/50 p-4 space-y-3"
        >
          {/* Header row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-mono font-semibold text-base">{item.ticker}</span>
              {item.sector && (
                <span className="rounded px-1.5 py-0.5 text-[10px] bg-foreground/8 text-muted-foreground">
                  {item.sector}
                </span>
              )}
              {item.price != null && (
                <span className="text-sm tabular-nums text-muted-foreground">
                  {formatMoney(item.price)}
                </span>
              )}
              {/* Near-entry alert: price within 2% of target entry */}
              {item.price != null &&
                item.target_entry != null &&
                Math.abs(item.price - item.target_entry) / item.target_entry <= 0.02 && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/20 text-yellow-400 uppercase tracking-wide">
                    Near entry
                  </span>
                )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {item.score ? (
                <ScoreBadge total={item.score.total} />
              ) : (
                <span className="text-[11px] text-muted-foreground">no quote</span>
              )}
              <form action={removeWatchlistItem.bind(null, item.id)}>
                <button
                  type="submit"
                  className="text-xs text-muted-foreground hover:text-destructive transition"
                  aria-label={`Remove ${item.ticker}`}
                >
                  Remove
                </button>
              </form>
            </div>
          </div>

          {/* Setup prices */}
          {(item.target_entry != null ||
            item.target_stop != null ||
            item.target_price != null) && (
            <div className="flex gap-4 text-xs text-muted-foreground tabular-nums">
              {item.target_entry != null && (
                <span>Entry: {formatMoney(item.target_entry)}</span>
              )}
              {item.target_stop != null && (
                <span>Stop: {formatMoney(item.target_stop)}</span>
              )}
              {item.target_price != null && (
                <span>Target: {formatMoney(item.target_price)}</span>
              )}
            </div>
          )}

          {/* Score inputs with Why? expansion */}
          {item.score && (
            <div className="space-y-0.5 rounded-md border border-border/50 bg-background/30 px-3 py-2">
              <InputRow {...item.score.trend} />
              <InputRow {...item.score.volatility} />
              <InputRow {...item.score.rMultiple} />
              <InputRow {...item.score.liquidity} />
              <InputRow {...item.score.eventRisk} />
              <div className="pt-1 border-t border-border/30 mt-1">
                <ExplainButton
                  label="Assess this setup"
                  mode="assess"
                  prompt={`Produce a structured assessment for ${item.ticker} using the score data provided. Confidence should reflect the score components together — be conservative when key inputs (R-multiple, event risk) are missing.`}
                  dataProvided={{
                    ticker: item.ticker,
                    sector: item.sector,
                    price: item.price,
                    targetEntry: item.target_entry,
                    targetStop: item.target_stop,
                    targetPrice: item.target_price,
                    reason: item.reason,
                    score: {
                      total: item.score.total,
                      trend: item.score.trend,
                      volatility: item.score.volatility,
                      rMultiple: item.score.rMultiple,
                      liquidity: item.score.liquidity,
                      eventRisk: item.score.eventRisk,
                    },
                  }}
                />
              </div>
            </div>
          )}

          {/* Reason / notes */}
          {(item.reason || item.notes) && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {item.reason && <p>{item.reason}</p>}
              {item.notes && <p className="opacity-70">{item.notes}</p>}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
