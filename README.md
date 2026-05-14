# TradePilot

Private single-user trading cockpit. Paper trading, risk discipline, AI helper.

Not a course. Not advice. Educational and decision-support only.

## Status

Under construction. Built in 11 small milestones — see `~/.claude/plans/tradepilot-build-rosy-cocoa.md`.

**M1 — Site live.** Next.js 15 + TypeScript strict + Tailwind v4 + shadcn/ui foundation; zinc-950 dark cockpit theme; disclaimer footer; deployed.

## Local dev

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # production build
pnpm typecheck    # tsc --noEmit
pnpm lint         # next lint
```

## Stack

Next.js 15 App Router · TypeScript strict · Tailwind v4 · shadcn/ui · Supabase · Upstash Redis · Alpaca · Anthropic Claude · Vercel.

## Rules

Engineering and product rules live in `CLAUDE.md`. Read those before contributing — vocabulary banlist, transparent scoring, RLS-from-day-1, cron auth, prompt caching, etc.
