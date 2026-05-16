import Link from "next/link";
import { notFound } from "next/navigation";
import { getQuote } from "@/lib/finnhub/data";
import { getTickerInsight } from "@/lib/ticker-insight";
import { getBars, hasMassiveCreds, type Bar } from "@/lib/market-data/massive";
import {
  computeBarStats,
  EMPTY_BAR_STATS,
  suggestStopFromAtr,
} from "@/lib/market-data/bar-stats";
import { tickerSchema } from "@/lib/ticker";
import { formatMoney, formatPct } from "@/lib/format";
import { OhlcChart } from "@/components/ticker/ohlc-chart";

export const dynamic = "force-dynamic";

type Params = { ticker: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { ticker } = await params;
  return { title: `${ticker.toUpperCase()} · TradePilot` };
}

function rangeFor(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default async function TickerDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { ticker: rawTicker } = await params;
  const parsed = tickerSchema.safeParse(rawTicker);
  if (!parsed.success) notFound();
  const ticker = parsed.data;

  // Pull bars over the longer 320-day window so SMA-200 has enough data; the
  // chart still trims to the visible 90-day pane below. Falls back to an
  // empty array when the key is missing or the symbol is not covered.
  const { from, to } = rangeFor(320);
  const [barsResult, quoteResult, insight] = await Promise.allSettled([
    hasMassiveCreds() ? getBars(ticker, 1, "day", from, to) : Promise.resolve([] as Bar[]),
    getQuote(ticker),
    getTickerInsight(ticker, null),
  ]);

  const fullBars: Bar[] =
    barsResult.status === "fulfilled" ? barsResult.value : [];
  const ninetyDaysAgoMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const bars: Bar[] = fullBars.filter((b) => b.time >= ninetyDaysAgoMs);
  const quote = quoteResult.status === "fulfilled" ? quoteResult.value.quote : null;
  const tickerInsight = insight.status === "fulfilled" ? insight.value : null;
  const barStats =
    fullBars.length > 0 ? computeBarStats(fullBars) : EMPTY_BAR_STATS;
  const suggestedStop = quote
    ? suggestStopFromAtr({
        entry: quote.price,
        atr14: barStats.atr14,
        side: "long",
        multiplier: 2,
      })
    : null;

  const dayChange =
    quote && quote.prevClose != null ? quote.price - quote.prevClose : null;
  const dayChangePct =
    dayChange != null && quote?.prevClose
      ? (dayChange / quote.prevClose) * 100
      : null;

  const high52 = tickerInsight?.fundamentals?.weekHigh52 ?? null;
  const low52 = tickerInsight?.fundamentals?.weekLow52 ?? null;
  const peRatio = tickerInsight?.fundamentals?.peRatio ?? null;
  const marketCap = tickerInsight?.fundamentals?.marketCap ?? null;
  const rsi = tickerInsight?.rsi ?? null;
  const macd = tickerInsight?.macd ?? null;
  const earnings = tickerInsight?.context?.earnings ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <Link href="/watchlist" className="hover:text-foreground transition">
              ← Watchlist
            </Link>
            <span aria-hidden>·</span>
            <Link href="/portfolio" className="hover:text-foreground transition">
              Portfolio
            </Link>
          </div>
          <h1 className="mt-2 font-mono text-2xl font-semibold tracking-tight">
            {ticker}
          </h1>
          {tickerInsight?.fundamentals?.name && (
            <p className="text-sm text-muted-foreground">
              {tickerInsight.fundamentals.name}
              {tickerInsight.fundamentals.sector
                ? ` · ${tickerInsight.fundamentals.sector}`
                : ""}
            </p>
          )}
        </div>
        {quote && (
          <div className="text-right">
            <p className="font-mono text-2xl tabular-nums font-semibold">
              {formatMoney(quote.price)}
            </p>
            {dayChange != null && (
              <p
                className={`text-xs font-mono tabular-nums ${
                  dayChange >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {dayChange >= 0 ? "+" : ""}
                {formatMoney(dayChange)}
                {dayChangePct != null && (
                  <span className="ml-1">
                    ({dayChange >= 0 ? "+" : ""}
                    {formatPct(dayChangePct, 2)})
                  </span>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {/* OHLC chart */}
      <section className="rounded-lg border border-border bg-card/40 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            90-day daily bars
          </h2>
          <p className="text-[10px] text-muted-foreground/60 tabular-nums">
            {bars.length} bars · source: Massive.com
          </p>
        </div>
        <OhlcChart bars={bars} ticker={ticker} />
      </section>

      {/* Fundamentals + technicals + earnings stat grid */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="52w high" value={high52 != null ? formatMoney(high52) : "—"} />
        <StatCard label="52w low" value={low52 != null ? formatMoney(low52) : "—"} />
        <StatCard label="P/E" value={peRatio != null ? peRatio.toFixed(2) : "—"} />
        <StatCard
          label="Market cap"
          value={marketCap != null ? formatMarketCap(marketCap) : "—"}
        />
        <StatCard
          label="RSI(14)"
          value={
            rsi
              ? `${rsi.value.toFixed(1)} · ${rsiBand(rsi.value)}`
              : "—"
          }
          tone={rsi ? rsiTone(rsi.value) : "muted"}
        />
        <StatCard
          label="MACD"
          value={
            macd
              ? `${macd.macd.toFixed(2)} (${macd.histogram >= 0 ? "+" : ""}${macd.histogram.toFixed(2)})`
              : "—"
          }
          tone={macd ? (macd.histogram >= 0 ? "up" : "down") : "muted"}
        />
        <StatCard
          label="Next earnings"
          value={
            earnings?.nextEarningsDate
              ? `${earnings.nextEarningsDate}${earnings.daysUntil != null ? ` (${earnings.daysUntil}d)` : ""}`
              : "—"
          }
          tone={
            earnings && earnings.daysUntil != null && earnings.daysUntil <= 7
              ? "warn"
              : "muted"
          }
        />
        <StatCard
          label="Analyst target"
          value={
            tickerInsight?.fundamentals?.analystTargetPrice != null
              ? formatMoney(tickerInsight.fundamentals.analystTargetPrice)
              : "—"
          }
        />
      </section>

      {/* Bar-derived signals — only render the section when at least one is available. */}
      {(barStats.atr14 != null ||
        barStats.sma50 != null ||
        barStats.sma200 != null ||
        barStats.avgDollarVolume != null ||
        barStats.historicalVol20 != null) && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Bar-derived signals ({barStats.barCount} bars)
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="ATR(14)"
              value={
                barStats.atr14 != null ? formatMoney(barStats.atr14) : "—"
              }
            />
            <StatCard
              label="Suggested stop (2×ATR)"
              value={
                suggestedStop != null ? formatMoney(suggestedStop) : "—"
              }
              tone={suggestedStop != null ? "warn" : "muted"}
            />
            <StatCard
              label="SMA 50"
              value={
                barStats.sma50 != null ? formatMoney(barStats.sma50) : "—"
              }
              tone={
                quote && barStats.sma50 != null
                  ? quote.price > barStats.sma50
                    ? "up"
                    : "down"
                  : "muted"
              }
            />
            <StatCard
              label="SMA 200"
              value={
                barStats.sma200 != null ? formatMoney(barStats.sma200) : "—"
              }
              tone={
                quote && barStats.sma200 != null
                  ? quote.price > barStats.sma200
                    ? "up"
                    : "down"
                  : "muted"
              }
            />
            <StatCard
              label="20-d HV (annualised)"
              value={
                barStats.historicalVol20 != null
                  ? `${(barStats.historicalVol20 * 100).toFixed(1)}%/yr`
                  : "—"
              }
            />
            <StatCard
              label="Avg $ vol (20d)"
              value={
                barStats.avgDollarVolume != null
                  ? formatMarketCap(barStats.avgDollarVolume) + "/day"
                  : "—"
              }
            />
          </div>
        </section>
      )}

      {!hasMassiveCreds() && (
        <p className="text-[11px] text-muted-foreground">
          Set MASSIVE_API_KEY in the environment to load historical bars for
          this ticker. Quotes and fundamentals are independent and continue to
          render without it.
        </p>
      )}
    </div>
  );
}

function rsiBand(v: number): string {
  if (v > 70) return "overbought";
  if (v < 30) return "oversold";
  return "neutral";
}

function rsiTone(v: number): StatTone {
  if (v > 70) return "down";
  if (v < 30) return "up";
  return "muted";
}

function formatMarketCap(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

type StatTone = "muted" | "up" | "down" | "warn";

function StatCard({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: StatTone;
}) {
  const colour =
    tone === "up"
      ? "text-emerald-400"
      : tone === "down"
        ? "text-rose-400"
        : tone === "warn"
          ? "text-yellow-400"
          : "text-foreground/80";
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-0.5 font-mono text-sm tabular-nums ${colour}`}>
        {value}
      </p>
    </div>
  );
}
