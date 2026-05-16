import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getHistoricalBars } from "@/lib/backtest/data";
import { computeBarStats } from "@/lib/market-data/bar-stats";
import { tickerSchema } from "@/lib/ticker";
import type { Bar } from "@/lib/market-data/massive";

// Read endpoint: derived bar statistics (ATR, historical volatility) for one
// ticker, drawn from the persisted historical_bars table. The /risk volatility
// calculator polls this to auto-fill ATR. force-dynamic so the auth check runs
// per request; historical_bars is daily data so freshness is not a concern.
export const dynamic = "force-dynamic";

function rangeFor(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ ticker: string }> },
) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: rawTicker } = await context.params;
  const parsed = tickerSchema.safeParse(rawTicker);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const ticker = parsed.data;

  try {
    const { from, to } = rangeFor(320);
    const rows = await getHistoricalBars(supabase, ticker, from, to);
    const bars: Bar[] = rows.map((r) => ({
      time: Date.parse(r.date),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
    const stats = computeBarStats(bars);
    return NextResponse.json(
      {
        ticker,
        atr14: stats.atr14,
        historicalVol20: stats.historicalVol20,
        lastClose: stats.lastClose,
        barCount: stats.barCount,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Bar-stats request failed" },
      { status: 502 },
    );
  }
}
