"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tickerSchema } from "@/lib/ticker";

export type AddSuggestionState = { error?: string; saved?: boolean };

export async function addSuggestionToWatchlist(
  _prev: AddSuggestionState,
  formData: FormData,
): Promise<AddSuggestionState> {
  const raw = formData.get("ticker");
  const result = tickerSchema.safeParse(raw);
  if (!result.success) return { error: "Invalid ticker" };
  const ticker = result.data;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase not configured" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // Upsert — silently succeeds if ticker is already on the watchlist
  const { error } = await supabase.from("watchlist").upsert(
    { user_id: user.id, ticker },
    { onConflict: "user_id,ticker", ignoreDuplicates: true },
  );

  if (error) return { error: error.message };

  revalidatePath("/watchlist");
  revalidatePath("/suggestions");
  return { saved: true };
}
