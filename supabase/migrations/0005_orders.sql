-- M6: orders table + paper broker support
-- Orders fill synchronously at the last cached Finnhub quote (Canada pivot; no external broker).

-- 1. Lifecycle status for paper orders
CREATE TYPE public.order_status AS ENUM ('pending', 'filled', 'cancelled', 'rejected');

-- 2. Add 'paper' source so broker-filled transactions are distinct from manual/csv entries
ALTER TYPE public.transaction_source ADD VALUE IF NOT EXISTS 'paper';

-- 3. Orders table
CREATE TABLE public.orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker        TEXT NOT NULL,
  side          public.transaction_side NOT NULL,
  qty           NUMERIC(18, 8) NOT NULL CHECK (qty > 0),
  status        public.order_status NOT NULL DEFAULT 'pending',
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filled_price  NUMERIC(18, 8),
  filled_qty    NUMERIC(18, 8),
  filled_at     TIMESTAMPTZ,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. RLS: each user sees only their own orders
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders: user owns row"
  ON public.orders
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. Wire transactions.order_id → orders.id (column added in M4; FK was deferred to M6)
ALTER TABLE public.transactions
  ADD CONSTRAINT fk_transactions_order
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
