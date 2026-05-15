# TradePilot — Session Checkpoint

**Last updated:** 2026-05-15  
**Active branch:** `claude/improve-trading-ai-engine-tTcBU`  
**PR:** #3 (draft) — "Add experienced-trader AI engine: learned patterns, position alerts, paper agent"

---

## What was built in this session

### Milestone A — Learned Patterns Engine
Trades the user makes are grouped by (sector, direction, R-tier) after every journal review. Once a group has ≥ 3 samples, a winning/losing/neutral pattern is stored. The pre-trade checklist fires a debounced `POST /api/ai?mode=pre-trade` call and shows a pattern verdict panel (win rate, expectancy, match reason, AI assessment) inside the dialog.

Key files:
- `lib/ai/patterns.ts` — pure extraction logic (no I/O)
- `lib/ai/match-patterns.ts` — pure matching logic
- `lib/ai/patterns.test.ts`, `lib/ai/match-patterns.test.ts` — unit tests
- `app/(app)/journal/actions.ts` — calls `refreshPatterns()` after review submit
- `app/api/ai/route.ts` — added `"pre-trade"` mode, extended system prompt
- `components/risk/pre-trade-checklist.tsx` — verdict panel UI (debounced fetch, pattern cards, AI assessment block)
- `supabase/migrations/0010_learned_patterns.sql` — applied to live DB ✓

### Milestone B — Position Monitor & Alerts
A trade-doctor cron runs at 9:21 PM ET weekdays. It checks every open position for: stop proximity (5% / 2% thresholds), R target reached (≥ 2R / ≥ 3R), earnings risk (≤ 5 days / ≤ 3 days), high concentration (> 25% / > 50%), and losing streak (last 3 trades all losses). Alerts appear as dismissible cards on the dashboard with a "Why?" expandable section showing the math.

Key files:
- `lib/scoring/position-monitor.ts` — pure alert logic + tests
- `app/api/cron/trade-doctor/route.ts` — cron endpoint
- `app/(app)/dashboard/page.tsx` — renders alert cards above stat cards
- `app/(app)/dashboard/_components/alert-dismiss-button.tsx` — dismiss action
- `app/(app)/dashboard/actions.ts` — `dismissAlert()` server action
- `supabase/migrations/0011_position_alerts.sql` — applied to live DB ✓

### Milestone C — Autonomous Paper Agent
When `agent_enabled = true` in Settings, a cron runs at 9:45 AM ET weekdays. It checks the top 10 momentum scanner results, runs hard gates (momentum ≥ 55, earnings ≥ 5d away, daily capital limit not exceeded, daily loss limit not breached), then calls Claude with `record_agent_decision` tool use. Enter/exit decisions with medium/high confidence are executed as paper orders. All decisions (including skips/holds) logged to `agent_trades`.

Key files:
- `lib/ai/paper-agent.ts` — `makeAgentDecision()` + `makeExitDecision()`
- `app/api/cron/agent/route.ts` — cron endpoint
- `app/(app)/agent/page.tsx` — audit log UI (action badges, risk gates PASS/FAIL, collapsible context snapshot)
- `app/(app)/settings/_components/settings-form.tsx` — agent toggle + daily capital limit input
- `supabase/migrations/0012_agent_trades.sql` — applied to live DB ✓

### Equity curve charts (last commit in session)
- `components/charts/sparkline.tsx` — 30-day line chart, green/red based on trend
- `app/(app)/portfolio/_components/equity-curve.tsx` — 90-day AreaChart with gradient fill
- Dashboard: compact sparkline above holdings table
- Portfolio page: full equity curve with start→end value header
- Data source: `portfolio_snapshots` table (populated by nightly snapshot cron)
- Package added: `recharts`

---

## DB state (Supabase project: pixyzcydahpasazpkmzr)

All migrations 0001–0012 applied and live. Tables with RLS:
- `profiles` — user settings including `agent_enabled`, `agent_daily_capital_limit`
- `portfolio_snapshots` — daily equity snapshots (feeds charts)
- `learned_patterns` — extracted pattern library per user
- `position_alerts` — daily health alerts, dismissible
- `agent_trades` — full agent decision audit trail

---

## Vercel cron schedule (Hobby plan = daily only)

| Cron | Schedule | Purpose |
|---|---|---|
| `/api/cron/context-refresh` | `0 9 * * 1-5` | Pre-market ticker context refresh |
| `/api/cron/scan` | `35 13 * * 1-5` | Morning momentum scanner |
| `/api/cron/snapshot` | `0 23 * * *` | Daily portfolio snapshot |
| `/api/cron/journal-review` | `0 23 1 * *` | Monthly journal review |
| `/api/cron/trade-doctor` | `15 21 * * 1-5` | Position health alerts |
| `/api/cron/agent` | `45 13 * * 1-5` | Autonomous paper agent |

---

## What's done vs original 11-milestone plan

All 11 milestones from the main build plan are complete. The AI engine improvement plan (A/B/C) is complete. The charting spec from CLAUDE.md (Recharts for portfolio value) is done. The remaining stack item is **Lightweight Charts v5 (OHLC candlestick charts)** — this was "bars vendor TBD in M8" and is still unimplemented. Finnhub free tier provides `/stock/candle` for historical OHLC data which would work.

---

## Potential next work

1. **OHLC candlestick chart** — install `lightweight-charts`, add a `CandlestickChart` client component, fetch Finnhub `/stock/candle` for 1D/1W/1M timeframes. Show on the portfolio page per-holding or on a dedicated ticker detail page.
2. **Ticker detail page** — `/portfolio/[ticker]` showing open position summary, OHLC chart, news, earnings context, and link to create a trade review.
3. **Journal review improvements** — surface the matched learned patterns on the review page so the user can see which patterns are evolving.
4. **Agent performance stats** — add realized P&L tracking for agent-placed trades specifically (filter `transactions` by `order_id` in `agent_trades`).

---

## Key architectural notes for next session

- **AI client:** `AnthropicBedrock` from `@anthropic-ai/bedrock-sdk`, not direct `@anthropic-ai/sdk`. Instantiate in route handlers, pass to helpers.
- **Pre-trade API:** `POST /api/ai` with `{ mode: "pre-trade", prompt, dataProvided, setupDirection, setupRAtEntry }` returns JSON (not a stream) with `{ assessment, matched_patterns, total_patterns_in_library, usage }`.
- **Cron auth:** All cron routes require `Authorization: Bearer ${CRON_SECRET}`.
- **supabaseAdmin()** — only importable from `app/api/cron/*` and `scripts/*`.
- **Vocab banlist** — enforced at commit time via ESLint (JSX) + `scripts/check-vocab.mjs` (markdown). CLAUDE.md is excluded from the markdown scan.
- **Tests:** `npx vitest` runs 131 tests across `lib/ai/` and `lib/scoring/`. All pure functions must have unit tests.
