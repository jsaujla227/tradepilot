-- M21: daily AI training loop.
-- Each weekday after market close, a Sonnet reflection summarises that day's
-- autonomous agent activity (buys, sells, P&L, market regime) and proposes a
-- numeric adjustment to the agent's momentum threshold. The agent reads the
-- most recent lesson at the start of the next trading day.

CREATE TABLE public.agent_lessons (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_date              DATE        NOT NULL,
  period_start             TIMESTAMPTZ NOT NULL,
  period_end               TIMESTAMPTZ NOT NULL,
  -- Sonnet's full natural-language reflection (kept short — <300 words).
  summary                  TEXT        NOT NULL,
  -- Structured threshold adjustments parsed from the model output.
  -- Shape: { "momentum_threshold_delta": number, "rationale": string }
  threshold_adjustments    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source_event_count       INTEGER     NOT NULL DEFAULT 0,
  model                    TEXT        NOT NULL,
  input_tokens             INTEGER     NOT NULL DEFAULT 0,
  output_tokens            INTEGER     NOT NULL DEFAULT 0,
  cache_read_input_tokens  INTEGER     NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER  NOT NULL DEFAULT 0,
  cost_usd                 NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One lesson per user per day. The cron is idempotent — re-running the
  -- admin trigger on the same day replaces the row.
  UNIQUE (user_id, lesson_date)
);

CREATE INDEX agent_lessons_user_created_idx
  ON public.agent_lessons (user_id, created_at DESC);

ALTER TABLE public.agent_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_lessons: user owns row"
  ON public.agent_lessons
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
