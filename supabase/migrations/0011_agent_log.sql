-- M18: agent_log — audit trail for every autonomous agent decision.
-- Inserted by the agent-trade and position-monitor crons; readable by the
-- user via RLS (admin page and future activity feed).
-- Also grants service_role execute on fill_paper_order so the crons can
-- atomically fill orders on behalf of any user.

CREATE TABLE public.agent_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'buy_submitted' | 'sell_submitted' | 'skipped' | 'error'
  event_type    TEXT        NOT NULL,
  ticker        TEXT,
  qty           NUMERIC(20, 4),
  order_id      UUID,
  reason        TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_log_user_created_idx
  ON public.agent_log (user_id, created_at DESC);

ALTER TABLE public.agent_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_log: user owns row"
  ON public.agent_log
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow cron routes (service_role) to call fill_paper_order atomically
-- on behalf of any user. The function already validates p_user_id ownership.
GRANT EXECUTE ON FUNCTION public.fill_paper_order TO service_role;
