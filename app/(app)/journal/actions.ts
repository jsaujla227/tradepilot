"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractPatterns } from "@/lib/ai/patterns";

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

  // Rebuild learned_patterns for this user after every review submission.
  // Non-fatal: pattern rebuild failure doesn't block the review save.
  void refreshPatterns(user.id, supabase).catch(() => {});

  revalidatePath("/journal");
  return { saved: true };
}

// Re-extracts and upserts the user's personal trading patterns from their
// full trade_reviews + trade_checklists + ticker_meta history.
async function refreshPatterns(
  userId: string,
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
): Promise<void> {
  const [reviewsRes, checklistsRes, metaRes] = await Promise.all([
    supabase
      .from("trade_reviews")
      .select("ticker, realized_pnl, r_realized, reviewed_at")
      .eq("user_id", userId),
    supabase
      .from("trade_checklists")
      .select("ticker, side, r_at_entry")
      .eq("user_id", userId),
    supabase
      .from("ticker_meta")
      .select("ticker, sector")
      .eq("user_id", userId),
  ]);

  const reviews = (reviewsRes.data ?? []) as {
    ticker: string;
    realized_pnl: number;
    r_realized: number | null;
    reviewed_at: string;
  }[];
  const checklists = (checklistsRes.data ?? []) as {
    ticker: string;
    side: "buy" | "sell";
    r_at_entry: number | null;
  }[];
  const tickerMeta = (metaRes.data ?? []) as {
    ticker: string;
    sector: string | null;
  }[];

  const patterns = extractPatterns(reviews, checklists, tickerMeta);

  // Rebuild: delete existing and insert fresh batch atomically-ish.
  await supabase
    .from("learned_patterns")
    .delete()
    .eq("user_id", userId);

  if (patterns.length === 0) return;

  await supabase.from("learned_patterns").insert(
    patterns.map((p) => ({
      user_id: userId,
      pattern_type: p.pattern_type,
      description: p.description,
      conditions: p.conditions,
      stats: p.stats,
      sample_count: p.stats.sample_count,
    })),
  );
}
