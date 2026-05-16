import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Mirror of public.profiles (post-M13 migration). Kept hand-typed for now;
// will be replaced by generated types after the schema stabilises.
export type Profile = {
  user_id: string;
  account_size_initial: number;
  max_risk_per_trade_pct: number;
  daily_loss_limit_pct: number;
  max_portfolio_heat_pct: number;
  ai_token_budget_monthly: number;
  // M13: broker abstraction + agent config
  broker_mode: "paper" | "live";
  real_money_unlocked: boolean;
  agent_enabled: boolean;
  agent_daily_capital_limit: number;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_PROFILE = {
  account_size_initial: 10000,
  max_risk_per_trade_pct: 1,
  daily_loss_limit_pct: 3,
  max_portfolio_heat_pct: 6,
  ai_token_budget_monthly: 100000,
  broker_mode: "paper" as const,
  real_money_unlocked: false,
  agent_enabled: false,
  agent_daily_capital_limit: 500,
} as const;

export type UserAndProfile = {
  email: string | null;
  userId: string;
  profile: Profile;
} | null;

/**
 * Returns user + profile when authenticated, or null when anonymous /
 * Supabase isn't configured yet. Never throws — safe to call from layouts
 * that should render either way.
 */
export async function getUserAndProfile(): Promise<UserAndProfile> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return null;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!data) return null;
    return {
      userId: user.id,
      email: user.email ?? null,
      profile: data as Profile,
    };
  } catch {
    return null;
  }
}

export type ProfileUpdate = {
  account_size_initial: number;
  max_risk_per_trade_pct: number;
  daily_loss_limit_pct: number;
  max_portfolio_heat_pct: number;
  ai_token_budget_monthly: number;
  agent_enabled: boolean;
  agent_daily_capital_limit: number;
};
