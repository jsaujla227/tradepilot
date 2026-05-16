-- R1: portfolio heat ceiling. Adds a per-user cap on total open R-at-risk
-- across all open positions, expressed as a percent of account size. The
-- risk overlays surface a warning as aggregate open risk approaches this
-- ceiling. Default 6.00 follows the common "6% portfolio heat" guideline.

ALTER TABLE public.profiles
  ADD COLUMN max_portfolio_heat_pct NUMERIC(5, 2) NOT NULL DEFAULT 6.00;

ALTER TABLE public.profiles
  ADD CONSTRAINT max_portfolio_heat_in_range
    CHECK (max_portfolio_heat_pct > 0 AND max_portfolio_heat_pct < 100);
