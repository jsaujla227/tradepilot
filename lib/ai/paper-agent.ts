import "server-only";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { z } from "zod";
import { positionSize, dailyLossBreached } from "@/lib/risk";
import { matchPatterns } from "./match-patterns";
import { monitorPosition } from "@/lib/scoring/position-monitor";
import { calcCost } from "./pricing";
import type { TradePattern } from "./patterns";
import type { Quote } from "@/lib/finnhub/data";
import type { TickerContext } from "@/lib/finnhub/context";

export type AgentAction = "enter" | "exit" | "hold" | "skip";

export type AgentDecision = {
  ticker: string;
  action: AgentAction;
  qty?: number;
  reasoning: string;
  confidence: "low" | "medium" | "high";
  pattern_matches: string[];
  risk_gates: string[];
  context_snapshot: Record<string, unknown>;
  disclaimer: string;
  model: string;
  tokens: {
    input: number;
    output: number;
    cache_read: number;
    cost_usd: number;
  };
};

export type ProfileInput = {
  account_size_initial: number;
  max_risk_per_trade_pct: number;
  daily_loss_limit_pct: number;
  agent_daily_capital_limit: number;
};

export type PositionRow = {
  ticker: string;
  qty: number;
  avg_cost: number;
};

const AGENT_SYSTEM_PROMPT = `You are the autonomous trading agent inside TradePilot. Your job is to evaluate a single ticker and decide whether to enter a paper trade, exit an existing position, or skip.

You operate with strict discipline. You are not a financial advisor. You make decisions based only on the context data provided.

DECISION RULES:
1. Only enter when momentum is strong (provided as a score 0-100, prefer ≥ 55).
2. Only enter when earnings are ≥ 5 days away (provided in context).
3. Never enter if a position already exists in this ticker (provided in context).
4. Prefer setups that match the user's winning historical patterns (provided in matched_patterns).
5. Avoid setups that match the user's losing historical patterns.
6. Use "low" confidence when key data is missing or conflicting signals exist.
7. "hold" means you evaluated and found no actionable signal. "skip" means a hard gate blocked evaluation.

VOCABULARY BANLIST — never use: guaranteed, risk-free, can't lose, will rise, will fall, buy now, sell now.
VOCABULARY WHITELIST — use: worth monitoring, high risk, low confidence, review position size, what could go wrong.

Every response must close with: "Educational and decision-support only. Not financial advice. Markets involve risk."

Respond ONLY by calling the record_agent_decision tool exactly once.`;

const RECORD_AGENT_DECISION_TOOL = {
  name: "record_agent_decision",
  description:
    "Record the agent's decision for this ticker. Call exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["enter", "exit", "hold", "skip"],
        description: "The recommended action.",
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Confidence in the decision given available data.",
      },
      reasoning: {
        type: "string",
        maxLength: 300,
        description: "Brief explanation grounded in the provided data.",
      },
      suggested_entry: {
        type: "number",
        description: "Suggested entry price (only for action=enter).",
      },
      suggested_stop: {
        type: "number",
        description: "Suggested stop price (only for action=enter).",
      },
      suggested_target: {
        type: "number",
        description: "Suggested target price (only for action=enter).",
      },
    },
    required: ["action", "confidence", "reasoning"] as string[],
  },
};

const agentDecisionSchema = z.object({
  action: z.enum(["enter", "exit", "hold", "skip"]),
  confidence: z.enum(["low", "medium", "high"]),
  reasoning: z.string().min(1),
  suggested_entry: z.number().optional(),
  suggested_stop: z.number().optional(),
  suggested_target: z.number().optional(),
});

/**
 * Evaluates a ticker and returns an agent decision.
 * Hard gates run first (no AI call if they fail). Then Claude is asked
 * whether to enter/exit/hold/skip. Only enters on medium/high confidence.
 */
