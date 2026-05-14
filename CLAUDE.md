# TradePilot — Claude rules

Private single-user AI trading cockpit. Goal: help the user make better decisions, manage risk, and learn from their own trades through paper trading. Not a course, not advice.

The full small-batch build plan lives at `~/.claude/plans/tradepilot-build-rosy-cocoa.md` (11 milestones). Treat that plan as authoritative.

## Product rules

- **Single user, private.** No marketing surface; the only unauthenticated route is `/login`.
- **Vocabulary banlist** (lint-enforced from M11): `academy, course, student, quiz, exam, lesson, module, certificate, enroll, guaranteed, risk-free, can't lose, will rise, will fall, buy now, sell now`.
- **Vocabulary whitelist:** my portfolio, my watchlist, my risk, my journal, AI helper, worth monitoring, high risk, low confidence, review position size, what could go wrong.
- **Every score is decomposed** into named inputs with a "Why?" expansion. Never a black-box number.
- **Every AI response includes**: disclaimer, model used, data passed to the model (audit trail), token cost.
- **Every risk warning has a "Why?"** button that shows the math.
- **Disclaimer footer** persists on every `(app)` route: *Educational and decision-support only. Not financial advice. Markets involve risk.*
- **No emojis** in UI copy unless the user adds them. The cockpit reads serious.

## Engineering rules

- **Next.js 15 App Router**, TypeScript strict, no `any`. Server Components by default; Client Components only where interactivity requires.
- **Server Actions for mutations**, Route Handlers only for read endpoints the client polls (quotes) and external webhooks.
- **Supabase (Postgres + Auth + RLS).** RLS on every table from day 1. Service role key only via a single `supabaseAdmin()` helper imported from `app/api/cron/*` and `scripts/*` — never from anywhere else.
- **Zod validation** on every external API response, every form, every Server Action input.
- **Pure functions in `lib/risk` and `lib/scoring`** have unit tests (Vitest). No exceptions.
- **Money formatted via `Intl.NumberFormat`** with currency + 2 decimals.
- **AI defaults:** `claude-sonnet-4-6` for chat/explain; `claude-opus-4-7` only for the monthly journal review. **Prompt caching** on the system block always (system block kept >1024 tokens so caching triggers; cache reads cost 0.10×). **Streaming** on every call. **Monthly per-user token budget** enforced on the route.
- **All Cron endpoints** require `Authorization: Bearer ${CRON_SECRET}`; return 401 otherwise.
- **Vocabulary banlist enforced** via a custom ESLint rule on JSX text nodes + a markdown scanner; both run in lint-staged pre-commit (M11).

## Stack

| Concern | Pick |
|---|---|
| Framework | Next.js 15 App Router |
| Lang | TypeScript strict |
| UI | Tailwind v4 + shadcn/ui (zinc-950 dark cockpit) |
| DB + Auth | Supabase (Postgres + Auth + RLS) |
| Cache | Upstash Redis (Vercel Marketplace) |
| Paper trading | Alpaca Trading API (IEX quotes + `trade_updates` websocket) |
| Market data | Alpaca only (no Finnhub) — sector tagged manually per ticker |
| AI | Anthropic Claude (Sonnet 4.6 / Opus 4.7) |
| Forms | react-hook-form + Zod |
| Client data | TanStack Query (for polled reads); Server Actions for mutations |
| Charts | Recharts (portfolio value) + Lightweight Charts v5 (OHLC) |
| Tests | Vitest |
| Hosting | Vercel + Vercel Cron |

## Folder layout

```
app/                     Next.js App Router
  (app)/                 authenticated routes (added M3)
  api/                   route handlers (read endpoints, webhooks, cron)
  globals.css            Tailwind v4 + theme tokens
  layout.tsx             root layout, dark cockpit
  page.tsx               public landing
components/              UI components
  ui/                    shadcn primitives (added as needed)
  disclaimer-footer.tsx
lib/                     pure libs + integrations
  risk/                  M2: positionSize, rMultiple, lossScenarios, etc.
  scoring/               M8: trend, volatility, R-multiple, liquidity
  alpaca/                M5/M6: data + trade clients
  supabase/              M3: server, browser, admin clients
  utils.ts               cn() helper
scripts/                 one-off scripts (admin context only)
```

## Out of scope (until explicitly asked)

Backtesting, social features, real-money trading, public landing/marketing site, pricing page, study/course content, recommendation engine.

## Working agreement

- Build is split into small milestones (30 min – 2 hr each), each leaving the app in a working state.
- After each milestone, stop at the checkpoint and wait for **"Go ahead"** before starting the next one.
- If a milestone runs long, stop at a natural sub-boundary and report.
