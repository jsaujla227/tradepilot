-- Daily scanner results. One row per (scan_date, ticker) per user.
-- The scan cron upserts these each weekday morning after market open.
-- Scores are momentum-only (trend + volatility); R-multiple is excluded
-- because the user has not defined an entry/stop/target for scanned tickers.

CREATE TABLE public.scanner_results (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_date    DATE         NOT NULL,
  ticker       TEXT         NOT NULL,
  -- Momentum score: trend (55%) + volatility (45%), range 0–100, 1 decimal
  momentum     NUMERIC(5,1) NOT NULL,
  -- Full quote snapshot and per-factor breakdown stored as JSONB for the UI
  quote        JSONB        NOT NULL,
  breakdown    JSONB        NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, scan_date, ticker)
);

CREATE INDEX scanner_results_user_date_idx
  ON public.scanner_results (user_id, scan_date DESC, momentum DESC);

ALTER TABLE public.scanner_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scanner_results: user owns row"
  ON public.scanner_results
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
