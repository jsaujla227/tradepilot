# Plan: Experienced-Trader AI Engine

## Context

The user wants TradePilot's AI to behave less like a passive calculator and more like an experienced trader who:
1. **Learns from their own mistakes** — remembers what setups worked and which ones blew up
2. **Makes autonomous paper-trade decisions** — enters and exits positions like a seasoned trader would
3. **Manages risk adaptively** — tightens up after losing streaks, monitors open positions for exit signals

The DB schema already has `agent_enabled`, `agent_daily_capital_limit`, and `broker_mode` columns in `profiles` (migration 0009). The paper broker adapter and atomic `fill_paper_order()` RPC are already wired. The gap is the _intelligence layer_ — the feedback loop, the pattern memory, and the autonomous decision engine.

This is three tightly-scoped milestones. Each leaves the app in a working state.

---

## Milestone A — Learned Patterns Engine (~1.5 hr)

**Goal:** After every post-trade review, the AI extracts the user's personal winning and losing patterns and uses them the next time they evaluate a setup.

### New files

**`lib/ai/patterns.ts`** — pure, Vitest-tested
```typescript
export type TradePattern = {
  pattern_type: 'winning' | 'losing' | 'neutral';
  description: string;        // e.g. "Tech sector longs with R ≥ 2.5"
  conditions: {
    sector?: string;
    direction?: 'long' | 'short';
    r_min?: number;           // from checklist r_at_entry
    momentum_min?: number;    // from scanner_results at entry time
  };
  stats: {
    win_rate: number;         // 0–1
    avg_r: number;            // average realized R
    expectancy: number;       // winRate × avgWin − lossRate × |avgLoss| in R
    sample_count: number;
  };
};

export function extractPatterns(
  reviews: TradeReviewRow[],
  checklists: TradeChecklistRow[],
): TradePattern[]
// Groups closed trades by sector + direction + R-target tier (< 2, 2–3, > 3).
// Only produces a pattern if ≥ 3 samples in the group.
// Winning: win_rate > 0.55 AND expectancy > 0.
// Losing:  win_rate < 0.45 OR expectancy < 0.
```

**`lib/ai/match-patterns.ts`** — pure, Vitest-tested
```typescript
export type PatternMatch = {
  pattern: TradePattern;
  match_reason: string;   // human-readable "Same sector (Tech) + long + R 2.8 ≈ your 2–3 R tier"
};

export function matchPatterns(
  patterns: TradePattern[],
  setup: { sector?: string; direction: 'long' | 'short'; r_at_entry: number },
): PatternMatch[]
```

### New DB migration: `0010_learned_patterns.sql`
```sql
CREATE TABLE learned_patterns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  pattern_type  text NOT NULL CHECK (pattern_type IN ('winning','losing','neutral')),
  description   text NOT NULL,
  conditions    jsonb NOT NULL DEFAULT '{}',
  stats         jsonb NOT NULL DEFAULT '{}',
  computed_at   timestamptz NOT NULL DEFAULT now(),
  sample_count  integer NOT NULL DEFAULT 0
);
ALTER TABLE learned_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON learned_patterns USING (auth.uid() = user_id);
CREATE INDEX ON learned_patterns(user_id, pattern_type);
```

### Wiring changes

- **`app/(app)/journal/actions.ts` → `submitReview()`**: after saving the review, call a new server action `refreshPatterns(userId)` that:
  1. Fetches all `trade_reviews` + matching `trade_checklists` for the user
  2. Calls `extractPatterns()`
  3. Deletes old `learned_patterns` rows for user, inserts fresh batch

- **`app/api/ai/route.ts`**: add new `mode: "pre-trade"` to `bodySchema` enum. When `mode === "pre-trade"`:
  1. Fetch `learned_patterns` from DB for the user
  2. Match against the submitted setup via `matchPatterns()`
  3. Append matched patterns to `dataProvided` context (e.g. `{ matched_patterns: [...] }`)
  4. Run structured `assess` mode with augmented context
  5. Return assessment + matched patterns so the UI can show: *"This matches your losing pattern (win rate 38%). Proceed with caution."*

