import { NextRequest } from "next/server";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
- Name each input (trend, volatility, R-multiple, liquidity) and its weighted contribution.
- Show the math where possible. Example: "Day range 2.1% of price → volatility score 0.58 (target: low day range = stable = high score)."
- Identify the weakest scoring input and explain what would need to change for it to improve.
- Close with one concrete question the user should ask themselves about this setup.
- Scoring weights for reference: trend 30%, volatility 25%, R-multiple 30%, liquidity 15%.

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

CONTEXT ABOUT THE APP:
- TradePilot is a private cockpit. All trades are paper trades. No real money involved.
- Risk engine formulas: positionSize = (accountSize × riskPct / 100) / (entry − stop); rMultiple = (target − entry) / (entry − stop); circuit breaker fires when daily loss exceeds dailyLossLimitPct of account size.
- Scoring engine inputs and weights: trend (day momentum vs prevClose, 30%), volatility (day high−low range / price, inverted, 25%), R-multiple (|target−entry| / |entry−stop| / 3, capped 0–1, 30%), liquidity (fixed 0.5 on Finnhub free tier — bars unavailable, 15%). Total score = weighted sum × 100, range 0–100.
- Every score input has a "Why?" inline expansion. Your explanations should match or exceed that level of detail.
- Disclaimer footer appears on every app page: "Educational and decision-support only. Not financial advice. Markets involve risk."
- The user configured their own account size, max risk per trade %, and daily loss limit % in Settings. Always frame risk numbers relative to those user-set parameters — never against abstract benchmarks.
- Finnhub free tier is the market data source. Only quote fields (price, prevClose, high, low) are available. OHLC bars and volume are not available. Liquidity score is therefore always 0.5 (neutral placeholder).

OUTPUT FORMAT:
- Start directly with the explanation. No preamble, no greeting.
- Use plain prose with short paragraphs.
- If showing math, use inline notation. Example: "R = ($18.50 − $15.00) / ($15.00 − $13.50) = 2.33"
- Bullet points are fine for lists of 3+ items.
- End every response with the disclaimer on its own line, separated by a blank line.`;

// Bedrock on-demand pricing per million tokens (us-west-2, Claude 3.5 Sonnet v2)
const PRICING = {
  "us.anthropic.claude-3-5-sonnet-20241022-v2:0": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 },
} as const;

function calcCost(
  model: keyof typeof PRICING,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): number {
  const p = PRICING[model];
  return (
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheReadTokens * p.cacheRead +
      cacheCreationTokens * p.cacheCreation) /
    1_000_000
  );
}

const bodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  dataProvided: z.record(z.string(), z.unknown()).default({}),
});

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

  const { prompt, dataProvided } = parsed.data;

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

  const anthropic = new AnthropicBedrock({
    awsRegion: process.env.AWS_REGION ?? "us-west-2",
  });
  const model = "us.anthropic.claude-3-5-sonnet-20241022-v2:0";

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
    messages: [
      {
        role: "user",
        content: `Context data:\n${JSON.stringify(dataProvided, null, 2)}\n\n${prompt}`,
      },
    ],
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
          model,
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
