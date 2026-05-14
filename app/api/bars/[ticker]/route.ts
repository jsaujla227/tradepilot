import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AlpacaDataError, getDailyBars } from "@/lib/alpaca/data";

// Bars are bulk and slow to refresh — the 6h Upstash cache lives inside
// getDailyBars(). Route layer stays uncached so the client always reads through.
export const dynamic = "force-dynamic";

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 365;

function parseLimit(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

export async function GET(
  request: NextRequest,
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
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  try {
    const { result, cacheHit } = await getDailyBars(rawTicker, limit);
    return NextResponse.json(
      { ticker: result.ticker, bars: result.bars, cacheHit },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Cache": cacheHit ? "HIT" : "MISS",
        },
      },
    );
  } catch (err) {
    if (err instanceof AlpacaDataError) {
      const status =
        err.code === "invalid-ticker" || err.code === "invalid-input"
          ? 400
          : err.code === "missing-credentials"
            ? 500
            : (err.status ?? 502);
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    return NextResponse.json(
      { error: "Bars request failed" },
      { status: 500 },
    );
  }
}
