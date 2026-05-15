import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { calcSonnetCost } from "@/lib/ai/pricing";

// Daily AI training loop. Called by:
//   app/api/cron/agent-reflect (scheduled, CRON_SECRET)
//   app/api/admin/agent-reflect (manual trigger, user-session auth)
//
// For each user with agent_enabled=true, ask Sonnet to reflect on yesterday's
// autonomous trading activity and propose a numeric momentum-threshold delta
// for tomorrow. The agent reads the most recent lesson at the start of each
// run and folds the delta into its decision threshold.
//
// Why Sonnet, not Opus: the reflection runs every weekday so cost matters;
// Sonnet handles structured JSON output reliably at ~5× lower input cost.

const MIN_THRESHOLD = 50;
const MAX_THRESHOLD = 80;
export const BASE_MOMENTUM_THRESHOLD = 60;
const MAX_DELTA_PER_LESSON = 5;

const REFLECTION_SYSTEM_PROMPT = `You are the daily reflection loop inside TradePilot, a private single-user paper-trading cockpit. The autonomous agent submits paper buy orders for the user when scanner momentum exceeds a threshold (currently around 60 on a 0-100 scale). After every trading day you review what happened and adjust the threshold so the agent learns over time.

CORE RULES — follow these on every response:

1. DATA-GROUNDED: Only reason from the agent log and fill data provided in the user message. If a metric is missing or null, say so. Never fabricate market commentary or invent positions.

2. VOCABULARY BANLIST — never use these words or phrases under any circumstances: academy, course, student, quiz, exam, lesson, module, certificate, enroll, guaranteed, risk-free, can't lose, will rise, will fall, buy now, sell now.

3. TONE: Direct, analytical, educational. No hype. No emojis. No filler. The user reads this once and moves on.

4. LENGTH: Under 200 words for the summary. Be terse — every sentence must add signal.

5. DISCLAIMER: Close with this exact line on its own: "Educational and decision-support only. Not financial advice. Markets involve risk."

TOOL USE — MANDATORY:
You MUST call the "record_threshold_adjustment" tool exactly once with:
- "momentum_threshold_delta": signed integer in the range -5 to +5. Positive means raise the threshold (be pickier next time — too many losers or too much capital deployed on weak signals). Negative means lower it (we missed good setups). Zero means hold steady — the default when there is not enough evidence.
- "rationale": one short sentence (under 200 chars) explaining the delta. Must reference at least one concrete data point from the log.
- "summary": 100-200 word reflection on the day. Cover: how many buys, any stops hit, realized P&L if any, what pattern (if any) is forming across the week's lessons. End with the disclaimer line on its own.

DECISION HEURISTICS — how to pick the delta:
- 3+ buys filled, all currently profitable → 0 or -1 (stay aggressive, the signal is working).
- 3+ buys filled, majority losing → +2 or +3 (raise the bar, momentum signal is noisy today).
- A stop was hit on a buy from a recent day → +1 or +2 (recent signal quality was poor).
- Zero buys for 3+ days running and threshold is already above 60 → -1 or -2 (the bar may be too high to catch any signal at all).
- Threshold currently at the floor (50) → never go more negative.
- Threshold currently at the ceiling (80) → never go more positive.

CONTEXT:
- Position size and stop level are decided by the existing risk engine; you do NOT adjust those.
- The agent runs once per weekday morning. Your delta affects tomorrow's run only.
- Threshold floor is 50, ceiling is 80. The base is 60. Cumulative drift is bounded.
- All trades are paper. Real money is gated separately by performance criteria — this loop is purely for training the paper agent.`;