- **System prompt addition** (append to `SYSTEM_PROMPT` in `app/api/ai/route.ts`):
  ```
  WHEN REVIEWING MATCHED PATTERNS (pre-trade mode):
  - The user's personal trading patterns are provided in matched_patterns.
  - For each match, reference it explicitly: "This setup resembles your [description] pattern (win rate X%, expectancy Y R)."
  - If a losing pattern matches, frame it as a question: "What is different about this setup that changes the outcome?"
  - Never say the trade will succeed or fail. Surface the historical data and let the user decide.
  ```

- **`app/(app)/orders/page.tsx`** (or the checklist component): after R-multiple is computed and a ticker + sector is known, fire a `POST /api/ai` with `mode: "pre-trade"` and show the pattern-match verdict below the checklist form. Uses the existing `ai-chat` streaming pattern.

---

## Milestone B — Position Monitor & Adaptive Risk Alerts (~1.5 hr)

**Goal:** Open positions generate daily health signals. When a stop is near, an earnings event is imminent, or a target is hit, the dashboard surfaces a clear "Review this position" card with full math.

### New file: `lib/scoring/position-monitor.ts` — pure, Vitest-tested
```typescript
export type AlertType =
  | 'stop_proximity'       // price within 5% of stop
  | 'r_target_reached'     // unrealized R ≥ 2.0
  | 'earnings_risk'        // earnings in ≤ 5 days
  | 'concentration_high'   // position > 25% of portfolio
  | 'streak_caution';      // 3+ consecutive losses → suggest reduced size next trade

export type PositionAlert = {
  ticker: string;
  alert_type: AlertType;
  severity: 'info' | 'warning' | 'critical';
  message: string;          // plain-language, whitelist vocabulary only
  why: string;              // math shown: "Price $14.20, stop $13.50, gap 4.9%"
  suggested_review: string; // "Review whether the stop level still makes sense."
};

export function monitorPosition(
  position: { ticker: string; qty: number; avg_cost: number },
  quote: Quote,
  checklist: TradeChecklistRow | null,
  daysToEarnings: number | null,
  portfolioValue: number,
): PositionAlert[]

export function streakCaution(recentReviews: TradeReviewRow[]): PositionAlert | null
// Returns a caution alert if the last 3 closed trades were all losses.
```

### New DB migration: `0011_position_alerts.sql`
```sql
CREATE TABLE position_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  ticker        text NOT NULL,
  alert_type    text NOT NULL,
  severity      text NOT NULL CHECK (severity IN ('info','warning','critical')),
  message       text NOT NULL,
  why           text NOT NULL,
  suggested_review text NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  dismissed_at  timestamptz
);
ALTER TABLE position_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON position_alerts USING (auth.uid() = user_id);
CREATE INDEX ON position_alerts(user_id, generated_at DESC);
```

### New cron: `app/api/cron/trade-doctor/route.ts`
- Runs daily at 4:15 PM ET (after market close) via Vercel Cron
- Requires `Authorization: Bearer ${CRON_SECRET}`
- For each user with open positions:
  1. Fetch open positions, latest quotes (via `getQuotesMap()`), latest checklists, earnings context
  2. Run `monitorPosition()` for each open position
  3. Run `streakCaution()` on last 5 reviews
  4. Delete today's existing alerts for user, insert fresh batch
- Returns `{ processed: N, alerts: M }` in the response body

### Dashboard changes: `app/(app)/dashboard/page.tsx`
- Server component fetches `position_alerts` where `dismissed_at IS NULL AND generated_at >= today`
- Renders alert cards above the open positions table, ordered by severity (critical first)
- Each card: ticker, severity badge, `message`, and a collapsible "Why?" section showing `why` + `suggested_review`
- Dismiss button → Server Action `dismissAlert(alertId)` sets `dismissed_at = now()`

