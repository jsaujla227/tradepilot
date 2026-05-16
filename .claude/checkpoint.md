# TradePilot — Session Checkpoint

**Last updated:** 2026-05-16
**Purpose:** Hand-off document. Anyone (a coworker or a fresh Claude session) can
read this cold and continue the work without losing context.

---

## NEXT ACTION

The **Backtesting & Strategy-Validation initiative** is greenlit. The owner
asked to build all 9 phases autonomously, then paused to continue in a co-work
session.

**Resume at Phase B1 — Historical data foundation.** A complete, ready-to-build
implementation spec for B1 is in the **"Phase B1 — implementation spec"**
section below: exact file list, full migration SQL, function designs, the
building blocks already in the repo, and the gotchas. No design work is needed
— build it, verify, open a draft PR, merge, then move to B2.

Status: B1 not started — no code written, nothing committed. (An empty local
branch `claude/backtest-b1-historical-data` was created in a prior session but
never pushed; ignore it and create a fresh branch.)

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
the remote environment). The next migration number is `0015` (B1's
`historical_bars` table).

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

## Phase B1 — implementation spec (ready to build)

Goal: a `historical_bars` table holding **adjusted daily OHLCV**, plus a
resumable ingestion job that backfills it from Massive. Backtests (B3+) replay
from this table, never the live API.

### Files to create
1. `supabase/migrations/0015_historical_bars.sql` — the table (SQL below).
2. `lib/backtest/data.ts` — typed read access.
3. `lib/backtest/data.test.ts` — unit tests for the pure mapper.
4. `lib/backtest/ingest.ts` — `backfillBars()` ingestion logic.
5. `app/api/cron/backfill-bars/route.ts` — daily incremental cron.
6. `app/api/admin/backfill-bars/route.ts` — on-demand full backfill (admin).
7. `vercel.json` — add the backfill cron entry.

### Migration SQL (`0015_historical_bars.sql`)

```sql
-- B1: historical_bars — adjusted daily OHLCV for backtesting. Shared market
-- data (not user-scoped): any signed-in user may read; writes are service-role
-- only (no write policy → RLS blocks all non-service-role writes).

CREATE TABLE public.historical_bars (
  ticker      TEXT          NOT NULL,
  bar_date    DATE          NOT NULL,
  open        NUMERIC(20,6) NOT NULL,
  high        NUMERIC(20,6) NOT NULL,
  low         NUMERIC(20,6) NOT NULL,
  close       NUMERIC(20,6) NOT NULL,
  volume      BIGINT        NOT NULL DEFAULT 0,
  ingested_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, bar_date)
);

CREATE INDEX historical_bars_date_idx ON public.historical_bars (bar_date);

ALTER TABLE public.historical_bars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historical_bars: authenticated read"
  ON public.historical_bars
  FOR SELECT
  TO authenticated
  USING (true);
```

After committing the file, apply it to the live DB with the Supabase MCP
`apply_migration` tool (project `pixyzcydahpasazpkmzr`, name `historical_bars`).

### `lib/backtest/data.ts`
- `export type HistoricalBar = { ticker; date /* YYYY-MM-DD */; open; high;
  low; close; volume }` (all prices/volume `number`).
- Zod row schema — Postgres `NUMERIC`/`BIGINT` come back as strings, so use
  `z.coerce.number()`.
- `toHistoricalBar(row: unknown): HistoricalBar` — pure: validates + maps
  `bar_date`→`date`. This is the unit-tested part.
- `getHistoricalBars(supabase, ticker, from, to): Promise<HistoricalBar[]>` —
  selects from `historical_bars` filtered by ticker + `bar_date` range, ordered
  `bar_date` ascending.

### `lib/backtest/ingest.ts`
- `backfillBars(admin, tickers, lookbackDays): Promise<BackfillResult[]>` where
  `BackfillResult = { ticker; ok; barsUpserted; error? }`.
- Per ticker: `getBars(ticker, 1, "day", from, to)` (from
  `lib/market-data/massive.ts`) → map each `Bar` (`time` ms → `bar_date`
  `YYYY-MM-DD`) → `admin.from("historical_bars").upsert(rows, { onConflict:
  "ticker,bar_date" })`. Upsert makes the job idempotent + resumable.
- Batch (size ~10, ~2 s pause between batches) with `Promise.allSettled` so one
  bad ticker doesn't abort the run.

### Routes
- Cron `GET /api/cron/backfill-bars`: timing-safe `Bearer ${CRON_SECRET}` check
  (copy the `isValidCronAuth` pattern from `app/api/cron/scan/route.ts`);
  `export const maxDuration = 300`; calls `backfillBars(supabaseAdmin(),
  SP500_TOP100, 7)` — short look-back keeps recent bars fresh.
- Admin `POST /api/admin/backfill-bars`: `requireAdmin()` from
  `lib/admin-auth.ts`; `maxDuration = 300`; full backfill —
  `backfillBars(supabaseAdmin(), SP500_TOP100, 7300)` (~20 y). May accept a
  `?days=` query param.

### `vercel.json`
Add to `crons`: `{ "path": "/api/cron/backfill-bars", "schedule": "0 8 * * 1-5" }`.

### Building blocks already in the repo
- `getBars(ticker, multiplier, timespan, from, to)` in
  `lib/market-data/massive.ts` → `Bar { time(ms), open, high, low, close,
  volume }`, `adjusted=true`, `limit=5000` (~20 y of daily bars in one call).
- `supabaseAdmin()` (`lib/supabase/admin.ts`) — service-role writes; cron/admin only.
- `requireAdmin()` (`lib/admin-auth.ts`) — `ADMIN_USER_IDS` allowlist.
- `SP500_TOP100` (`lib/universe/sp500.ts`) — the 100-ticker universe.
- Migration style reference: `supabase/migrations/0011_agent_log.sql`.

### Gotchas / decisions
- Column is `bar_date`, not `date` (avoid the SQL type-name collision).
- `historical_bars` is shared market data, not user-scoped: RLS on, a
  `SELECT TO authenticated USING (true)` policy, and **no** write policy so only
  the service-role client can write.
- One `getBars` call per ticker covers the full daily history — no pagination.

### Definition of done for B1
- Migration file committed AND applied to the live DB.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
- Trigger the admin backfill once; confirm `historical_bars` is populated and
  record the earliest `bar_date` reached — that answers "how far back does the
  Massive tier go" and sets the windowing budget for B2-B5.
- Draft PR opened and merged to `main`; then proceed to B2.

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
