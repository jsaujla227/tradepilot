import { redirect } from "next/navigation";
import { getUserAndProfile } from "@/lib/profile";
import { getPaperTradingCriteria } from "@/lib/performance";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBrokerCredentials } from "@/lib/broker/credentials";
import { SettingsForm } from "./_components/settings-form";
import { QuestradeConnect } from "./_components/questrade-connect";
import { PerformanceScorecard } from "@/components/performance/performance-scorecard";

export const metadata = { title: "Settings · TradePilot" };

export default async function SettingsPage() {
  const session = await getUserAndProfile();
  if (!session) redirect("/login?next=/settings");

  const criteria = await getPaperTradingCriteria(
    session.profile.account_size_initial,
  );

  const supabase = await createSupabaseServerClient();
  const creds = supabase
    ? await getBrokerCredentials(supabase, session.userId)
    : null;
  const questradeStatus = {
    connected: creds !== null,
    accountId: creds?.accountId ?? null,
    connectedAt: creds?.connectedAt ?? null,
    updatedAt: creds?.updatedAt ?? null,
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 md:py-14">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <div aria-hidden className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
          <span>My settings</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground leading-relaxed">
          Trading constraints. Used everywhere — risk calculators auto-fill
          from these, the circuit breaker reads daily loss limit, and the AI
          helper budgets against the monthly token cap.
        </p>
      </header>
      <div className="space-y-10">
        <SettingsForm
          email={session.email ?? ""}
          initial={{
            account_size_initial: session.profile.account_size_initial,
            max_risk_per_trade_pct: session.profile.max_risk_per_trade_pct,
            daily_loss_limit_pct: session.profile.daily_loss_limit_pct,
            max_portfolio_heat_pct: session.profile.max_portfolio_heat_pct,
            ai_token_budget_monthly: session.profile.ai_token_budget_monthly,
            broker_mode: session.profile.broker_mode ?? "paper",
            real_money_unlocked: session.profile.real_money_unlocked ?? false,
            agent_enabled: session.profile.agent_enabled ?? false,
            agent_daily_capital_limit:
              session.profile.agent_daily_capital_limit ?? 500,
          }}
        />
        <div className="border-t border-border/40 pt-8">
          <QuestradeConnect status={questradeStatus} />
        </div>
        <div className="border-t border-border/40 pt-8">
          <PerformanceScorecard
            criteria={criteria}
            realMoneyUnlocked={session.profile.real_money_unlocked ?? false}
          />
        </div>
      </div>
    </div>
  );
}