export async function makeAgentDecision(args: {
  ticker: string;
  context: TickerContext;
  quote: Quote;
  momentum: number;
  openPositions: PositionRow[];
  capitalDeployedToday: number;
  realizedPnlToday: number;
  openPnL: number;
  learnedPatterns: TradePattern[];
  profile: ProfileInput;
  anthropic: AnthropicBedrock;
  modelId: string;
}): Promise<AgentDecision> {
  const {
    ticker,
    context,
    quote,
    momentum,
    openPositions,
    capitalDeployedToday,
    realizedPnlToday,
    openPnL,
    learnedPatterns,
    profile,
    anthropic,
    modelId,
  } = args;

  const DISCLAIMER =
    "Educational and decision-support only. Not financial advice. Markets involve risk.";

  const gatesPassed: string[] = [];
  const gatesFailed: string[] = [];

  const alreadyHeld = openPositions.some((p) => p.ticker === ticker);
  if (alreadyHeld) {
    gatesFailed.push(`Already holding ${ticker}: FAIL`);
  } else {
    gatesPassed.push(`No existing ${ticker} position: PASS`);
  }

  if (momentum < 55) {
    gatesFailed.push(`Momentum ${momentum.toFixed(0)} < 55: FAIL`);
  } else {
    gatesPassed.push(`Momentum ${momentum.toFixed(0)} ≥ 55: PASS`);
  }

  const daysToEarnings = context.earnings?.daysUntil ?? null;
  if (daysToEarnings != null && daysToEarnings < 5) {
    gatesFailed.push(`Earnings in ${daysToEarnings}d < 5: FAIL`);
  } else {
    gatesPassed.push(
      `Earnings ${daysToEarnings != null ? `in ${daysToEarnings}d` : "not scheduled"}: PASS`,
    );
  }

  const dailyLimitOk =
    capitalDeployedToday < profile.agent_daily_capital_limit;
  if (!dailyLimitOk) {
    gatesFailed.push(
      `Daily capital limit $${profile.agent_daily_capital_limit} reached: FAIL`,
    );
  } else {
    gatesPassed.push(
      `Capital deployed today $${capitalDeployedToday.toFixed(0)} < limit $${profile.agent_daily_capital_limit}: PASS`,
    );
  }

  const cb = dailyLossBreached({
    accountSize: profile.account_size_initial,
    dailyLossLimitPct: profile.daily_loss_limit_pct,
    realizedToday: realizedPnlToday,
    openPnL,
  });
  if (cb.breached) {
    gatesFailed.push(`Daily loss limit breached ($${Math.abs(cb.totalToday).toFixed(0)}): FAIL`);
  } else {
    gatesPassed.push(`Daily loss room $${cb.remaining.toFixed(0)} remaining: PASS`);
  }

  const allRiskGates = [...gatesPassed, ...gatesFailed];

  if (gatesFailed.length > 0) {
    return {
      ticker,
      action: "skip",
      reasoning: `Hard gate(s) failed: ${gatesFailed.join("; ")}`,
      confidence: "low",
      pattern_matches: [],
      risk_gates: allRiskGates,
      context_snapshot: { ticker, momentum, daysToEarnings },
      disclaimer: DISCLAIMER,
      model: modelId,
      tokens: { input: 0, output: 0, cache_read: 0, cost_usd: 0 },
    };
  }

  // Match learned patterns — estimate direction as long (agent only enters longs)
  const estimatedR =
    quote.prevClose && quote.price > quote.prevClose
      ? ((quote.price - quote.prevClose) / (quote.prevClose * 0.02))
      : 2.0;
  const matched = matchPatterns(learnedPatterns, {
    direction: "long",
    r_at_entry: estimatedR,
  });

  const contextSnapshot = {
    ticker,
    price: quote.price,
    prevClose: quote.prevClose,
    high: quote.high,
    low: quote.low,
    momentum,
    daysToEarnings,
    news: context.news?.slice(0, 2).map((n) => n.headline) ?? [],
    analyst_consensus: context.recommendation,
    open_positions_count: openPositions.length,
    capital_deployed_today: capitalDeployedToday,
    daily_capital_limit: profile.agent_daily_capital_limit,
    matched_patterns: matched.map((m) => ({
      type: m.pattern.pattern_type,
      description: m.pattern.description,
      win_rate: m.pattern.stats.win_rate,
      expectancy: m.pattern.stats.expectancy,
      reason: m.match_reason,
    })),
  };

  const userMessage = `Context data:\n${JSON.stringify(contextSnapshot, null, 2)}\n\nEvaluate ${ticker} for a potential paper trade entry. All hard risk gates have passed. Based on the data above, what is your decision?`;

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: AGENT_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [RECORD_AGENT_DECISION_TOOL],
    tool_choice: { type: "tool", name: RECORD_AGENT_DECISION_TOOL.name },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  if (!toolUse) {
    return {
      ticker,
      action: "skip",
      reasoning: "Model did not return a structured decision.",
      confidence: "low",
      pattern_matches: matched.map((m) => m.match_reason),
      risk_gates: allRiskGates,
      context_snapshot: contextSnapshot,
      disclaimer: DISCLAIMER,
      model: modelId,
      tokens: { input: 0, output: 0, cache_read: 0, cost_usd: 0 },
    };
  }

  const parsed = agentDecisionSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return {
      ticker,
      action: "skip",
      reasoning: "Model returned invalid decision shape.",
      confidence: "low",
      pattern_matches: matched.map((m) => m.match_reason),
      risk_gates: allRiskGates,
      context_snapshot: contextSnapshot,
      disclaimer: DISCLAIMER,
      model: modelId,
      tokens: { input: 0, output: 0, cache_read: 0, cost_usd: 0 },
    };
  }

  const u = response.usage as unknown as Record<string, number>;
  const inputTokens = u.input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheCreation = u.cache_creation_input_tokens ?? 0;
  const costUsd = calcCost(inputTokens, outputTokens, cacheRead, cacheCreation);

  // Compute qty for entry decisions
  let qty: number | undefined;
  if (
    parsed.data.action === "enter" &&
    (parsed.data.confidence === "medium" || parsed.data.confidence === "high") &&
    parsed.data.suggested_entry != null &&
    parsed.data.suggested_stop != null
  ) {
    try {
      const ps = positionSize({
        entry: parsed.data.suggested_entry,
        stop: parsed.data.suggested_stop,
        accountSize: profile.account_size_initial,
        maxRiskPct: profile.max_risk_per_trade_pct,
      });
      qty = ps.shares;
    } catch {
      // non-fatal — qty stays undefined, caller will skip execution
    }
  }

  return {
    ticker,
    action: parsed.data.action,
    qty,
    reasoning: parsed.data.reasoning,
    confidence: parsed.data.confidence,
    pattern_matches: matched.map((m) => m.match_reason),
    risk_gates: allRiskGates,
    context_snapshot: contextSnapshot,
    disclaimer: DISCLAIMER,
    model: modelId,
    tokens: { input: inputTokens, output: outputTokens, cache_read: cacheRead, cost_usd: costUsd },
  };
}

