-- Stores extracted personal trading patterns derived from the user's own
-- trade_reviews + trade_checklists. Rebuilt on every journal review submission.
CREATE TABLE learned_patterns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  pattern_type  text NOT NULL CHECK (pattern_type IN ('winning', 'losing', 'neutral')),
  description   text NOT NULL,
  conditions    jsonb NOT NULL DEFAULT '{}',
  stats         jsonb NOT NULL DEFAULT '{}',
  computed_at   timestamptz NOT NULL DEFAULT now(),
  sample_count  integer NOT NULL DEFAULT 0
);

ALTER TABLE learned_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON learned_patterns
  USING (auth.uid() = user_id);

CREATE INDEX ON learned_patterns(user_id, pattern_type);
