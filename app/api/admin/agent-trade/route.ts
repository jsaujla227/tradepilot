import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runAgentTrades } from "@/lib/agent/trade";

export const maxDuration = 60;

export async function POST() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return new Response("Supabase not configured", { status: 503 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const admin = supabaseAdmin();
  const results = await runAgentTrades(admin);

  return Response.json({ ok: true, results });
}
