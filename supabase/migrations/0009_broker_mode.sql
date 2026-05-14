-- M13: broker abstraction — mode switch + agent config
-- Adds broker_mode to profiles and orders; agent enable/disable toggle and
-- daily capital limit. Real-money unlock flag (manual, gated by M16 metrics).

-- 1. profiles: broker mode + agent settings
ALTER TABLE public.profiles
  ADD COLUMN broker_mode TEXT NOT NULL DEFAULT 'paper'
    CONSTRAINT broker_mode_values CHECK (broker_mode IN ('paper', 'live')),
  ADD COLUMN real_money_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN agent_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN agent_daily_capital_limit NUMERIC(18, 2) NOT NULL DEFAULT 500
    CONSTRAINT agent_capital_non_negative CHECK (agent_daily_capital_limit >= 0);

-- 2. Prevent switching to live unless real_money_unlocked = true
--    Enforced at the application layer (settings action) for flexibility;
--    DB-level enforcement is deferred to M17 (Questrade adapter) when
--    the full live-trade constraints are known.

-- 3. orders: tag each order with the broker mode that filled it
ALTER TABLE public.orders
  ADD COLUMN broker_mode TEXT NOT NULL DEFAULT 'paper'
    CONSTRAINT orders_broker_mode_values CHECK (broker_mode IN ('paper', 'live'));

-- 4. Backfill: all existing orders are paper trades
UPDATE public.orders SET broker_mode = 'paper';
