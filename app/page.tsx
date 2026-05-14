import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Public landing. Signed-in users bounce straight to /dashboard so the only
// reason to see this card is "logged out". The signed-out view points to
// /login — no marketing surface, no public sign-up.

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/dashboard");
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-border bg-card text-card-foreground p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div
            aria-hidden
            className="h-2.5 w-2.5 rounded-full bg-foreground/80"
          />
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Private
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-2">
          TradePilot
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          A trading cockpit for one. Paper trades, risk discipline, and an AI
          helper that shows its work.
        </p>
        <div className="mt-6 pt-6 border-t border-border">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-foreground text-background px-4 py-2 text-sm font-medium tracking-tight hover:bg-foreground/90 transition"
          >
            Sign in
            <span aria-hidden>&rarr;</span>
          </Link>
          <p className="mt-3 text-xs text-muted-foreground font-mono">
            Single-user cockpit. Magic link by email.
          </p>
        </div>
      </div>
    </div>
  );
}
