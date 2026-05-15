-- Full audit trail for every paper-agent decision, including skips/holds.
-- order_id is null when action = 'skip' or 'hold'.
CREATE TABLE agent_trades (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  ticker           text NOT NULL,
  action           text NOT NULL CHECK (action IN ('enter', 'exit', 'hold', 'skip')),
  order_id         uuid REFERENCES orders(id),
  confidence       text NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  reasoning        text NOT NULL,
  pattern_matches  jsonb NOT NULL DEFAULT '[]',
  risk_gates       jsonb NOT NULL DEFAULT '[]',
  context_snapshot jsonb NOT NULL DEFAULT '{}',
  model            text NOT NULL,
  input_tokens     integer NOT NULL DEFAULT 0,
  output_tokens    integer NOT NULL DEFAULT 0,
  cost_usd         numeric(10, 6) NOT NULL DEFAULT 0,
  decided_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON agent_trades
  USING (auth.uid() = user_id);

CREATE INDEX ON agent_trades(user_id, decided_at DESC);