---

## Milestone C — Paper Agent Mode (~2 hr)

**Goal:** When `agent_enabled = true` in the user's profile, a cron runs every 15 minutes during market hours and autonomously executes paper trades — entering high-confidence setups and exiting positions that hit exit triggers — exactly as a disciplined rule-based trader would.

### New file: `lib/ai/paper-agent.ts`
```typescript
export type AgentAction = 'enter' | 'exit' | 'hold' | 'skip';

export type AgentDecision = {
  ticker: string;
  action: AgentAction;
  qty?: number;               // computed via positionSize() if enter
  reasoning: string;          // ≤300 chars, grounded in context data
  confidence: 'low' | 'medium' | 'high';
  pattern_matches: string[];  // descriptions of matched learned_patterns
  risk_gates_checked: string[];  // list of gates evaluated (e.g. "R ≥ 2.0: PASS")
  disclaimer: string;         // always present
  model: string;
  tokens: { input: number; output: number; cache_read: number; cost_usd: number };
};

export async function makeAgentDecision(args: {
  ticker: string;
  context: TickerContext;       // from lib/finnhub/context.ts
  quote: Quote;
  openPositions: PositionRow[];
  learnedPatterns: TradePattern[];
  profile: ProfileRow;
  anthropic: AnthropicBedrock;
}): Promise<AgentDecision>
```

**Agent decision flow inside `makeAgentDecision()`:**

1. **Hard gates** (pure, no AI call needed — fail fast):
   - No existing open position in this ticker
   - Daily capital limit not exceeded (`agent_daily_capital_limit`)
   - Portfolio daily loss limit not breached (`dailyLossBreached()`)
   - Scanner momentum score ≥ 55 (only enter high-momentum tickers)
   - Earnings ≥ 5 days away (no event risk at entry)
   - If all pass → proceed to AI evaluation

2. **AI evaluation** (Claude Sonnet, tool-use, `record_agent_decision` tool):
   - Context provided: quote, earnings, news, analyst consensus, matched learned patterns, open positions summary, user risk settings
   - Tool forces structured output: `{ action, confidence, reasoning, entry_price, stop_price, target_price }`
   - Only acts on action ∈ { 'enter', 'exit' } with confidence ∈ { 'medium', 'high' }

3. **Execution** (if action is 'enter' with confidence medium/high):
   - Call `positionSize()` with profile settings → compute shares
   - Submit via paper broker adapter (`submitOrder()`)
   - All logged to `agent_trades`

4. **Exit evaluation** — separately, for each open position:
   - Check exit triggers from the original `assess` mode assessment stored in `ai_notes`
   - Run `monitorPosition()` → if `r_target_reached` or `stop_proximity` is critical → ask AI: "Should this position be exited now?"
   - If AI says 'exit' with confidence ≥ medium → submit sell order

### New DB migration: `0012_agent_trades.sql`
```sql
CREATE TABLE agent_trades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  ticker        text NOT NULL,
  action        text NOT NULL CHECK (action IN ('enter','exit','hold','skip')),
  order_id      uuid REFERENCES orders(id),   -- null if action = skip/hold
  confidence    text NOT NULL,
  reasoning     text NOT NULL,
  pattern_matches jsonb NOT NULL DEFAULT '[]',
  risk_gates    jsonb NOT NULL DEFAULT '[]',
  context_snapshot jsonb NOT NULL DEFAULT '{}',  -- full data passed to model
  model         text NOT NULL,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd      numeric(10,6) NOT NULL DEFAULT 0,
  decided_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agent_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON agent_trades USING (auth.uid() = user_id);
CREATE INDEX ON agent_trades(user_id, decided_at DESC);
```

