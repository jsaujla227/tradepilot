-- B4: backtest_runs — a saved record of every backtest the user runs.
-- Stores the inputs, the computed metrics, and the equity curve so a run
-- can be reviewed later without recomputing. User-scoped with RLS.

CREATE TABLE public.backtest_runs (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker          TEXT         NOT NULL,
  strategy        TEXT         NOT NULL,
  params          JSONB        NOT NULL DEFAULT '{}',
  from_date       DATE         NOT NULL,
  to_date         DATE         NOT NULL,
  initial_capital NUMERIC(20, 2) NOT NULL,
  metrics         JSONB        NOT NULL DEFAULT '{}',
  equity_curve    JSONB        NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX backtest_runs_user_created_idx
  ON public.backtest_runs (user_id, created_at DESC);

ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backtest_runs: user owns row"
  ON public.backtest_runs
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
