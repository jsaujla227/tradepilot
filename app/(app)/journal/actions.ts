"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const reviewSchema = z.object({
  position_id: z.string().min(1, "Position ID required"),
  ticker: z
    .string()
    .min(1)
    .max(12)
    .transform((s) => s.toUpperCase()),
  realized_pnl: z.coerce.number(),
  what_worked: z.string().min(1, "Required").max(1000),
  what_didnt: z.string().min(1, "Required").max(1000),
  lessons: z.string().min(1, "Required").max(1000),
  r_realized: z.coerce
    .number()
    .optional()
    .catch(undefined),
});

export type ReviewState = {
  error?: string;
  saved?: boolean;
};

export async function submitReview(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const parsed = reviewSchema.safeParse({
    position_id: formData.get("position_id"),
    ticker: formData.get("ticker"),
    realized_pnl: formData.get("realized_pnl"),
    what_worked: formData.get("what_worked"),
    what_didnt: formData.get("what_didnt"),
    lessons: formData.get("lessons"),
    r_realized: formData.get("r_realized") || undefined,
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

  // Prevent duplicate reviews for the same position
  const { data: existing } = await supabase
    .from("trade_reviews")
    .select("id")
    .eq("position_id", parsed.data.position_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) return { error: "A review already exists for this position." };

  const { error } = await supabase.from("trade_reviews").insert({
    user_id: user.id,
    position_id: parsed.data.position_id,
    ticker: parsed.data.ticker,
    realized_pnl: parsed.data.realized_pnl,
    r_realized: parsed.data.r_realized ?? null,
    what_worked: parsed.data.what_worked,
    what_didnt: parsed.data.what_didnt,
    lessons: parsed.data.lessons,
    reviewed_at: new Date().toISOString(),
  });

  if (error) return { error: error.message };

  revalidatePath("/journal");
  return { saved: true };
}
