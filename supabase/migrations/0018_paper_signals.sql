-- B7: paper_signals — the day-by-day forward paper-trading log.
-- One row per strategy per trading day, recording the strategy's hypothetical
-- equity that day. The accumulating log is the audit trail proving the
-- months-long paper run happened forward in real time (it cannot be backfilled
-- after the fact). User-scoped with RLS.

CREATE TABLE public.paper_signals (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID         NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_date DATE         NOT NULL,
  equity      NUMERIC(20, 2) NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, signal_date)
);

CREATE INDEX paper_signals_strategy_idx
  ON public.paper_signals (strategy_id, signal_date);

ALTER TABLE public.paper_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_signals: user owns row"
  ON public.paper_signals
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