### New cron: `app/api/cron/agent/route.ts`
- Runs every 15 minutes, Mon–Fri 9:35 AM – 3:45 PM ET via Vercel Cron
- For each user with `agent_enabled = true`:
  1. Fetch top 10 scanner results by momentum from latest scan date
  2. Fetch open positions, learned patterns, profile
  3. Call `makeAgentDecision()` for each ticker not already held
  4. Call exit evaluation for each open position
  5. All decisions → insert into `agent_trades` (regardless of action)
- Returns `{ users: N, decisions: M, orders_placed: K }`

### Settings page: `app/(app)/settings/page.tsx`
- Add "Paper Agent" section with:
  - Toggle: `agent_enabled` (off by default)
  - Input: `agent_daily_capital_limit` (default $500)
  - Warning notice: *"When enabled, the AI will autonomously enter and exit paper trades within your daily capital limit. All decisions are logged and no real money is involved."*
  - Server Action `updateAgentSettings(formData)` updates both columns

### New page: `app/(app)/agent/page.tsx`
- Lists `agent_trades` ordered by `decided_at DESC`
- Each row: ticker, action badge (enter/exit/skip/hold), confidence, reasoning, pattern_matches, risk_gates, cost_usd
- Collapsible "Full context" shows `context_snapshot` (what data the AI saw)
- Stats bar: trades entered today, capital deployed today vs limit, total agent P&L

---

## Files to create / modify

| File | Action |
|---|---|
| `supabase/migrations/0010_learned_patterns.sql` | Create |
| `supabase/migrations/0011_position_alerts.sql` | Create |
| `supabase/migrations/0012_agent_trades.sql` | Create |
| `lib/ai/patterns.ts` | Create |
| `lib/ai/patterns.test.ts` | Create |
| `lib/ai/match-patterns.ts` | Create |
| `lib/ai/match-patterns.test.ts` | Create |
| `lib/ai/paper-agent.ts` | Create |
| `lib/scoring/position-monitor.ts` | Create |
| `lib/scoring/position-monitor.test.ts` | Create |
| `app/api/ai/route.ts` | Modify — add `"pre-trade"` mode, extend system prompt |
| `app/(app)/journal/actions.ts` | Modify — call `refreshPatterns()` after `submitReview()` |
| `app/(app)/orders/page.tsx` | Modify — show pre-trade pattern match verdict |
| `app/(app)/dashboard/page.tsx` | Modify — render position alert cards |
| `app/(app)/settings/page.tsx` | Modify — add agent toggle + capital limit |
| `app/(app)/agent/page.tsx` | Create |
| `app/api/cron/trade-doctor/route.ts` | Create |
| `app/api/cron/agent/route.ts` | Create |

---

## Constraints & guardrails

- Every `AgentDecision.disclaimer` = "Educational and decision-support only. Not financial advice. Markets involve risk."
- Vocabulary banlist applies inside all AI prompts and all UI copy
- `agent_enabled` defaults to `false`; user must opt in explicitly
- All agent token usage is counted against the user's `ai_token_budget_monthly`
- Paper agent never touches real money (broker adapter is paper-only)
- `positionSize()` and `dailyLossBreached()` gates run before any AI call is made
- `lib/ai/patterns.ts`, `lib/ai/match-patterns.ts`, `lib/scoring/position-monitor.ts` are pure — no I/O, fully unit-tested

---

## Verification (end-to-end test path)

1. Submit a few paper trades via `/orders` and write journal reviews for each via `/journal`
2. Confirm `learned_patterns` table is populated after review submission
3. Start a new trade checklist — verify pre-trade AI assessment references the matched pattern
4. Wait for or manually trigger `/api/cron/trade-doctor` (with `CRON_SECRET`) — confirm `position_alerts` rows appear on dashboard
5. Enable agent in Settings → trigger `/api/cron/agent` manually → verify `agent_trades` rows appear in `/agent`
6. Confirm agent respects daily capital limit (exceed it → no more orders placed that day)
7. Run `npx vitest` — `patterns.test.ts`, `match-patterns.test.ts`, `position-monitor.test.ts` must all pass
