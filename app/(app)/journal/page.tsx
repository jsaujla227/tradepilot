import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatMoney, formatPct, formatNumber } from "@/lib/format";
import {
  PendingReviews,
  type PendingPosition,
} from "./_components/pending-reviews";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journal · TradePilot" };

type PositionRow = {
  position_id: string;
  ticker: string;
  realized_pnl: number;
  opened_at: string;
  closed_at: string;
};

type ReviewRow = {
  id: string;
  position_id: string;
  ticker: string;
  realized_pnl: number;
  r_realized: number | null;
  what_worked: string;
  what_didnt: string;
  lessons: string;
  reviewed_at: string;
};

export default async function JournalPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [posResult, reviewResult] = await Promise.all([
    supabase
      .from("positions")
      .select(
        "position_id, ticker, realized_pnl, opened_at, closed_at, is_closed",
      )
      .eq("is_closed", true)
      .order("closed_at", { ascending: false }),
    supabase
      .from("trade_reviews")
      .select(
        "id, position_id, ticker, realized_pnl, r_realized, what_worked, what_didnt, lessons, reviewed_at",
      )
      .order("reviewed_at", { ascending: false }),
  ]);

  const closedPositions: PositionRow[] = (posResult.data ?? []).map((p) => ({
    position_id: String(p.position_id),
    ticker: String(p.ticker),
    realized_pnl: Number(p.realized_pnl ?? 0),
    opened_at: String(p.opened_at),
    closed_at: String(p.closed_at),
  }));

  const reviews: ReviewRow[] = (reviewResult.data ?? []).map((r) => ({
    id: String(r.id),
    position_id: String(r.position_id),
    ticker: String(r.ticker),
    realized_pnl: Number(r.realized_pnl ?? 0),
    r_realized: r.r_realized != null ? Number(r.r_realized) : null,
    what_worked: String(r.what_worked),
    what_didnt: String(r.what_didnt),
    lessons: String(r.lessons),
    reviewed_at: String(r.reviewed_at),
  }));

  // Pending = closed positions not yet reviewed
  const reviewedIds = new Set(reviews.map((r) => r.position_id));
  const pending: PendingPosition[] = closedPositions
    .filter((p) => !reviewedIds.has(p.position_id))
    .map((p) => ({
      position_id: p.position_id,
      ticker: p.ticker,
      realized_pnl: p.realized_pnl,
      opened_at: p.opened_at,
      closed_at: p.closed_at,
    }));

  // Stats from completed reviews
  const wins = reviews.filter((r) => r.realized_pnl > 0);
  const losses = reviews.filter((r) => r.realized_pnl <= 0);
  const winRate = reviews.length > 0 ? wins.length / reviews.length : null;
  const avgWin =
    wins.length > 0
      ? wins.reduce((s, r) => s + r.realized_pnl, 0) / wins.length
      : null;
  const avgLoss =
    losses.length > 0
      ? Math.abs(losses.reduce((s, r) => s + r.realized_pnl, 0) / losses.length)
      : null;
  const expectancy =
    winRate != null && avgWin != null && avgLoss != null
      ? winRate * avgWin - (1 - winRate) * avgLoss
      : null;

  // Avg holding period for reviewed positions
  const reviewedPositions = closedPositions.filter((p) =>
    reviewedIds.has(p.position_id),
  );
  let avgHoldingDays: number | null = null;
  if (reviewedPositions.length > 0) {
    const total = reviewedPositions.reduce((sum, p) => {
      const ms =
        new Date(p.closed_at).getTime() - new Date(p.opened_at).getTime();
      return sum + ms / (1000 * 60 * 60 * 24);
    }, 0);
    avgHoldingDays = total / reviewedPositions.length;
  }

  const hasStats = reviews.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">My journal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review closed positions, track patterns, build discipline.
        </p>
      </div>

      {/* Stats */}
      {hasStats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Win rate"
            value={winRate != null ? formatPct(winRate * 100, 0) : "—"}
          />
          <StatCard
            label="Avg win"
            value={avgWin != null ? formatMoney(avgWin) : "—"}
            valueColor="text-green-400"
          />
          <StatCard
            label="Avg loss"
            value={avgLoss != null ? formatMoney(-avgLoss) : "—"}
            valueColor="text-red-400"
          />
          <StatCard
            label="Expectancy"
            value={expectancy != null ? formatMoney(expectancy) : "—"}
            valueColor={
              expectancy != null
                ? expectancy >= 0
                  ? "text-green-400"
                  : "text-red-400"
                : undefined
            }
          />
          <StatCard
            label="Trades reviewed"
            value={String(reviews.length)}
          />
          <StatCard
            label="Avg hold"
            value={
              avgHoldingDays != null
                ? `${formatNumber(avgHoldingDays, 1)} days`
                : "—"
            }
          />
          <div className="col-span-2 flex items-center rounded-lg border border-border bg-card/50 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              SPY benchmark requires daily bars data (not available on Finnhub
              free tier). Will be enabled when a bars vendor is added.
            </p>
          </div>
        </div>
      )}

      {/* Pending reviews — auto-prompted when positions close */}
      <PendingReviews positions={pending} />

      {/* Completed reviews */}
      {reviews.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Completed reviews ({reviews.length})
          </h2>
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </section>
      )}

      {reviews.length === 0 && pending.length === 0 && (
        <div className="rounded-lg border border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          No closed positions yet. Close a paper position to write your first
          review.
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${valueColor ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

function ReviewCard({ review }: { review: ReviewRow }) {
  const pnlColor =
    review.realized_pnl >= 0 ? "text-green-400" : "text-red-400";
  return (
    <details className="rounded-lg border border-border bg-card/50">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-3">
          <span className="font-mono font-semibold">{review.ticker}</span>
          <span className={`text-sm tabular-nums ${pnlColor}`}>
            {review.realized_pnl >= 0 ? "+" : ""}
            {formatMoney(review.realized_pnl)}
          </span>
          {review.r_realized != null && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {review.r_realized >= 0 ? "+" : ""}
              {formatNumber(review.r_realized, 2)}R
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {new Date(review.reviewed_at).toLocaleDateString()}
          </span>
          <span className="text-[10px] text-muted-foreground/50">▾</span>
        </div>
      </summary>
      <div className="space-y-3 border-t border-border/50 px-4 py-3">
        <Field label="What worked" value={review.what_worked} />
        <Field label="What didn't work" value={review.what_didnt} />
        <Field label="Lessons" value={review.lessons} />
      </div>
    </details>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-0.5 text-xs text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground/80">{value}</p>
    </div>
  );
}
