-- B6: strategies — the validation lifecycle for a trading strategy.
-- Each strategy climbs draft -> backtested -> paper -> live_small -> approved
-- (or is rejected). stage_metrics holds the evidence snapshot for each stage.

CREATE TABLE public.strategies (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  ticker        TEXT        NOT NULL,
  kind          TEXT        NOT NULL DEFAULT 'sma_crossover',
  params        JSONB       NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'backtested', 'paper',
                                    'live_small', 'approved', 'rejected')),
  stage_metrics JSONB       NOT NULL DEFAULT '{}',
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX strategies_user_idx ON public.strategies (user_id, created_at DESC);

ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "strategies: user owns row"
  ON public.strategies
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Transition-graph enforcement: the application layer also checks the metric
-- gate, but this trigger is the safety net so no SQL path can jump a stage.
-- SECURITY INVOKER (default) — it only inspects OLD/NEW, no table access.
CREATE OR REPLACE FUNCTION public.enforce_strategy_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'strategy is in terminal status % and cannot transition', OLD.status;
  END IF;
  IF NEW.status = 'rejected' THEN
    RETURN NEW;
  END IF;
  IF (OLD.status = 'draft'      AND NEW.status = 'backtested')
  OR (OLD.status = 'backtested' AND NEW.status = 'paper')
  OR (OLD.status = 'paper'      AND NEW.status = 'live_small')
  OR (OLD.status = 'live_small' AND NEW.status = 'approved') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'illegal strategy status transition: % -> %', OLD.status, NEW.status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_strategy_transition() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_strategy_transition() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_strategy_transition() FROM authenticated;

CREATE TRIGGER strategies_transition_lock
  BEFORE UPDATE ON public.strategies
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_strategy_transition();
