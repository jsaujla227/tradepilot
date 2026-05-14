"use client";

import { useActionState } from "react";
import { updateSettings, type SettingsState } from "../actions";

const initialState: SettingsState = {};

function Field({
  label,
  hint,
  name,
  defaultValue,
  step,
  min,
  suffix,
}: {
  label: string;
  hint?: string;
  name: string;
  defaultValue: number;
  step: string;
  min?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-foreground/90">{label}</span>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="number"
          name={name}
          defaultValue={defaultValue}
          step={step}
          min={min}
          inputMode="decimal"
          required
          className="flex-1 rounded-md border border-input bg-background/40 px-3 py-2 text-sm font-mono tabular-nums text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
        />
        {suffix ? (
          <span className="text-xs text-muted-foreground font-mono w-6">
            {suffix}
          </span>
        ) : null}
      </div>
      {hint ? (
        <span className="mt-1 block text-[11px] text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function SettingsForm({
  email,
  initial,
}: {
  email: string;
  initial: {
    account_size_initial: number;
    max_risk_per_trade_pct: number;
    daily_loss_limit_pct: number;
    ai_token_budget_monthly: number;
    broker_mode: "paper" | "live";
    real_money_unlocked: boolean;
    agent_enabled: boolean;
    agent_daily_capital_limit: number;
  };
}) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    updateSettings,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-6">
      <div className="rounded-lg border border-border/60 bg-background/30 p-4">
        <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          Signed in as
        </p>
        <p className="mt-0.5 text-sm font-mono text-foreground">{email}</p>
      </div>

      <Field
        label="Initial account size"
        hint="Used as the default in /risk calculators and as a baseline for return tracking."
        name="account_size_initial"
        defaultValue={initial.account_size_initial}
        step="any"
        min={1}
        suffix="$"
      />
      <Field
        label="Max risk per trade"
        hint="Cap on dollars-at-risk per trade as a % of account size. Drives position sizing."
        name="max_risk_per_trade_pct"
        defaultValue={initial.max_risk_per_trade_pct}
        step="any"
        min={0.01}
        suffix="%"
      />
      <Field
        label="Daily loss limit"
        hint="Realized + open loss threshold that trips the circuit breaker (M7)."
        name="daily_loss_limit_pct"
        defaultValue={initial.daily_loss_limit_pct}
        step="any"
        min={0.01}
        suffix="%"
      />
      <Field
        label="AI monthly token budget"
        hint="Hard cap on Anthropic tokens per calendar month across chat + monthly review (M10)."
        name="ai_token_budget_monthly"
        defaultValue={initial.ai_token_budget_monthly}
        step="1"
        min={0}
        suffix="tk"
      />

      {/* Broker section — read-only until M17 */}
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Broker
        </p>
        <div className="rounded-lg border border-border/60 bg-background/30 px-4 py-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm">Mode</span>
            <span className="text-xs font-mono text-foreground/80 uppercase">
              {initial.broker_mode}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Live trading unlocks after the agent meets paper-trading performance
            thresholds (win rate, expectancy, max drawdown). Managed in M16.
          </p>
        </div>
      </div>

      {/* Agent section */}
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Autonomous agent
        </p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="agent_enabled"
            defaultChecked={initial.agent_enabled}
            className="mt-0.5 h-4 w-4 rounded border-border accent-foreground cursor-pointer"
          />
          <span className="text-sm leading-snug">
            Enable agent
            <span className="block text-[11px] text-muted-foreground mt-0.5">
              Agent scans the market each morning and auto-executes paper trades.
              Disable to pause all autonomous activity without clearing settings.
            </span>
          </span>
        </label>
        <Field
          label="Agent daily capital limit"
          hint="Max dollars the agent may deploy in paper trades per trading day. Resets at midnight."
          name="agent_daily_capital_limit"
          defaultValue={initial.agent_daily_capital_limit}
          step="any"
          min={0}
          suffix="$"
        />
      </div>

      {state.error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
        >
          {state.error}
        </div>
      ) : null}
      {state.saved ? (
        <div
          role="status"
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
        >
          Saved.
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 disabled:opacity-60 disabled:cursor-not-allowed transition"
      >
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
