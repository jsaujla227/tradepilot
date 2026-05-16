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
import { paperRun } from "@/lib/backtest/paper";
import {
  evaluateBacktestGate,
  evaluatePaperGate,
  evaluateLiveGate,
  detectDecay,
} from "@/lib/backtest/lifecycle";
import { cappedLiveCapital, LIVE_CAPITAL_CAP_MAX } from "@/lib/backtest/live";

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
        evaluatedAt: to,
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
    .select("status, stage_metrics")
    .eq("id", strategyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) throw new Error("Strategy not found");
  if (row.status !== "backtested") {
    throw new Error(
      "Only a backtested strategy can move to paper trading at this stage.",
    );
  }

  const existing = (row.stage_metrics ?? {}) as Record<string, unknown>;
  const { error } = await supabase
    .from("strategies")
    .update({
      status: "paper",
      stage_metrics: {
        ...existing,
        paper: { startedAt: new Date().toISOString().slice(0, 10) },
      },
      notes: "Moved to forward paper trading.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", strategyId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/strategies");
}

/**
 * Evaluates the forward paper run against the paper gate and, when it passes,
 * promotes the strategy to `live_small` with a hard-capped live capital limit.
 */
export async function promoteToLive(strategyId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: row } = await supabase
    .from("strategies")
    .select("ticker, params, status, stage_metrics")
    .eq("id", strategyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) throw new Error("Strategy not found");
  if (row.status !== "paper") {
    throw new Error(
      "Only a strategy in paper trading can be promoted to live.",
    );
  }

  const params = (row.params ?? {}) as { fast?: number; slow?: number };
  const existing = (row.stage_metrics ?? {}) as Record<string, unknown> & {
    paper?: { startedAt?: string };
  };
  const startedAt = existing.paper?.startedAt;
  if (!startedAt) {
    throw new Error("Strategy has no paper-start date — cannot evaluate.");
  }

  const today = new Date().toISOString().slice(0, 10);
  const bars = await getHistoricalBars(
    supabase,
    row.ticker as string,
    startedAt,
    today,
  );
  const run = paperRun(bars, params.fast ?? 50, params.slow ?? 200);
  const gate = evaluatePaperGate(run.metrics, run.barCount);

  const live: Record<string, unknown> = { evaluatedAt: today, gate };
  const update: Record<string, unknown> = {
    notes: gate.passed
      ? "Paper gate passed — promoted to live (small size)."
      : "Paper gate not met — see the criteria below.",
    updated_at: new Date().toISOString(),
  };
  if (gate.passed) {
    live.startedAt = today;
    live.capitalCap = cappedLiveCapital(LIVE_CAPITAL_CAP_MAX);
    update.status = "live_small";
  }
  update.stage_metrics = { ...existing, live };

  const { error } = await supabase
    .from("strategies")
    .update(update)
    .eq("id", strategyId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/strategies");
}

/**
 * Evaluates the long-term live run, detects strategy decay against the
 * backtested baseline, and approves the strategy when the live gate passes.
 */
export async function approveStrategy(strategyId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: row } = await supabase
    .from("strategies")
    .select("ticker, params, status, stage_metrics")
    .eq("id", strategyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) throw new Error("Strategy not found");
  if (row.status !== "live_small") {
    throw new Error("Only a live (small size) strategy can be approved.");
  }

  const params = (row.params ?? {}) as { fast?: number; slow?: number };
  const existing = (row.stage_metrics ?? {}) as Record<string, unknown> & {
    backtest?: { metrics?: import("@/lib/backtest/metrics").BacktestMetrics };
    live?: { startedAt?: string };
  };
  const liveStart = existing.live?.startedAt;
  if (!liveStart) {
    throw new Error("Strategy has no live-start date — cannot evaluate.");
  }

  const today = new Date().toISOString().slice(0, 10);
  const bars = await getHistoricalBars(
    supabase,
    row.ticker as string,
    liveStart,
    today,
  );
  const run = paperRun(bars, params.fast ?? 50, params.slow ?? 200);
  const baseline = existing.backtest?.metrics;
  const decay = baseline
    ? detectDecay(run.metrics, baseline)
    : { decayed: false, reasons: [] as string[] };
  const gate = evaluateLiveGate(run.metrics, run.barCount, decay.decayed);

  const approval: Record<string, unknown> = {
    evaluatedAt: today,
    gate,
    decay,
    liveMetrics: run.metrics,
  };
  const update: Record<string, unknown> = {
    notes: gate.passed
      ? "Live gate passed — strategy approved."
      : "Live gate not met — see the criteria below.",
    updated_at: new Date().toISOString(),
  };
  if (gate.passed) {
    approval.approvedAt = today;
    update.status = "approved";
  }
  update.stage_metrics = { ...existing, approval };

  const { error } = await supabase
    .from("strategies")
    .update(update)
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