const RECORD_LESSON_TOOL = {
  name: "record_threshold_adjustment",
  description:
    "Record the day's reflection and the numeric adjustment to the agent's momentum threshold. Call exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      momentum_threshold_delta: {
        type: "integer",
        minimum: -5,
        maximum: 5,
        description:
          "Signed change to the momentum threshold. Positive = pickier, negative = looser, zero = hold.",
      },
      rationale: {
        type: "string",
        maxLength: 200,
        description:
          "One short sentence justifying the delta, referencing concrete log data.",
      },
      summary: {
        type: "string",
        maxLength: 1500,
        description:
          "100-200 word reflection on the day. Ends with the required disclaimer line.",
      },
    },
    required: ["momentum_threshold_delta", "rationale", "summary"] as string[],
  },
};

type LessonInput = {
  momentum_threshold_delta: number;
  rationale: string;
  summary: string;
};

export type ReflectionResult = {
  userId: string;
  status: string;
  delta?: number;
  costUsd?: number;
};

type AgentLogRow = {
  event_type: string;
  ticker: string | null;
  qty: number | null;
  order_id: string | null;
  reason: string;
  created_at: string;
};

type OrderRow = {
  id: string;
  ticker: string;
  side: string;
  qty: number;
  filled_price: number | null;
  filled_qty: number | null;
  filled_at: string | null;
  note: string | null;
};

function clampDelta(delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  const rounded = Math.round(delta);
  if (rounded > MAX_DELTA_PER_LESSON) return MAX_DELTA_PER_LESSON;
  if (rounded < -MAX_DELTA_PER_LESSON) return -MAX_DELTA_PER_LESSON;
  return rounded;
}

/**
 * Read the most recent lesson and compute the effective momentum threshold
 * for today's autonomous run. Clamps to [MIN_THRESHOLD, MAX_THRESHOLD].
 */
export async function getEffectiveMomentumThreshold(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>,
  userId: string,
): Promise<{ threshold: number; sourceLessonId: string | null }> {
  const { data } = await admin
    .from("agent_lessons")
    .select("id, threshold_adjustments")
    .eq("user_id", userId)
    .order("lesson_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return { threshold: BASE_MOMENTUM_THRESHOLD, sourceLessonId: null };
  }

  const adj = (data.threshold_adjustments ?? {}) as Record<string, unknown>;
  const delta = clampDelta(Number(adj["momentum_threshold_delta"] ?? 0));
  const raw = BASE_MOMENTUM_THRESHOLD + delta;
  const threshold = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, raw));
  return { threshold, sourceLessonId: data.id as string };
}