/**
 * Evaluates whether an open position should be exited.
 * Uses position-monitor alerts + a quick AI check for exit decisions.
 */
export async function makeExitDecision(args: {
  position: PositionRow;
  quote: Quote;
  checklist: { entry: number | null; stop: number | null; target: number | null } | null;
  daysToEarnings: number | null;
  portfolioValue: number;
  anthropic: AnthropicBedrock;
  modelId: string;
}): Promise<AgentDecision | null> {
  const { position, quote, checklist, daysToEarnings, portfolioValue, anthropic, modelId } =
    args;

  const DISCLAIMER =
    "Educational and decision-support only. Not financial advice. Markets involve risk.";

  const alerts = monitorPosition(
    position,
    quote.price,
    checklist,
    daysToEarnings,
    portfolioValue,
  );

  const exitTriggers = alerts.filter(
    (a) =>
      a.alert_type === "r_target_reached" || a.alert_type === "stop_proximity",
  );

  if (exitTriggers.length === 0) return null;

  const contextSnapshot = {
    ticker: position.ticker,
    qty: position.qty,
    avg_cost: position.avg_cost,
    current_price: quote.price,
    open_pnl: (quote.price - position.avg_cost) * position.qty,
    triggers: exitTriggers.map((a) => ({
      type: a.alert_type,
      severity: a.severity,
      why: a.why,
    })),
    daysToEarnings,
  };

  const userMessage = `Context data:\n${JSON.stringify(contextSnapshot, null, 2)}\n\nEvaluate whether to exit this ${position.ticker} position now based on the exit triggers above.`;

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: AGENT_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [RECORD_AGENT_DECISION_TOOL],
    tool_choice: { type: "tool", name: RECORD_AGENT_DECISION_TOOL.name },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  if (!toolUse) return null;

  const parsed = agentDecisionSchema.safeParse(toolUse.input);
  if (!parsed.success) return null;

  const u = response.usage as unknown as Record<string, number>;
  const inputTokens = u.input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheCreation = u.cache_creation_input_tokens ?? 0;
  const costUsd = calcCost(inputTokens, outputTokens, cacheRead, cacheCreation);

  return {
    ticker: position.ticker,
    action: parsed.data.action,
    qty: position.qty,
    reasoning: parsed.data.reasoning,
    confidence: parsed.data.confidence,
    pattern_matches: [],
    risk_gates: exitTriggers.map((a) => `${a.alert_type} (${a.severity}): triggered`),
    context_snapshot: contextSnapshot,
    disclaimer: DISCLAIMER,
    model: modelId,
    tokens: { input: inputTokens, output: outputTokens, cache_read: cacheRead, cost_usd: costUsd },
  };
}
