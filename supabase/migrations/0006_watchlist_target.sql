-- M8: add target_price to watchlist so R-multiple scoring can be computed
ALTER TABLE public.watchlist ADD COLUMN IF NOT EXISTS target_price NUMERIC(18, 8);
