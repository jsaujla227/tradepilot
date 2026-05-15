import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { runPositionMonitor } from "@/lib/agent/monitor";

export const maxDuration = 60;

export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const admin = supabaseAdmin();
  if (!admin) {
    return new Response("Supabase admin not configured", { status: 503 });
  }

  try {
    const results = await runPositionMonitor(admin);
    return Response.json({ ok: true, results });
  } catch (err) {
    return new Response(
      `Position monitor failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 },
    );
  }
}
