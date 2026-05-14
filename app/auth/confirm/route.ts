import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /auth/confirm?token_hash=...&type=email&next=/dashboard
// Verifies the magic-link token; on success, redirects to `next` (or /dashboard).
// On failure, redirects to /login with an `error` query param.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      });
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  const errorUrl = new URL("/login", origin);
  errorUrl.searchParams.set("error", "invalid_or_expired_link");
  return NextResponse.redirect(errorUrl);
}
