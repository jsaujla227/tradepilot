import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runDailyReflection } from "@/lib/agent/lessons";

// Daily agent reflection cron — requires Authorization: Bearer ${CRON_SECRET}
// Scheduled via vercel.json to run weeknights after the portfolio snapshot.
// For each user with agent_enabled=true, asks Claude Sonnet to reflect on the
// day's autonomous activity and propose a momentum-threshold adjustment that
// next morning's agent-trade cron will apply.

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
  const results = await runDailyReflection(admin);

  return Response.json({ ok: true, results });
}
