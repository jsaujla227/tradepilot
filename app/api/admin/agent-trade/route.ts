import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { runAgentTrades } from "@/lib/agent/trade";

export const maxDuration = 60;

export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const admin = supabaseAdmin();
  if (!admin) {
    return new Response("Supabase admin not configured", { status: 503 });
  }

  try {
    const results = await runAgentTrades(admin);
    return Response.json({ ok: true, results });
  } catch (err) {
    return new Response(
      `Agent trade run failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 },
    );
  }
}
