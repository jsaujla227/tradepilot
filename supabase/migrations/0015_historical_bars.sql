-- B1: historical_bars — adjusted daily OHLCV for the backtesting engine.
-- Shared market data (not user-scoped): any signed-in user may read; writes
-- are service-role only — there is deliberately no INSERT/UPDATE/DELETE policy,
-- so RLS blocks every non-service-role write. The ingestion job (cron / admin)
-- writes through the service-role client, which bypasses RLS.

CREATE TABLE public.historical_bars (
  ticker      TEXT          NOT NULL,
  bar_date    DATE          NOT NULL,
  open        NUMERIC(20, 6) NOT NULL,
  high        NUMERIC(20, 6) NOT NULL,
  low         NUMERIC(20, 6) NOT NULL,
  close       NUMERIC(20, 6) NOT NULL,
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
