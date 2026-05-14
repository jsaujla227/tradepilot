"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tickerSchema } from "@/lib/ticker";

const addSchema = z.object({
  ticker: tickerSchema,
  sector: z
    .string()
    .max(80)
    .optional()
    .transform((s) => (s && s.trim().length > 0 ? s.trim() : undefined)),
  target_entry: z.coerce
    .number()
    .positive()
    .optional()
    .catch(undefined),
  target_stop: z.coerce
    .number()
    .positive()
    .optional()
    .catch(undefined),
  target_price: z.coerce
    .number()
    .positive()
    .optional()
    .catch(undefined),
  reason: z
    .string()
    .max(500)
    .optional()
    .transform((s) => (s && s.trim().length > 0 ? s.trim() : undefined)),
  notes: z
    .string()
    .max(500)
    .optional()
    .transform((s) => (s && s.trim().length > 0 ? s.trim() : undefined)),
});

export type AddWatchlistState = {
  error?: string;
  saved?: boolean;
};

export async function addWatchlistItem(
  _prev: AddWatchlistState,
  formData: FormData,
): Promise<AddWatchlistState> {
  const parsed = addSchema.safeParse({
    ticker: formData.get("ticker"),
    sector: formData.get("sector") ?? undefined,
    target_entry: formData.get("target_entry") ?? undefined,
    target_stop: formData.get("target_stop") ?? undefined,
    target_price: formData.get("target_price") ?? undefined,
    reason: formData.get("reason") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase not configured" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from("watchlist").insert({
    user_id: user.id,
    ticker: parsed.data.ticker,
    target_entry: parsed.data.target_entry ?? null,
    target_stop: parsed.data.target_stop ?? null,
    target_price: parsed.data.target_price ?? null,
    reason: parsed.data.reason ?? null,
    notes: parsed.data.notes ?? null,
  });

  if (error) return { error: error.message };

  // Upsert sector tag into ticker_meta if sector was provided
  if (parsed.data.sector) {
    await supabase.from("ticker_meta").upsert(
      {
        user_id: user.id,
        ticker: parsed.data.ticker,
        sector: parsed.data.sector,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,ticker" },
    );
  }

  revalidatePath("/watchlist");
  return { saved: true };
}

export async function removeWatchlistItem(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/watchlist");
}
