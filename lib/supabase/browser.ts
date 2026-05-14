import { createBrowserClient } from "@supabase/ssr";

// Supabase client for Client Components. Uses cookie storage so the session
// stays in sync with the server-side client created by createSupabaseServerClient.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
