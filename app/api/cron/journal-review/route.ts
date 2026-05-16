import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { calcCost } from "@/lib/ai/pricing";

// Monthly deep journal review cron — requires Authorization: Bearer ${CRON_SECRET}
// Scheduled via Vercel Cron (vercel.json). Model: Claude 3 Opus via Bedrock.

const CRON_SYSTEM_PROMPT = `You are the AI helper inside TradePilot performing a monthly journal review. Your job is to analyze the user's last 30 days of closed trade reviews and surface actionable patterns. You are NOT a financial advisor.

Rules:
- Only reason from the journal data provided. Never fabricate.
- Never use: academy, course, student, quiz, exam, lesson, module, certificate, enroll, guaranteed, risk-free, can't lose, will rise, will fall, buy now, sell now.
- Be direct, analytical, educational. No hype. No emojis. No filler.
- Every response closes with: "Educational and decision-support only. Not financial advice. Markets involve risk."

Structure your response as:
1. SUMMARY STATS: Win rate, average win, average loss, expectancy — computed from the data.
2. BIGGEST EDGE: The single pattern that appeared most in winning trades.
3. BIGGEST LEAK: The single pattern that appeared most in losing trades.
4. THREE OBSERVATIONS: Specific, grounded in the actual review text. Quote or paraphrase the user's own words.
5. ONE QUESTION: The most important question the user should sit with this month.`;

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

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isValidCronAuth(req.headers.get("authorization"), cronSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = supabaseAdmin();
  if (!admin) {
    return new Response("Supabase admin not configured", { status: 503 });
  }

  // Get all users with profiles
  const { data: profiles, error: profileErr } = await admin
    .from("profiles")
    .select("user_id");

  if (profileErr || !profiles) {
    return new Response("Failed to fetch profiles", { status: 500 });
  }

  const model = process.env.BEDROCK_MODEL_ID;
  if (!model) {
    return new Response("BEDROCK_MODEL_ID not configured", { status: 503 });
  }

  const anthropic = new AnthropicBedrock({
    awsRegion: process.env.AWS_REGION ?? "us-east-2",
  });
  const results: { userId: string; status: string; tokens?: number }[] = [];

  for (const { user_id } of profiles) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Per-user monthly token-budget gate. Mirrors /api/ai/route.ts so the
    // monthly Opus review can't silently overdraw a user's allowance.
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [{ data: profileRow }, { data: usageRows }, { data: reviews }] =
      await Promise.all([
        admin
          .from("profiles")
          .select("ai_token_budget_monthly")
          .eq("user_id", user_id)
          .maybeSingle(),
        admin
          .from("ai_notes")
          .select("input_tokens, output_tokens")
          .eq("user_id", user_id)
          .gte("created_at", startOfMonth.toISOString()),
        admin
          .from("trade_reviews")
          .select(
            "ticker, realized_pnl, r_realized, what_worked, what_didnt, lessons, reviewed_at",
          )
          .eq("user_id", user_id)
          .gte("reviewed_at", thirtyDaysAgo.toISOString())
          .order("reviewed_at", { ascending: false }),
      ]);

    const budget =
      (profileRow?.ai_token_budget_monthly as number | null) ?? 100_000;
    const usedTokens = (usageRows ?? []).reduce(
      (sum, r) =>
        sum +
        ((r.input_tokens as number) ?? 0) +
        ((r.output_tokens as number) ?? 0),
      0,
    );

    if (usedTokens >= budget) {
      results.push({
        userId: user_id,
        status: `skipped — monthly token budget exhausted (${usedTokens}/${budget})`,
      });
      continue;
    }

    if (!reviews || reviews.length === 0) {
      results.push({ userId: user_id, status: "skipped — no reviews in last 30 days" });
      continue;
    }

    const dataProvided = { reviews, period: "last 30 days", reviewCount: reviews.length };

    const prompt = `Please provide a monthly deep review of my journal for the last 30 days. I have ${reviews.length} trade review(s) in this period.`;

    let fullText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadInputTokens = 0;
    let cacheCreationInputTokens = 0;

    try {
      const stream = anthropic.messages.stream({
        model,
        max_tokens: 2048,
        system: [
          {
            type: "text",
            text: CRON_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: `Journal data:\n${JSON.stringify(dataProvided, null, 2)}\n\n${prompt}`,
          },
        ],
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          fullText += event.delta.text;
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

      await admin.from("ai_notes").insert({
        user_id,
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

      results.push({
        userId: user_id,
        status: "ok",
        tokens: inputTokens + outputTokens,
      });
    } catch (err) {
      results.push({ userId: user_id, status: `error: ${String(err)}` });
    }
  }

  return Response.json({ ok: true, results });
}
