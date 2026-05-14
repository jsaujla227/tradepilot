import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getEarningsContext } from "@/lib/finnhub/context";
import { SP500_TOP100 } from "@/lib/universe/sp500";

export const maxDuration = 300;

const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 11_000;

export async function POST() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return new Response("Supabase not configured", { status: 503 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const start = Date.now();
  let warmed = 0;
  let failed = 0;

  for (let i = 0; i < SP500_TOP100.length; i += BATCH_SIZE) {
    const batch = SP500_TOP100.slice(i, i + BATCH_SIZE);
    const batchStart = Date.now();

    const settled = await Promise.allSettled(
      batch.map((ticker) => getEarningsContext(ticker)),
    );

    for (const outcome of settled) {
      if (outcome.status === "fulfilled" && outcome.value !== null) {
        warmed++;
      } else {
        failed++;
      }
    }

    const remaining = BATCH_INTERVAL_MS - (Date.now() - batchStart);
    if (remaining > 0 && i + BATCH_SIZE < SP500_TOP100.length) {
      await new Promise((r) => setTimeout(r, remaining));
    }
  }

  return Response.json({
    ok: true,
    tickersWarmed: warmed,
    tickersFailed: failed,
    durationMs: Date.now() - start,
  });
}
