import { NextRequest } from "next/server";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acquireLock, releaseLock } from "@/lib/redis";
import { calcCost } from "@/lib/ai/pricing";
import { z } from "zod";

// System prompt must exceed 1024 tokens so Anthropic prompt caching triggers.
const SYSTEM_PROMPT = `You are the AI helper inside TradePilot, a private single-user paper-trading cockpit. Your role is to help the user understand their positions, manage risk, and learn from their own trading decisions. You are NOT a financial advisor and you must never act like one.

CORE RULES — follow these on every response:

1. DISCLAIMER: Every response must close with this exact line on its own: "Educational and decision-support only. Not financial advice. Markets involve risk."

2. DATA-GROUNDED: Only reason from the context data provided in the user message. If a data point is missing or null, say so explicitly. Never fabricate market commentary, price targets, or data you were not given.

3. VOCABULARY BANLIST — never use these words or phrases under any circumstances: academy, course, student, quiz, exam, lesson, module, certificate, enroll, guaranteed, risk-free, can't lose, will rise, will fall, buy now, sell now.

4. VOCABULARY WHITELIST — use these where relevant: my portfolio, my watchlist, my risk, my journal, AI helper, worth monitoring, high risk, low confidence, review position size, what could go wrong.

5. TONE: Direct, analytical, educational. No hype. No emojis. No filler phrases ("Great question!", "Certainly!", "Of course!"). Just useful signal.

6. LENGTH: Under 300 words unless complexity demands more. If longer, use clear short headings.

7. TRANSPARENCY: The user can see your model name, the exact data you were given, and the token cost of this response. Be honest about uncertainty. If you are not sure, say so.

WHEN EXPLAINING A SCORE:
- Name each input (trend, volatility, R-multiple, liquidity, event risk) and its weighted contribution.
- Show the math where possible. Example: "Day range 2.1% of price → volatility score 0.58 (target: low day range = stable = high score)."
- Identify the weakest scoring input and explain what would need to change for it to improve.
- Close with one concrete question the user should ask themselves about this setup.
- Watchlist scoring weights: trend 25%, volatility 20%, R-multiple 25%, liquidity 10%, event risk 20%.
- Scanner momentum weights: trend 45%, volatility 35%, event risk 20%.

WHEN EXPLAINING A RISK WARNING:
- State the rule that triggered. Example: "AAPL is 31% of total portfolio value, above the 25% concentration threshold."
- Show the math: current weight, threshold, excess.
- Explain the risk in plain terms: what scenario would this concentration hurt the most?
- Suggest one specific thing the user could evaluate — not a recommendation, a question to consider.

WHEN EXPLAINING A HOLDING OR OPEN POSITION:
- Summarize the key numbers: ticker, qty, avg cost, current price, open P&L (absolute and percentage).
- Frame position size risk: what percent of the portfolio does this represent? What is the dollar exposure?
- If stop or target data is available, compute the R-multiple.
- Raise one "what could go wrong" question specific to this position.
- Note if the position is a winner or loser relative to cost basis, without implying what to do about it.

WHEN REVIEWING JOURNAL ENTRIES (monthly deep review — Opus 4.7 mode):
- Identify patterns across wins and losses: setup quality, holding period, R-multiples achieved vs planned.
- Compute and surface from the provided data: win rate, average R, expectancy = winRate × avgWin − lossRate × avgLoss.
- Name the single biggest edge (what worked most consistently) and single biggest leak (what hurt most consistently).
- Give 2–3 specific, actionable observations grounded in the actual review text provided. Quote or paraphrase the user's own words where relevant.
- No generic trading advice. Everything must reference the actual journal data in the context.

WHEN ASKED FOR A STRUCTURED ASSESSMENT (tool-use mode):
- A "record_assessment" tool will be available. Always call it exactly once with the six required fields.
- "confidence" is the strength of the setup given the data shown — low/medium/high. Be conservative; default to low when key data is missing.
- "primary_catalyst" names the single most likely driver of price movement. Be concrete (earnings beat, breakout from resistance, sector rotation).
- "primary_risk" names the single most likely failure mode. Be concrete (earnings miss, broader market drawdown, support break).
- "exit_triggers" are 2–4 named conditions that should force a re-evaluation. Use price levels, time-based stops, or news events. Each ≤80 chars.
- "holding_period_days" is your suggested look-out window, integer 1–365.
- "reasoning" is a brief ≤300-char explanation, grounded in the provided data. Acknowledge missing data when relevant.
- Never use banned vocabulary inside the tool call either — the same rules apply to tool inputs.

CONTEXT ABOUT THE APP:
- TradePilot is a private cockpit. All trades are paper trades. No real money involved.
- Risk engine formulas: positionSize = (accountSize × riskPct / 100) / (entry − stop); rMultiple = (target − entry) / (entry − stop); circuit breaker fires when daily loss exceeds dailyLossLimitPct of account size.
- Scoring engine inputs and weights: trend (day momentum vs prevClose), volatility (day high−low range / price, inverted), R-multiple (|target−entry| / |entry−stop| / 3, capped 0–1), liquidity (fixed 0.5 on Finnhub free tier — bars unavailable), event risk (days until next earnings; ≤3 → 0, ≤5 → 0.5, >5 → 1). Watchlist composite = 25/20/25/10/20 weighted sum × 100; scanner momentum = 45/35/20.
- Every score input has a "Why?" inline expansion. Your explanations should match or exceed that level of detail.
- Disclaimer footer appears on every app page: "Educational and decision-support only. Not financial advice. Markets involve risk."
- The user configured their own account size, max risk per trade %, and daily loss limit % in Settings. Always frame risk numbers relative to those user-set parameters — never against abstract benchmarks.
- Finnhub free tier is the market data source. Quote fields (price, prevClose, high, low), earnings calendar, company news, and analyst recommendations are available. OHLC bars and volume are not. Liquidity score is therefore always 0.5 (neutral placeholder).

OUTPUT FORMAT (free-text mode):
- Start directly with the explanation. No preamble, no greeting.
- Use plain prose with short paragraphs.
- If showing math, use inline notation. Example: "R = ($18.50 − $15.00) / ($15.00 − $13.50) = 2.33"
- Bullet points are fine for lists of 3+ items.
- End every response with the disclaimer on its own line, separated by a blank line.`;

const bodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  dataProvided: z.record(z.string(), z.unknown()).default({}),
  mode: z.enum(["explain", "assess"]).default("explain"),
});

// Schema mirror of the tool input for runtime validation. Keep in sync with
// the `record_assessment` tool definition below.
const assessmentSchema = z.object({
  confidence: z.enum(["low", "medium", "high"]),
  primary_catalyst: z.string().min(1).max(80),
  primary_risk: z.string().min(1).max(80),
  exit_triggers: z.array(z.string().min(1).max(80)).min(2).max(4),
  holding_period_days: z.number().int().min(1).max(365),
  reasoning: z.string().min(1).max(300),
});

const RECORD_ASSESSMENT_TOOL = {
  name: "record_assessment",
  description:
    "Record a structured assessment for the ticker or position described in the user message. Call exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Strength of the setup given the available data.",
      },
      primary_catalyst: {
        type: "string",
        maxLength: 80,
        description: "Single most likely driver of price movement.",
      },
      primary_risk: {
        type: "string",
        maxLength: 80,
        description: "Single most likely failure mode.",
      },
      exit_triggers: {
        type: "array",
        items: { type: "string", maxLength: 80 },
        minItems: 2,
        maxItems: 4,
        description:
          "Named conditions that should force a re-evaluation (price levels, time stops, news events).",
      },
      holding_period_days: {
        type: "integer",
        minimum: 1,
        maximum: 365,
        description: "Suggested look-out window in days.",
      },
      reasoning: {
        type: "string",
        maxLength: 300,
        description: "Brief explanation grounded in the provided data.",
      },
    },
    required: [
      "confidence",
      "primary_catalyst",
      "primary_risk",
      "exit_triggers",
      "holding_period_days",
      "reasoning",
    ] as string[],
  },
};

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return new Response("Supabase not configured", { status: 503 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return new Response("Invalid request", { status: 400 });

  const { prompt, dataProvided, mode } = parsed.data;

  // Monthly budget check
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("ai_token_budget_monthly")
    .eq("user_id", user.id)
    .maybeSingle();

  const budget = (profileRow?.ai_token_budget_monthly as number | null) ?? 100_000;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: usageRows } = await supabase
    .from("ai_notes")
    .select("input_tokens, output_tokens")
    .eq("user_id", user.id)
    .gte("created_at", startOfMonth.toISOString());

  const usedTokens = (usageRows ?? []).reduce(
    (sum, r) => sum + ((r.input_tokens as number) ?? 0) + ((r.output_tokens as number) ?? 0),
    0,
  );

  if (usedTokens >= budget) {
    return new Response(
      JSON.stringify({ error: "Monthly token budget exceeded", usedTokens, budget }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) return new Response("BEDROCK_MODEL_ID not configured", { status: 503 });

  // Prevent concurrent AI calls from the same user racing through the budget check.
  const lockKey = `tp:ai-inflight:${user.id}`;
  const locked = await acquireLock(lockKey, 120);
  if (!locked) {
    return new Response(
      JSON.stringify({ error: "Another AI request is already in progress" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  const anthropic = new AnthropicBedrock({
    awsRegion: process.env.AWS_REGION ?? "us-east-2",
  });
  const model = modelId;

  const userMessage = `Context data:\n${JSON.stringify(dataProvided, null, 2)}\n\n${prompt}`;

  if (mode === "assess") {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [RECORD_ASSESSMENT_TOOL],
        tool_choice: { type: "tool", name: RECORD_ASSESSMENT_TOOL.name },
        messages: [{ role: "user", content: userMessage }],
      });

      const toolUse = response.content.find(
        (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
      );
      if (!toolUse) {
        return new Response(
          JSON.stringify({ error: "Model did not return a structured assessment" }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }

      const validated = assessmentSchema.safeParse(toolUse.input);
      if (!validated.success) {
        return new Response(
          JSON.stringify({
            error: "Model returned invalid assessment shape",
            issues: validated.error.issues,
          }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }

      const u = response.usage as unknown as Record<string, number>;
      const inputTokens = u.input_tokens ?? 0;
      const outputTokens = u.output_tokens ?? 0;
      const cacheReadInputTokens = u.cache_read_input_tokens ?? 0;
      const cacheCreationInputTokens = u.cache_creation_input_tokens ?? 0;

      const costUsd = calcCost(
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
      );

      await supabase.from("ai_notes").insert({
        user_id: user.id,
        prompt,
        response: JSON.stringify(validated.data),
        model,
        data_provided: dataProvided,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cacheReadInputTokens,
        cache_creation_input_tokens: cacheCreationInputTokens,
        cost_usd: costUsd,
      });

      return new Response(
        JSON.stringify({
          mode: "assess",
          assessment: validated.data,
          usage: {
            inputTokens,
            outputTokens,
            cacheReadInputTokens,
            cacheCreationInputTokens,
            costUsd,
            model,
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    } finally {
      await releaseLock(lockKey);
    }
  }

  // -- Explain (streaming text) mode -----------------------------------------

  const stream = anthropic.messages.stream({
    model,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
  });

  const encoder = new TextEncoder();
  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInputTokens = 0;
  let cacheCreationInputTokens = 0;

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullText += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
          if (event.type === "message_start" && event.message.usage) {
            const u = event.message.usage as unknown as Record<string, number>;
            inputTokens = u.input_tokens ?? 0;
            cacheReadInputTokens = u.cache_read_input_tokens ?? 0;
            cacheCreationInputTokens = u.cache_creation_input_tokens ?? 0;
          }
          if (event.type === "message_delta" && event.usage) {
            outputTokens = event.usage.output_tokens ?? 0;
          }
        }

        const costUsd = calcCost(
          inputTokens,
          outputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens,
        );

        await supabase.from("ai_notes").insert({
          user_id: user.id,
          prompt,
          response: fullText,
          model,
          data_provided: dataProvided,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_input_tokens: cacheReadInputTokens,
          cache_creation_input_tokens: cacheCreationInputTokens,
          cost_usd: costUsd,
        });

        controller.enqueue(
          encoder.encode(
            `\n\n__USAGE__:${JSON.stringify({
              inputTokens,
              outputTokens,
              cacheReadInputTokens,
              cacheCreationInputTokens,
              costUsd,
              model,
            })}`,
          ),
        );
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        await releaseLock(lockKey);
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
