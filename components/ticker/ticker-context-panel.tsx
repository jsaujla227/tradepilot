"use client";

import { useEffect, useState, useTransition } from "react";
import { fetchTickerInsight } from "./actions";
import type { TickerInsight } from "@/lib/ticker-insight";
import { TICKER_REGEX } from "@/lib/ticker";

type Props = {
  /** Raw ticker the user is typing; case-insensitive. */
  ticker: string;
  /** Proposed position notional (entry × qty) — used for sector projection. */
  proposedNotional: number | null;
};

const FETCH_DEBOUNCE_MS = 350;

export function TickerContextPanel({ ticker, proposedNotional }: Props) {
  const [insight, setInsight] = useState<TickerInsight | null>(null);
  const [pending, startTransition] = useTransition();
  const [lastTicker, setLastTicker] = useState<string | null>(null);

  // Re-fetch insight whenever ticker or notional changes. We debounce on
  // ticker keystrokes so we don't blow the Finnhub rate budget; notional
  // changes are cheap (no new Finnhub call — sector exposure only).
  useEffect(() => {
    const trimmed = ticker.trim().toUpperCase();
    if (!trimmed || !TICKER_REGEX.test(trimmed)) {
      setInsight(null);
      setLastTicker(null);
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => {
        const result = await fetchTickerInsight(trimmed, proposedNotional);
        setInsight(result);
        setLastTicker(trimmed);
      });
    }, FETCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [ticker, proposedNotional]);

  const trimmed = ticker.trim().toUpperCase();
  if (!trimmed || !TICKER_REGEX.test(trimmed)) return null;

  if (pending && !insight) {
    return (
      <div className="rounded-md border border-border/50 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
        Loading context for <span className="font-mono">{trimmed}</span>…
      </div>
    );
  }

  if (!insight || insight.ticker !== lastTicker) return null;

  const { context, sectorExposure } = insight;
  const earnings = context.earnings;
  const news = context.news;
  const rec = context.recommendation;

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-card/40 p-3 text-xs">
      <div className="flex items-center justify-between">
        <p className="font-medium uppercase tracking-wide text-muted-foreground">
          Ticker context · {insight.ticker}
        </p>
        {pending && (
          <span className="text-[10px] text-muted-foreground/60">refreshing…</span>
        )}
      </div>

      {/* Earnings */}
      {earnings && earnings.daysUntil != null && (
        <EarningsBanner days={earnings.daysUntil} date={earnings.nextEarningsDate} />
      )}
      {earnings && earnings.daysUntil == null && (
        <p className="text-[11px] text-muted-foreground">
          No earnings scheduled within the next 30 days.
        </p>
      )}
      {!earnings && (
        <p className="text-[11px] text-muted-foreground/70">
          Earnings calendar unavailable for this ticker.
        </p>
      )}

      {/* Sector exposure */}
      {sectorExposure && (
        <SectorExposureRow exposure={sectorExposure} />
      )}

      {/* Analyst breakdown */}
      {rec && <RecommendationBar rec={rec} />}

      {/* News */}
      {news && news.length > 0 && (
        <div className="space-y-1 pt-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Recent headlines
          </p>
          <ul className="space-y-0.5">
            {news.map((n, i) => (
              <li key={`${n.url}-${i}`} className="flex items-baseline gap-2">
                <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
                  {formatDate(n.datetime)}
                </span>
                <a
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground/80 hover:text-foreground underline-offset-2 hover:underline truncate"
                  title={n.headline}
                >
                  {n.headline}
                </a>
                <span className="text-[10px] text-muted-foreground/50 shrink-0">
                  {n.source}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {news && news.length === 0 && (
        <p className="text-[11px] text-muted-foreground/70">
          No company news in the last 3 days.
        </p>
      )}
    </div>
  );
}

function EarningsBanner({ days, date }: { days: number; date: string | null }) {
  if (days <= 3) {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-red-300">
        <p className="font-medium">
          Earnings in {days} day{days === 1 ? "" : "s"}
          {date ? ` (${date})` : ""} — overnight gap risk
        </p>
        <p className="text-[11px] text-red-300/80">
          A miss can open past your stop. Review position size or wait until
          after the print.
        </p>
      </div>
    );
  }
  if (days <= 7) {
    return (
      <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-1.5 text-yellow-300">
        <p className="font-medium">
          Earnings in {days} days{date ? ` (${date})` : ""} — caution window
        </p>
        <p className="text-[11px] text-yellow-300/80">
          Volatility usually rises into the print. Consider a smaller size.
        </p>
      </div>
    );
  }
  return (
    <p className="text-[11px] text-muted-foreground">
      Next earnings in {days} days{date ? ` (${date})` : ""}.
    </p>
  );
}

function SectorExposureRow({
  exposure,
}: {
  exposure: NonNullable<TickerInsight["sectorExposure"]>;
}) {
  if (!exposure.sector) {
    return (
      <p className="text-[11px] text-muted-foreground/70">
        Sector untagged — add a sector on the watchlist to enable concentration
        checks.
      </p>
    );
  }
  const projected = exposure.projectedPct;
  const projectedStr =
    projected != null ? `${projected.toFixed(1)}%` : "—";
  const colour = exposure.exceedsThreshold
    ? "text-yellow-300"
    : "text-muted-foreground";
  return (
    <div className={`flex items-baseline justify-between text-[11px] ${colour}`}>
      <span>
        Sector <span className="font-medium">{exposure.sector}</span>:{" "}
        current {exposure.currentPct.toFixed(1)}% → after fill {projectedStr}
      </span>
      {exposure.exceedsThreshold && (
        <span className="font-medium">
          &gt; {exposure.threshold}% threshold
        </span>
      )}
    </div>
  );
}

function RecommendationBar({
  rec,
}: {
  rec: NonNullable<TickerInsight["context"]["recommendation"]>;
}) {
  const total =
    rec.strongBuy + rec.buy + rec.hold + rec.sell + rec.strongSell;
  if (total === 0) return null;
  const segments = [
    { label: "Strong Buy", value: rec.strongBuy, colour: "bg-green-600" },
    { label: "Buy", value: rec.buy, colour: "bg-green-500/70" },
    { label: "Hold", value: rec.hold, colour: "bg-muted-foreground/40" },
    { label: "Sell", value: rec.sell, colour: "bg-red-500/70" },
    { label: "Strong Sell", value: rec.strongSell, colour: "bg-red-600" },
  ];
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Analyst consensus
        </p>
        <p className="text-[10px] text-muted-foreground/70">
          {total} analyst{total === 1 ? "" : "s"} · {rec.period}
        </p>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/5">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              className={s.colour}
              style={{ width: `${(s.value / total) * 100}%` }}
              title={`${s.label}: ${s.value}`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground tabular-nums">
        {segments.map((s) =>
          s.value > 0 ? (
            <span key={s.label}>
              {s.label}: {s.value}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
