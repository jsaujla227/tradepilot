import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBars } from "@/lib/market-data/massive";

// Backfills the historical_bars table from Massive. Idempotent: re-running
// upserts the same rows. Resumable: a failed ticker is captured in its result
// and never aborts the batch. Service-role only — call from cron / admin
// routes via supabaseAdmin().

export type BackfillResult = {
  ticker: string;
  ok: boolean;
  barsUpserted: number;
  error?: string;
};

const BATCH_SIZE = 10;
const BATCH_PAUSE_MS = 2_000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Backfills daily OHLCV for `tickers` over the trailing `lookbackDays` window.
 * Returns one BackfillResult per ticker. A single ticker failure is recorded
 * in that ticker's result rather than thrown.
 */
export async function backfillBars(
  admin: SupabaseClient,
  tickers: readonly string[],
  lookbackDays: number,
): Promise<BackfillResult[]> {
  const to = isoDate(new Date());
  const from = isoDate(new Date(Date.now() - lookbackDays * 86_400_000));
  const results: BackfillResult[] = [];

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);

    const settled = await Promise.allSettled(
      batch.map(async (ticker): Promise<BackfillResult> => {
        const bars = await getBars(ticker, 1, "day", from, to);
        if (bars.length === 0) {
          return { ticker, ok: true, barsUpserted: 0 };
        }
        const rows = bars.map((b) => ({
          ticker: ticker.trim().toUpperCase(),
          bar_date: isoDate(new Date(b.time)),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: Math.round(b.volume),
        }));
        const { error } = await admin
          .from("historical_bars")
          .upsert(rows, { onConflict: "ticker,bar_date" });
        if (error) throw new Error(error.message);
        return { ticker, ok: true, barsUpserted: rows.length };
      }),
    );

    settled.forEach((outcome, idx) => {
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else {
        results.push({
          ticker: batch[idx]!,
          ok: false,
          barsUpserted: 0,
          error:
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason),
        });
      }
    });

    if (i + BATCH_SIZE < tickers.length) {
      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    }
  }

  return results;
}
