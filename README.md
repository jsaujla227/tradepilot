# TradePilot

Private single-user AI paper-trading cockpit. Helps make better decisions, manage risk, and learn from trades. Not financial advice.

**M1–M17 complete.**

## Stack

| Concern | Pick |
|---|---|
| Framework | Next.js 15 App Router, TypeScript strict |
| UI | Tailwind v4, shadcn/ui, zinc-950 dark cockpit |
| Database + Auth | Supabase (Postgres + Auth + RLS) |
| Cache | Upstash Redis (60 s quote cache) |
| Market data | Finnhub free tier (quotes) |
| AI | Anthropic Claude (Sonnet 4.6 / Opus 4.7) |
| Hosting | Vercel + Vercel Cron |

## Setup

### 1. Clone and install

```bash
git clone https://github.com/jsaujla227/tradepilot
cd tradepilot
pnpm install
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in each value:

```bash
cp .env.example .env.local
```

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (keep secret) |
| `UPSTASH_REDIS_REST_URL` | Upstash console or Vercel Marketplace |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash console |
| `FINNHUB_API_KEY` | finnhub.io free account |
| `AWS_ACCESS_KEY_ID` | IAM user with `AmazonBedrockFullAccess` |
| `AWS_SECRET_ACCESS_KEY` | IAM user credentials |
| `AWS_REGION` | `us-east-2` (your Bedrock region) |
| `CRON_SECRET` | `openssl rand -hex 32` |

### 3. Supabase migrations

Apply in order via Supabase MCP or the SQL editor in your project dashboard:

```
supabase/migrations/0001_profiles.sql
supabase/migrations/0002_security_hardening.sql
supabase/migrations/0003_portfolio_schema.sql
supabase/migrations/0004_compute_holdings_and_positions.sql
supabase/migrations/0005_orders.sql
supabase/migrations/0006_watchlist_target.sql
```

Enable magic-link auth: Supabase dashboard → Authentication → Email.

### 4. Run locally

```bash
pnpm dev
```

Sign in via magic link at [http://localhost:3000/login](http://localhost:3000/login), then go to Settings to set account size, max risk per trade %, daily loss limit %, and AI token budget.

### 5. Deploy to Vercel

1. Import the GitHub repo at vercel.com/new
2. Framework: Next.js | Build: `pnpm build` | Install: `pnpm install`
3. Add all env vars from step 2
4. Crons run automatically on Vercel Pro/Enterprise (configured in `vercel.json`):
   - **Daily snapshot** — 23:00 UTC, writes to `portfolio_snapshots`
   - **Monthly journal review** — 23:00 UTC on the 1st, deep review via Opus 4.7

## Development

```bash
pnpm dev          # dev server
pnpm test         # Vitest (lib/risk, lib/scoring, lib/finnhub — 56 tests)
pnpm typecheck    # TypeScript strict
pnpm lint         # ESLint (includes vocab banlist rule)
```

Pre-commit hook (husky + lint-staged): ESLint on staged `.tsx`/`.jsx`, vocab scanner on staged `.md`.

## Rules

Engineering and product rules live in `CLAUDE.md`. Key points:
- Vocabulary banlist enforced by ESLint rule (JSX text) + markdown scanner (lint-staged)
- Every score decomposed into named inputs with "Why?" expansion
- Every AI response includes disclaimer, model, data provided, token cost
- RLS on every table from day 1
- Service role key fenced to `app/api/cron/*` and `scripts/*` only
- All cron routes require `Authorization: Bearer ${CRON_SECRET}`

---

*Educational and decision-support only. Not financial advice. Markets involve risk.*
