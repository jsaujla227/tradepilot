import "server-only";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Manual admin triggers under `app/api/admin/*` operate with the service-role
// client (same blast radius as Vercel Cron). The plain `auth.getUser()` check
// alone isn't enough: any signed-in user shouldn't be able to fire a job that
// touches every row in the database. `ADMIN_USER_IDS` (comma-separated UUIDs)
// is the explicit allowlist; absence = locked.

function parseAdminAllowlist(): Set<string> {
  const raw = process.env.ADMIN_USER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export type AdminAuthResult =
  | { ok: true; user: User }
  | { ok: false; response: Response };

/**
 * Authenticates the caller and enforces the `ADMIN_USER_IDS` allowlist.
 * Returns the authenticated user on success, or a Response (401/403/503) on
 * failure that the route handler should return directly.
 */
export async function requireAdmin(): Promise<AdminAuthResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      response: new Response("Supabase not configured", { status: 503 }),
    };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: new Response("Unauthorized", { status: 401 }),
    };
  }
  const allowlist = parseAdminAllowlist();
  if (allowlist.size === 0 || !allowlist.has(user.id)) {
    return {
      ok: false,
      response: new Response("Forbidden — admin allowlist", { status: 403 }),
    };
  }
  return { ok: true, user };
}
