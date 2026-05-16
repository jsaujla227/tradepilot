# TradePilot — Session Checkpoint

**Last updated:** 2026-05-16
**Purpose:** Hand-off document. Anyone (a coworker or a fresh Claude session) can
read this cold and continue the work without losing context.

---

## NEXT ACTION

The **Backtesting & Strategy-Validation initiative** has been greenlit by the
owner. A 9-phase plan exists (below). **Phase B1 has NOT been started yet** — it
is awaiting the owner's explicit "go". Do not begin B1 (it creates a table in the
live Supabase project) until that go is given.

When cleared, start at **Phase B1 — Historical data foundation**.

---

## Where the project stands (all done & verified)

`main` is healthy: `pnpm typecheck`, `pnpm lint`, `pnpm test` (136 tests), and
`pnpm build` all pass. Production is deployed on Vercel and `READY`.

### How `main` got to its current state
The repo had 4 open PRs that turned out to be **divergent forks** off commit
`a43e6e0`, not stackable features (overlapping agents/charts/market-data layers,
colliding migration numbers). Resolution, per the owner's decision:

- **PR #1** (M14 market data) — merged, then superseded.
- **PR #2** (`milestones-15-16-17`, actually M15–M22) — **adopted as the trunk.**
- **PR #3** (AI engine) — **closed.** Its learned-patterns engine was ported
  onto the trunk via PR #5; its competing agent/monitor were superseded by the
  trunk's own M18 versions.
- **PR #4** (dashboard "AI signal") — merged, re-applied onto the trunk.
- **PR #5** — ported PR #3's learned-patterns engine onto the trunk.
- **PR #6** — security hardening of the `enforce_broker_mode_unlock` trigger fn.
- **PR #7** — enriched learned-pattern stats with `profit_factor`,
  `avg_win_r`, `avg_loss_r`.

All 7 PRs are resolved. `main` = trunk + PR#4/#5/#6/#7.

### Database (Supabase project `pixyzcydahpasazpkmzr`, "tradepilot")
Migrations `0001`–`0014` applied; all 16 tables present with RLS. Migrations are
applied via the Supabase MCP `apply_migration` tool (no local Supabase CLI in
the remote environment).

---

## The active initiative: Backtesting & Strategy Validation

The owner wants a backtest engine built **step by step, slowly, to get it
right**, then a staged validation lifecycle: backtest → months of paper trading
→ small real-money → long-term small-size → final approval. Build quality over
speed. Each phase leaves the app working and stops at a checkpoint for the
owner's "Go ahead".

### Plan — 9 phases

**Part A — the engine**
- **B1 — Historical data foundation.** `historical_bars` table (adjusted OHLCV)
  + resumable, idempotent ingestion job backfilling the universe from Massive
  into Supabase. Backtests replay from the DB, not the live API. B1 also
  confirms how far back the Massive tier's history reaches.
- **B2 — Strategy interface + first strategy.** Pure, strictly-causal `Strategy`
  interface in `lib/backtest/` (only ever receives bars up to day T — lookahead
  is structurally impossible). One reference strategy (SMA crossover) + tests.
- **B3 — Backtest engine core.** Bar-replay loop, next-open fills, slippage +
  commission models, position tracking, equity curve. Pure, deterministic,
  fully unit-tested on synthetic fixtures.
- **B4 — Metrics + results UI.** `lib/backtest/metrics.ts` (CAGR, Sharpe,
  Sortino, max drawdown, win rate, expectancy, profit factor, exposure). A
  `/backtest` page; every metric decomposed with a "Why?". `backtest_runs` table.
- **B5 — Walk-forward & out-of-sample.** In-sample/out-of-sample split +
  walk-forward harness. Parameter sweeps allowed, but results always reported
  out-of-sample, with the in-sample-vs-OOS gap shown as the overfitting tell.

**Part B — the validation lifecycle**
- **B6 — Strategy lifecycle + approval gate.** `strategies` table with status
  `draft → backtested → paper → live_small → approved` / `rejected`.
  Configurable per-stage gate criteria; promotion blocked unless the gate
  passes — enforced in a server action + a DB trigger (same pattern as the
  broker-mode lock). A "Strategies" UI page.
- **B7 — Forward paper-trading.** Wire `paper`-stage strategies into the
  existing paper broker / a shadow-signal logger; track signals live for the
  months-long paper run. Dashboard compares backtest-expected vs paper-actual.
- **B8 — Small real-money gating.** Extends the existing M16/M17 real-money
  unlock + Questrade adapter: a strategy past the paper gate routes to the live
  broker with a hard small-size cap + per-strategy capital limit.
- **B9 — Long-term monitoring & approval.** Ongoing live-small tracking vs
  backtest/paper expectations, strategy-decay detection, final `approved`
  status with a full audit trail.

### Cross-cutting rules
- Pure functions in `lib/backtest/*`, Vitest-tested — no exceptions.
- Every metric decomposed with a "Why?" — no black-box numbers.
- Each phase leaves the app working; stop at a checkpoint for the owner's go.
- One housekeeping item inside this initiative: update `CLAUDE.md` to move
  backtesting out of the "Out of scope" list (the owner has greenlit it).

---

## Environment & conventions for whoever continues

- **Repo:** `jsaujla227/tradepilot`. GitHub access is via the GitHub MCP tools,
  restricted to this one repo. No `gh` CLI.
- **Branches:** feature branches named `claude/<topic>`; open PRs as **draft**;
  verify (`typecheck`/`lint`/`test`/`build`) before merging.
- **Supabase:** project `pixyzcydahpasazpkmzr`. Schema changes go through the
  `apply_migration` MCP tool AND a matching `supabase/migrations/00NN_*.sql`
  file committed to the repo.
- **Vercel:** project `tradepilot` (team `jsaujla227s-projects`). Each `main`
  merge auto-deploys to production.
- **Package manager:** `pnpm`. Husky + lint-staged run on commit; do not use
  `--no-verify`.
- The remote execution environment is ephemeral — commit and push anything
  worth keeping.

## Open housekeeping items (not blocking; owner-aware)
- **Leaked-password protection** — disabled; enable in the Supabase dashboard
  (Auth → Password settings). Not a code change.
- **RLS `auth_rls_initplan` advisories** (~40 policies) — deliberately NOT
  fixed: single-user app, the at-scale cost never materializes, and a wholesale
  policy rewrite risks a data lockout for no real gain.
- **Duplicate Vercel project** `tradepilot-wx8j` — deploys the repo a second
  time; the owner may want to delete it.
- **Orphan tables** `position_alerts`, `agent_trades` — left from PR #3's
  discarded migrations; unused by `main`'s code, empty, harmless.
