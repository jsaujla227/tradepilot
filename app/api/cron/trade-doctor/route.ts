import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getQuotesMap } from "@/lib/finnhub/data";
import { getEarningsContext } from "@/lib/finnhub/context";
import { monitorPosition, streakCaution } from "@/lib/scoring/position-monitor";

// Daily position health scanner — requires Authorization: Bearer ${CRON_SECRET}
// Scheduled via vercel.json to run at 21:15 UTC (4:15 PM ET) on weekdays.
// For each user with open positions, generates PositionAlerts and stores them
// so the dashboard can surface "review this position" cards.

function isValidCronAuth(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = `Bearer ${secret}`;
  try {
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret ||
    !isValidCronAuth(req.headers.get("authorization"), cronSecret)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  // Fetch all users
  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id");

  let totalProcessed = 0;
  let totalAlerts = 0;

  for (const { user_id } of profiles ?? []) {
    // Open positions for this user
    const { data: openPositions } = await admin
      .from("positions")
      .select("ticker, qty, avg_cost")
      .eq("user_id", user_id)
      .eq("is_closed", false);

    if (!openPositions || openPositions.length === 0) continue;

    // Compute total portfolio value
    const tickers = openPositions.map((p: { ticker: string }) => p.ticker);
    const quotesMap = await getQuotesMap(tickers);
    const portfolioValue = openPositions.reduce(
      (sum: number, p: { ticker: string; qty: number }) => {
        const quote = quotesMap[p.ticker];
        return sum + (quote ? quote.price * p.qty : 0);
      },
      0,
    );

    // Latest checklist per ticker
    const { data: checklistRows } = await admin
      .from("trade_checklists")
      .select("ticker, entry, stop, target")
      .eq("user_id", user_id)
      .order("id", { ascending: false });

    const checklistByTicker = new Map<
      string,
      { entry: number | null; stop: number | null; target: number | null }
    >();
    for (const c of checklistRows ?? []) {
      if (!checklistByTicker.has(c.ticker)) {
        checklistByTicker.set(c.ticker, {
          entry: c.entry ?? null,
          stop: c.stop ?? null,
          target: c.target ?? null,
        });
      }
    }

    // Earnings context per ticker (best-effort, parallel)
    const earningsMap = new Map<string, number | null>();
    await Promise.all(
      tickers.map(async (ticker: string) => {
        const ctx = await getEarningsContext(ticker).catch(() => null);
        earningsMap.set(ticker, ctx?.daysUntil ?? null);
      }),
    );

    // Recent reviews for streak detection
    const { data: recentReviews } = await admin
      .from("trade_reviews")
      .select("realized_pnl, reviewed_at")
      .eq("user_id", user_id)
      .order("reviewed_at", { ascending: false })
      .limit(5);

    const allAlerts: Array<{
      user_id: string;
      ticker: string;
      alert_type: string;
      severity: string;
      message: string;
      why: string;
      suggested_review: string;
      generated_at: string;
    }> = [];

    // Position-level alerts
    for (const position of openPositions as Array<{
      ticker: string;
      qty: number;
      avg_cost: number;
    }>) {
      const quote = quotesMap[position.ticker];
      if (!quote) continue;

      const checklist = checklistByTicker.get(position.ticker) ?? null;
      const daysToEarnings = earningsMap.get(position.ticker) ?? null;

      const alerts = monitorPosition(
        { ticker: position.ticker, qty: position.qty, avg_cost: Number(position.avg_cost) },
        quote.price,
        checklist,
        daysToEarnings,
        portfolioValue,
      );

      for (const alert of alerts) {
        allAlerts.push({
          user_id,
          ticker: alert.ticker,
          alert_type: alert.alert_type,
          severity: alert.severity,
          message: alert.message,
          why: alert.why,
          suggested_review: alert.suggested_review,
          generated_at: new Date().toISOString(),
        });
      }
    }

    // Portfolio-level streak caution
    const streak = streakCaution(
      (recentReviews ?? []).map((r: { realized_pnl: number; reviewed_at: string }) => ({
        realized_pnl: Number(r.realized_pnl),
        reviewed_at: r.reviewed_at,
      })),
    );
    if (streak) {
      allAlerts.push({
        user_id,
        ticker: streak.ticker,
        alert_type: streak.alert_type,
        severity: streak.severity,
        message: streak.message,
        why: streak.why,
        suggested_review: streak.suggested_review,
        generated_at: new Date().toISOString(),
      });
    }

    // Replace today's alerts with fresh batch
    await admin
      .from("position_alerts")
      .delete()
      .eq("user_id", user_id)
      .gte("generated_at", `${today}T00:00:00Z`);

    if (allAlerts.length > 0) {
      await admin.from("position_alerts").insert(allAlerts);
    }

    totalProcessed++;
    totalAlerts += allAlerts.length;
  }

  return Response.json({
    ok: true,
    date: today,
    users_processed: totalProcessed,
    alerts_generated: totalAlerts,
  });
}
