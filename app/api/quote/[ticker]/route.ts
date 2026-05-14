import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FinnhubDataError, getQuote } from "@/lib/finnhub/data";

// Route-layer cache headers: `no-store` so the browser/CDN never short-circuits.
// The 60s Upstash cache lives inside getQuote() — that's the only layer that
// should be deduping market data requests across users on this single-user app.
export const dynamic = "force-dynamic";

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

  try {
    const { quote, cacheHit } = await getQuote(rawTicker);
    return NextResponse.json(
      { quote, cacheHit },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Cache": cacheHit ? "HIT" : "MISS",
        },
      },
    );
  } catch (err) {
    if (err instanceof FinnhubDataError) {
      const status =
        err.code === "invalid-ticker"
          ? 400
          : err.code === "unknown-ticker"
            ? 404
            : err.code === "missing-credentials"
              ? 500
              : (err.status ?? 502);
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    return NextResponse.json(
      { error: "Quote request failed" },
      { status: 500 },
    );
  }
}
