import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getHistoricalBars } from "@/lib/backtest/data";
import { paperRun } from "@/lib/backtest/paper";

// Daily shadow-signal logger — requires Authorization: Bearer ${CRON_SECRET}.
// For every strategy in the `paper` lifecycle stage, recomputes the forward
// paper run and appends today's hypothetical equity to paper_signals. The
// accumulating log is the day-by-day audit trail of the months-long paper run.

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

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret ||
    !isValidCronAuth(req.headers.get("authorization"), cronSecret)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: strategies } = await admin
    .from("strategies")
    .select("id, user_id, ticker, params, stage_metrics")
    .eq("status", "paper");

  if (!strategies || strategies.length === 0) {
    return Response.json({ ok: true, strategies: 0, logged: 0 });
  }

  const today = new Date().toISOString().slice(0, 10);
  let logged = 0;

  for (const s of strategies) {
    const stageMetrics = (s.stage_metrics ?? {}) as {
      paper?: { startedAt?: string };
    };
    const startedAt = stageMetrics.paper?.startedAt;
    if (!startedAt) continue;

    const params = (s.params ?? {}) as { fast?: number; slow?: number };
    const bars = await getHistoricalBars(
      admin,
      s.ticker as string,
      startedAt,
      today,
    );
    if (bars.length === 0) continue;

    const run = paperRun(bars, params.fast ?? 50, params.slow ?? 200);
    const equity = run.equityCurve[run.equityCurve.length - 1]?.equity ?? 0;

    const { error } = await admin.from("paper_signals").upsert(
      {
        strategy_id: s.id,
        user_id: s.user_id,
        signal_date: today,
        equity,
      },
      { onConflict: "strategy_id,signal_date" },
    );
    if (!error) logged++;
  }

  return Response.json({ ok: true, strategies: strategies.length, logged });
}
