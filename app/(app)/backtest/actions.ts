"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tickerSchema } from "@/lib/ticker";
import { getHistoricalBars } from "@/lib/backtest/data";
import { smaCrossover } from "@/lib/backtest/strategies/sma-crossover";
import { runBacktest, type EquityPoint } from "@/lib/backtest/engine";
import { computeMetrics, type BacktestMetrics } from "@/lib/backtest/metrics";
import {
  walkForward,
  smaParamGrid,
  buildSmaStrategy,
  sharpeObjective,
  type WalkForwardWindow,
} from "@/lib/backtest/walk-forward";

const schema = z
  .object({
    ticker: tickerSchema,
    fast: z.coerce.number().int().min(2).max(200),
    slow: z.coerce.number().int().min(3).max(400),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    initialCapital: z.coerce.number().positive().max(100_000_000),
  })
  .refine((d) => d.fast < d.slow, {
    message: "Fast period must be shorter than the slow period",
  })
  .refine((d) => d.from < d.to, {
    message: "Start date must be before the end date",
  });

export type BacktestRunView = {
  ticker: string;
  strategy: string;
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  barCount: number;
  tradeCount: number;
};

export type RunBacktestState = {
  error?: string;
  result?: BacktestRunView;
};

export async function runBacktestAction(
  _prev: RunBacktestState,
  formData: FormData,
): Promise<RunBacktestState> {
  const parsed = schema.safeParse({
    ticker: formData.get("ticker"),
    fast: formData.get("fast"),
    slow: formData.get("slow"),
    from: formData.get("from"),
    to: formData.get("to"),
    initialCapital: formData.get("initialCapital"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { ticker, fast, slow, from, to, initialCapital } = parsed.data;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase not configured" };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const bars = await getHistoricalBars(supabase, ticker, from, to);
  if (bars.length < slow) {
    return {
      error: `Only ${bars.length} historical bar(s) for ${ticker} in that range — need at least ${slow}. Run the historical-bar backfill from the Admin page first.`,
    };
  }

  const strategy = smaCrossover(fast, slow);
  const result = runBacktest(bars, strategy, {
    initialCapital,
    slippage: 0.0005,
    commission: 1,
  });
  const metrics = computeMetrics(result, initialCapital);

  await supabase.from("backtest_runs").insert({
    user_id: user.id,
    ticker,
    strategy: strategy.name,
    params: strategy.params,
    from_date: from,
    to_date: to,
    initial_capital: initialCapital,
    metrics,
    equity_curve: result.equityCurve,
  });

  return {
    result: {
      ticker,
      strategy: strategy.name,
      metrics,
      equityCurve: result.equityCurve,
      barCount: bars.length,
      tradeCount: result.trades.length,
    },
  };
}

// -- Walk-forward analysis -------------------------------------------------

const wfSchema = z
  .object({
    ticker: tickerSchema,
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    inSampleBars: z.coerce.number().int().min(30).max(2000),
    outOfSampleBars: z.coerce.number().int().min(10).max(1000),
    initialCapital: z.coerce.number().positive().max(100_000_000),
  })
  .refine((d) => d.from < d.to, {
    message: "Start date must be before the end date",
  });

// Fixed SMA grid the walk-forward optimiser sweeps each in-sample window.
const WF_GRID = smaParamGrid([10, 20, 30, 50], [100, 150, 200]);

export type WalkForwardView = {
  ticker: string;
  barCount: number;
  windows: WalkForwardWindow[];
  aggregateOutOfSample: BacktestMetrics;
  overfittingGap: number;
};

export type WalkForwardState = {
  error?: string;
  report?: WalkForwardView;
};

export async function runWalkForwardAction(
  _prev: WalkForwardState,
  formData: FormData,
): Promise<WalkForwardState> {
  const parsed = wfSchema.safeParse({
    ticker: formData.get("ticker"),
    from: formData.get("from"),
    to: formData.get("to"),
    inSampleBars: formData.get("inSampleBars"),
    outOfSampleBars: formData.get("outOfSampleBars"),
    initialCapital: formData.get("initialCapital"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { ticker, from, to, inSampleBars, outOfSampleBars, initialCapital } =
    parsed.data;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase not configured" };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const bars = await getHistoricalBars(supabase, ticker, from, to);
  if (bars.length < inSampleBars + outOfSampleBars) {
    return {
      error: `Only ${bars.length} bar(s) for ${ticker} — need at least ${
        inSampleBars + outOfSampleBars
      } (one in-sample + one out-of-sample window). Run the backfill or widen the date range.`,
    };
  }

  const report = walkForward(
    bars,
    WF_GRID,
    buildSmaStrategy,
    sharpeObjective,
    { inSampleBars, outOfSampleBars },
    { initialCapital, slippage: 0.0005, commission: 1 },
  );
  if (report.windows.length === 0) {
    return { error: "Not enough bars to form a walk-forward window." };
  }

  return {
    report: {
      ticker,
      barCount: bars.length,
      windows: report.windows,
      aggregateOutOfSample: report.aggregateOutOfSample,
      overfittingGap: report.overfittingGap,
    },
  };
}
