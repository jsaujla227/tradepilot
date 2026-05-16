import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runPositionMonitor } from "@/lib/agent/monitor";

// Position monitor cron — requires Authorization: Bearer ${CRON_SECRET}
// Scheduled via vercel.json to run at 19:30 UTC on weekdays (30 min before
// US market close). For each user with agent_enabled=true, checks open
// positions against stop prices from trade_checklists and auto-closes
// any that have hit their stop.

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
  const results = await runPositionMonitor(admin);

  return Response.json({ ok: true, results });
}
