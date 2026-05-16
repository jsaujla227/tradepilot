"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPaperTradingCriteria } from "@/lib/performance";
import { DEFAULT_PROFILE } from "@/lib/profile";
import {
  exchangeRefreshToken,
  computeExpiresAt,
  QuestradeAuthError,
  type QuestradeTokens,
} from "@/lib/broker/questrade-auth";
import {
  upsertBrokerCredentials,
  deleteBrokerCredentials,
} from "@/lib/broker/credentials";

const settingsSchema = z.object({
  account_size_initial: z.coerce.number().positive().max(1e12),
  max_risk_per_trade_pct: z.coerce.number().positive().lt(100),
  daily_loss_limit_pct: z.coerce.number().positive().lt(100),
  max_portfolio_heat_pct: z.coerce.number().positive().lt(100),
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
    max_portfolio_heat_pct: formData.get("max_portfolio_heat_pct"),
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

export type UnlockState = { error?: string; unlocked?: boolean };

export async function unlockLiveTrading(
  prev: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  void prev;
  void formData;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase is not configured." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_size_initial, real_money_unlocked")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.real_money_unlocked) {
    return { unlocked: true };
  }

  const accountSize =
    Number(profile?.account_size_initial) ||
    DEFAULT_PROFILE.account_size_initial;
  const criteria = await getPaperTradingCriteria(accountSize);

  if (!criteria.allMet) {
    return {
      error: "Performance criteria not yet met. Review your paper-trading stats.",
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ real_money_unlocked: true })
    .eq("user_id", user.id);

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { unlocked: true };
}

export type BrokerModeState = { error?: string; saved?: boolean };

export async function setBrokerMode(
  _prev: BrokerModeState,
  formData: FormData,
): Promise<BrokerModeState> {
  const mode = formData.get("broker_mode");
  if (mode !== "paper" && mode !== "live") {
    return { error: "Invalid broker mode." };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase is not configured." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  if (mode === "live") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("real_money_unlocked")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile?.real_money_unlocked) {
      return {
        error:
          "Live trading is locked. Complete all paper-trading performance criteria first.",
      };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ broker_mode: mode })
    .eq("user_id", user.id);

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { saved: true };
}

// --- Questrade connection ---------------------------------------------------

const connectQuestradeSchema = z.object({
  refresh_token: z
    .string()
    .trim()
    .min(1, "Paste your Questrade refresh token")
    .max(4096),
});

export type QuestradeConnectState = {
  error?: string;
  connected?: boolean;
  disconnected?: boolean;
};

/**
 * Validates a pasted Questrade refresh token by exchanging it, then persists
 * the resulting (rotated) credentials. The pasted token is consumed by the
 * exchange and is dead afterwards — only the rotated one is stored.
 */
export async function connectQuestrade(
  _prev: QuestradeConnectState,
  formData: FormData,
): Promise<QuestradeConnectState> {
  const parsed = connectQuestradeSchema.safeParse({
    refresh_token: formData.get("refresh_token"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase is not configured." };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  let tokens: QuestradeTokens;
  try {
    tokens = await exchangeRefreshToken(parsed.data.refresh_token);
  } catch (err) {
    return {
      error:
        err instanceof QuestradeAuthError
          ? err.message
          : "Could not reach Questrade.",
    };
  }

  const ok = await upsertBrokerCredentials(supabase, user.id, {
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: computeExpiresAt(tokens.expiresIn),
    apiServer: tokens.apiServer,
  });
  if (!ok) return { error: "Could not save the Questrade connection." };

  revalidatePath("/settings");
  return { connected: true };
}

export async function disconnectQuestrade(
  _prev: QuestradeConnectState,
  _formData: FormData,
): Promise<QuestradeConnectState> {
  void _formData;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase is not configured." };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const ok = await deleteBrokerCredentials(supabase, user.id);
  if (!ok) return { error: "Could not remove the Questrade connection." };

  // Live mode with no broker credentials is invalid — fall back to paper.
  await supabase
    .from("profiles")
    .update({ broker_mode: "paper" })
    .eq("user_id", user.id);

  revalidatePath("/settings");
  return { disconnected: true };
}
