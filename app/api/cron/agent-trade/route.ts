import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runAgentTrades } from "@/lib/agent/trade";

// Autonomous agent trade cron — requires Authorization: Bearer ${CRON_SECRET}
// Scheduled via vercel.json to run at 14:05 UTC on weekdays (30 min after scanner).
// For each user with agent_enabled=true, picks top scanner results and submits
// paper buy orders up to agent_daily_capital_limit.

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

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isValidCronAuth(req.headers.get("authorization"), cronSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = supabaseAdmin();
  const results = await runAgentTrades(admin);

  return Response.json({ ok: true, results });
}
