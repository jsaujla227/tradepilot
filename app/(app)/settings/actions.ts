"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const settingsSchema = z.object({
  account_size_initial: z.coerce.number().positive().max(1e12),
  max_risk_per_trade_pct: z.coerce.number().positive().lt(100),
  daily_loss_limit_pct: z.coerce.number().positive().lt(100),
  ai_token_budget_monthly: z.coerce.number().int().min(0),
  agent_enabled: z.coerce.boolean().default(false),
  agent_daily_capital_limit: z.coerce.number().min(0).max(1e8),
});

export type SettingsState = {
  error?: string;
  saved?: boolean;
};

export async function updateSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const parsed = settingsSchema.safeParse({
    account_size_initial: formData.get("account_size_initial"),
    max_risk_per_trade_pct: formData.get("max_risk_per_trade_pct"),
    daily_loss_limit_pct: formData.get("daily_loss_limit_pct"),
    ai_token_budget_monthly: formData.get("ai_token_budget_monthly"),
    agent_enabled: formData.get("agent_enabled") === "on",
    agent_daily_capital_limit: formData.get("agent_daily_capital_limit"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase is not configured." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("profiles")
    .update(parsed.data)
    .eq("user_id", user.id);

  if (error) return { error: error.message };

  // Invalidate everything that reads profile (risk page, sidebar, dashboard later).
  revalidatePath("/", "layout");
  return { saved: true };
}
