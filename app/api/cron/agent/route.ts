import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getQuote, getQuotesMap } from "@/lib/finnhub/data";
import { getTickerContext, getEarningsContext } from "@/lib/finnhub/context";
import { makeAgentDecision, makeExitDecision } from "@/lib/ai/paper-agent";
import { getBrokerAdapter } from "@/lib/broker";

// Autonomous paper agent — requires Authorization: Bearer ${CRON_SECRET}
// Scheduled every 15 min Mon–Fri 13:35–20:45 UTC (9:35 AM–3:45 PM ET).
// Scans top momentum tickers, makes enter/exit decisions, executes paper trades.
// All decisions (including skips) are logged to agent_trades for full audit.

function isValidCronAuth(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = `Bearer ${secret}`;
  try {
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret ||
    !isValidCronAuth(req.headers.get("authorization"), cronSecret)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) {
    return new Response("BEDROCK_MODEL_ID not configured", { status: 503 });
  }

  const admin = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  // Fetch users with agent enabled
  const { data: agentProfiles } = await admin
    .from("profiles")
    .select(
      "user_id, account_size_initial, max_risk_per_trade_pct, daily_loss_limit_pct, agent_daily_capital_limit, ai_token_budget_monthly",
    )
    .eq("agent_enabled", true);

  if (!agentProfiles || agentProfiles.length === 0) {
    return Response.json({ ok: true, reason: "No agent-enabled users" });
  }

  const anthropic = new AnthropicBedrock({
    awsRegion: process.env.AWS_REGION ?? "us-east-2",
  });

  let totalDecisions = 0;
  let totalOrdersPlaced = 0;

  for (const profile of agentProfiles as Array<{
    user_id: string;
    account_size_initial: number;
    max_risk_per_trade_pct: number;
    daily_loss_limit_pct: number;
    agent_daily_capital_limit: number;
    ai_token_budget_monthly: number;
  }>) {
    // Check monthly token budget
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const { data: usageRows } = await admin
      .from("ai_notes")
      .select("input_tokens, output_tokens")
      .eq("user_id", profile.user_id)
      .gte("created_at", startOfMonth.toISOString());
    const usedTokens = (usageRows ?? []).reduce(
      (sum: number, r: { input_tokens: number; output_tokens: number }) =>
        sum + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
      0,
    );
    if (usedTokens >= profile.ai_token_budget_monthly) continue;

    // Capital deployed today (sum of agent entry orders)
    const { data: todayOrders } = await admin
      .from("agent_trades")
      .select("context_snapshot")
      .eq("user_id", profile.user_id)
      .eq("action", "enter")
      .gte("decided_at", `${today}T00:00:00Z`);

    const capitalDeployedToday = (todayOrders ?? []).reduce(
      (sum: number, row: { context_snapshot: Record<string, unknown> }) => {
        const snap = row.context_snapshot;
        const price = Number(snap.price ?? 0);
        const qty = Number(snap.qty ?? 0);
        return sum + price * qty;
      },
      0,
    );

    // Open positions
    const { data: openPositions } = await admin
      .from("positions")
      .select("ticker, qty, avg_cost")
      .eq("user_id", profile.user_id)
      .eq("is_closed", false);

    const positions = (openPositions ?? []) as Array<{
      ticker: string;
      qty: number;
      avg_cost: number;
    }>;

    // Today's realized P&L
    const { data: closedToday } = await admin
      .from("positions")
      .select("realized_pnl")
      .eq("user_id", profile.user_id)
      .eq("is_closed", true)
      .gte("closed_at", `${today}T00:00:00Z`);
    const realizedPnlToday = (closedToday ?? []).reduce(
      (sum: number, r: { realized_pnl: number }) => sum + Number(r.realized_pnl ?? 0),
      0,
    );

    // Open P&L
    const positionTickers = positions.map((p) => p.ticker);
    const quotesMapForPnl = positionTickers.length
      ? await getQuotesMap(positionTickers)
      : {};
    const openPnL = positions.reduce((sum, p) => {
      const q = quotesMapForPnl[p.ticker];
      return sum + (q ? (q.price - Number(p.avg_cost)) * Number(p.qty) : 0);
    }, 0);

    // Learned patterns for this user
    const { data: patternRows } = await admin
      .from("learned_patterns")
      .select("pattern_type, description, conditions, stats, sample_count")
      .eq("user_id", profile.user_id);

    const learnedPatterns = ((patternRows ?? []) as Array<{
      pattern_type: "winning" | "losing" | "neutral";
      description: string;
      conditions: Record<string, unknown>;
      stats: { win_rate: number; avg_r: number; expectancy: number; sample_count: number };
      sample_count: number;
    }>).map((p) => ({
      pattern_type: p.pattern_type,
      description: p.description,
      conditions: p.conditions as Parameters<typeof makeAgentDecision>[0]["learnedPatterns"][0]["conditions"],
      stats: p.stats,
    }));

    // Top 10 scanner results from today
    const { data: scanResults } = await admin
      .from("scanner_results")
      .select("ticker, momentum")
      .eq("user_id", profile.user_id)
      .eq("scan_date", today)
      .order("momentum", { ascending: false })
      .limit(10);

    const adapter = await getBrokerAdapter(profile.user_id);

    // -- Entry evaluation for top scanner tickers ---------------------------
    for (const scan of (scanResults ?? []) as Array<{
      ticker: string;
      momentum: number;
    }>) {
      try {
        const { quote } = await getQuote(scan.ticker);
        const context = await getTickerContext(scan.ticker);

        const decision = await makeAgentDecision({
          ticker: scan.ticker,
          context,
          quote,
          momentum: scan.momentum,
          openPositions: positions,
          capitalDeployedToday,
          realizedPnlToday,
          openPnL,
          learnedPatterns,
          profile,
          anthropic,
          modelId,
        });

        let orderId: string | null = null;

        // Execute if action is enter with medium/high confidence and qty available
        if (
          decision.action === "enter" &&
          (decision.confidence === "medium" || decision.confidence === "high") &&
          decision.qty != null &&
          decision.qty > 0
        ) {
          try {
            const order = await adapter.submitOrder({
              ticker: scan.ticker,
              side: "buy",
              qty: decision.qty,
              note: `Agent entry: ${decision.reasoning.slice(0, 100)}`,
            });
            orderId = order.id;
            totalOrdersPlaced++;
          } catch (err) {
            console.error(`[agent] order failed for ${scan.ticker}:`, err);
          }
        }

        // Log decision
        await admin.from("agent_trades").insert({
          user_id: profile.user_id,
          ticker: decision.ticker,
          action: decision.action,
          order_id: orderId,
          confidence: decision.confidence,
          reasoning: decision.reasoning,
          pattern_matches: decision.pattern_matches,
          risk_gates: decision.risk_gates,
          context_snapshot: {
            ...decision.context_snapshot,
            qty: decision.qty,
          },
          model: decision.model,
          input_tokens: decision.tokens.input,
          output_tokens: decision.tokens.output,
          cost_usd: decision.tokens.cost_usd,
        });

        totalDecisions++;
      } catch (err) {
        console.error(`[agent] entry eval failed for ${scan.ticker}:`, err);
      }
    }

    // -- Exit evaluation for open positions ----------------------------------
    const positionQuotes = positionTickers.length
      ? await getQuotesMap(positionTickers)
      : {};
    const portfolioValue = positions.reduce((sum, p) => {
      const q = positionQuotes[p.ticker];
      return sum + (q ? q.price * Number(p.qty) : 0);
    }, 0);

    // Latest checklist per ticker
    const { data: checklistRows } = await admin
      .from("trade_checklists")
      .select("ticker, entry, stop, target")
      .eq("user_id", profile.user_id)
      .order("id", { ascending: false });

    const checklistByTicker = new Map<
      string,
      { entry: number | null; stop: number | null; target: number | null }
    >();
    for (const c of checklistRows ?? []) {
      if (!checklistByTicker.has(c.ticker)) {
        checklistByTicker.set(c.ticker, {
          entry: Number(c.entry) || null,
          stop: Number(c.stop) || null,
          target: Number(c.target) || null,
        });
      }
    }

    for (const position of positions) {
      const quote = positionQuotes[position.ticker];
      if (!quote) continue;

      const checklist = checklistByTicker.get(position.ticker) ?? null;
      const earningsCtx = await getEarningsContext(position.ticker).catch(
        () => null,
      );
      const daysToEarnings = earningsCtx?.daysUntil ?? null;

      try {
        const decision = await makeExitDecision({
          position: {
            ticker: position.ticker,
            qty: Number(position.qty),
            avg_cost: Number(position.avg_cost),
          },
          quote,
          checklist,
          daysToEarnings,
          portfolioValue,
          anthropic,
          modelId,
        });

        if (!decision) continue;

        let orderId: string | null = null;

        if (
          decision.action === "exit" &&
          (decision.confidence === "medium" || decision.confidence === "high") &&
          decision.qty != null &&
          decision.qty > 0
        ) {
          try {
            const order = await adapter.submitOrder({
              ticker: position.ticker,
              side: "sell",
              qty: decision.qty,
              note: `Agent exit: ${decision.reasoning.slice(0, 100)}`,
            });
            orderId = order.id;
            totalOrdersPlaced++;
          } catch (err) {
            console.error(
              `[agent] exit order failed for ${position.ticker}:`,
              err,
            );
          }
        }

        await admin.from("agent_trades").insert({
          user_id: profile.user_id,
          ticker: decision.ticker,
          action: decision.action,
          order_id: orderId,
          confidence: decision.confidence,
          reasoning: decision.reasoning,
          pattern_matches: decision.pattern_matches,
          risk_gates: decision.risk_gates,
          context_snapshot: decision.context_snapshot,
          model: decision.model,
          input_tokens: decision.tokens.input,
          output_tokens: decision.tokens.output,
          cost_usd: decision.tokens.cost_usd,
        });

        totalDecisions++;
      } catch (err) {
        console.error(
          `[agent] exit eval failed for ${position.ticker}:`,
          err,
        );
      }
    }
  }

  return Response.json({
    ok: true,
    date: today,
    decisions: totalDecisions,
    orders_placed: totalOrdersPlaced,
  });
}
