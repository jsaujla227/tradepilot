"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tickerSchema } from "@/lib/ticker";
import { getHistoricalBars } from "@/lib/backtest/data";
import {
  walkForward,
  buildSmaStrategy,
  sharpeObjective,
} from "@/lib/backtest/walk-forward";
import { evaluateBacktestGate } from "@/lib/backtest/lifecycle";

// Backtest evidence window and walk-forward shape used when promoting a
// draft strategy: ~5 years of bars, 1-year in-sample / 1-quarter out-of-sample.
const EVIDENCE_DAYS = 1825;
const IN_SAMPLE_BARS = 252;
const OUT_OF_SAMPLE_BARS = 63;
const MIN_BARS = IN_SAMPLE_BARS + OUT_OF_SAMPLE_BARS;

const createSchema = z
  .object({
    name: z.string().min(1).max(80),
    ticker: tickerSchema,
    fast: z.coerce.number().int().min(2).max(200),
    slow: z.coerce.number().int().min(3).max(400),
  })
  .refine((d) => d.fast < d.slow, {
    message: "Fast period must be shorter than the slow period",
  });

export type CreateStrategyState = { error?: string; saved?: boolean };

export async function createStrategy(
  _prev: CreateStrategyState,
  formData: FormData,
): Promise<CreateStrategyState> {
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    ticker: formData.get("ticker"),
    fast: formData.get("fast"),
    slow: formData.get("slow"),
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

  const { error } = await supabase.from("strategies").insert({
    user_id: user.id,
    name: parsed.data.name,
    ticker: parsed.data.ticker,
    kind: "sma_crossover",
    params: { fast: parsed.data.fast, slow: parsed.data.slow },
    status: "draft",
  });
  if (error) return { error: error.message };

  revalidatePath("/strategies");
  return { saved: true };
}

/**
 * Runs a walk-forward backtest of a draft strategy, stores the evidence
 * snapshot, and promotes it to `backtested` when the gate passes.
 */
export async function backtestAndPromote(strategyId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: row } = await supabase
    .from("strategies")
    .select("id, ticker, params, status, stage_metrics")
    .eq("id", strategyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) throw new Error("Strategy not found");

  const params = (row.params ?? {}) as { fast?: number; slow?: number };
  const fast = params.fast ?? 50;
  const slow = params.slow ?? 200;
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - EVIDENCE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const existing = (row.stage_metrics ?? {}) as Record<string, unknown>;

  const bars = await getHistoricalBars(supabase, row.ticker as string, from, to);
  if (bars.length < MIN_BARS) {
    await supabase
      .from("strategies")
      .update({
        stage_metrics: {
          ...existing,
          backtest: {
            from,
            to,
            error: `Only ${bars.length} historical bars — need ${MIN_BARS}+. Run the historical-bar backfill from Admin.`,
          },
        },
        notes: "Not enough historical data to backtest.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", strategyId)
      .eq("user_id", user.id);
    revalidatePath("/strategies");
    return;
  }

  const report = walkForward(
    bars,
    [{ fast, slow }],
    buildSmaStrategy,
    sharpeObjective,
    { inSampleBars: IN_SAMPLE_BARS, outOfSampleBars: OUT_OF_SAMPLE_BARS },
    { initialCapital: 10_000, slippage: 0.0005, commission: 1 },
  );
  const gate = evaluateBacktestGate(
    report.aggregateOutOfSample,
    report.overfittingGap,
  );

  const update: Record<string, unknown> = {
    stage_metrics: {
      ...existing,
      backtest: {
        from,
        to,
        windows: report.windows.length,
        overfittingGap: report.overfittingGap,
        metrics: report.aggregateOutOfSample,
        gate,
      },
    },
    notes: gate.passed
      ? "Backtest gate passed."
      : "Backtest gate not met — see the criteria below.",
    updated_at: new Date().toISOString(),
  };
  if (gate.passed && row.status === "draft") {
    update.status = "backtested";
  }

  const { error } = await supabase
    .from("strategies")
    .update(update)
    .eq("id", strategyId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/strategies");
}

/** Moves a backtested strategy into forward paper trading. */
export async function advanceStage(strategyId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: row } = await supabase
    .from("strategies")
    .select("status")
    .eq("id", strategyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) throw new Error("Strategy not found");
  if (row.status !== "backtested") {
    throw new Error(
      "Only a backtested strategy can move to paper trading at this stage.",
    );
  }

  const { error } = await supabase
    .from("strategies")
    .update({
      status: "paper",
      notes: "Moved to forward paper trading.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", strategyId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/strategies");
}

/** Rejects a strategy — a terminal state. */
export async function rejectStrategy(strategyId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("strategies")
    .update({
      status: "rejected",
      notes: "Rejected.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", strategyId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/strategies");
}