export async function runDailyReflection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>,
): Promise<ReflectionResult[]> {
  const today = new Date();
  const lessonDate = today.toISOString().slice(0, 10);
  // Window: 24h ending now. Cron is scheduled after market close + snapshot,
  // so this captures the full trading day's activity.
  const periodEnd = today.toISOString();
  const periodStart = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const results: ReflectionResult[] = [];

  const model = process.env.BEDROCK_SONNET_MODEL_ID ?? process.env.BEDROCK_MODEL_ID;
  if (!model) {
    return [{ userId: "*", status: "skipped: BEDROCK_MODEL_ID not configured" }];
  }

  const { data: profiles, error: profileErr } = await admin
    .from("profiles")
    .select("user_id")
    .eq("agent_enabled", true);

  if (profileErr || !profiles || profiles.length === 0) {
    return results;
  }

  const anthropic = new AnthropicBedrock({
    awsRegion: process.env.AWS_REGION ?? "us-east-2",
  });

  for (const profile of profiles) {
    const userId = profile.user_id as string;
    const result: ReflectionResult = { userId, status: "ok" };

    try {
      // Pull the day's agent log + the filled orders the agent placed.
      const [logRes, orderRes, lessonHistoryRes] = await Promise.all([
        admin
          .from("agent_log")
          .select("event_type, ticker, qty, order_id, reason, created_at")
          .eq("user_id", userId)
          .gte("created_at", periodStart)
          .lte("created_at", periodEnd)
          .order("created_at", { ascending: true }),
        admin
          .from("orders")
          .select("id, ticker, side, qty, filled_price, filled_qty, filled_at, note")
          .eq("user_id", userId)
          .gte("filled_at", periodStart)
          .lte("filled_at", periodEnd)
          .like("note", "Agent:%")
          .order("filled_at", { ascending: true }),
        admin
          .from("agent_lessons")
          .select("lesson_date, threshold_adjustments")
          .eq("user_id", userId)
          .order("lesson_date", { ascending: false })
          .limit(5),
      ]);

      const log = (logRes.data ?? []) as AgentLogRow[];
      const orders = (orderRes.data ?? []) as OrderRow[];

      if (log.length === 0 && orders.length === 0) {
        result.status = "skipped: no agent activity in window";
        results.push(result);
        continue;
      }

      const { threshold: currentThreshold } = await getEffectiveMomentumThreshold(
        admin,
        userId,
      );

      const recentDeltas = (lessonHistoryRes.data ?? []).map((row) => ({
        date: row.lesson_date as string,
        delta:
          ((row.threshold_adjustments as Record<string, unknown> | null) ?? {})[
            "momentum_threshold_delta"
          ] ?? 0,
      }));

      const userPayload = {
        lessonDate,
        currentThreshold,
        baseThreshold: BASE_MOMENTUM_THRESHOLD,
        thresholdFloor: MIN_THRESHOLD,
        thresholdCeiling: MAX_THRESHOLD,
        recentDeltas,
        agentLog: log,
        agentOrders: orders.map((o) => ({
          ticker: o.ticker,
          side: o.side,
          qty: Number(o.qty),
          filled_price: o.filled_price != null ? Number(o.filled_price) : null,
          filled_qty: o.filled_qty != null ? Number(o.filled_qty) : null,
          filled_at: o.filled_at,
          note: o.note,
        })),
      };

      const response = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: REFLECTION_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [RECORD_LESSON_TOOL],
        tool_choice: { type: "tool", name: RECORD_LESSON_TOOL.name },
        messages: [
          {
            role: "user",
            content: `Reflection data:\n${JSON.stringify(userPayload, null, 2)}\n\nPlease produce today's reflection and threshold adjustment.`,
          },
        ],
      });

      const toolUse = response.content.find(
        (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
      );
      if (!toolUse) {
        result.status = "error: model did not call record_threshold_adjustment";
        results.push(result);
        continue;
      }
      const input = toolUse.input as Partial<LessonInput>;
      const delta = clampDelta(Number(input.momentum_threshold_delta ?? 0));
      const rationale = String(input.rationale ?? "").slice(0, 200);
      const summary = String(input.summary ?? "").slice(0, 4000);

      const u = response.usage as unknown as Record<string, number>;
      const inputTokens = u.input_tokens ?? 0;
      const outputTokens = u.output_tokens ?? 0;
      const cacheReadInputTokens = u.cache_read_input_tokens ?? 0;
      const cacheCreationInputTokens = u.cache_creation_input_tokens ?? 0;
      const costUsd = calcSonnetCost(
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
      );

      const { error: upsertErr } = await admin.from("agent_lessons").upsert(
        {
          user_id: userId,
          lesson_date: lessonDate,
          period_start: periodStart,
          period_end: periodEnd,
          summary,
          threshold_adjustments: {
            momentum_threshold_delta: delta,
            rationale,
          },
          source_event_count: log.length + orders.length,
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_input_tokens: cacheReadInputTokens,
          cache_creation_input_tokens: cacheCreationInputTokens,
          cost_usd: costUsd,
        },
        { onConflict: "user_id,lesson_date" },
      );

      if (upsertErr) {
        result.status = `error: ${upsertErr.message}`;
        results.push(result);
        continue;
      }

      result.delta = delta;
      result.costUsd = costUsd;
    } catch (err) {
      result.status = `error: ${String(err)}`;
    }

    results.push(result);
  }

  return results;
}
