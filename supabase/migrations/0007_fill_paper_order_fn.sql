-- M6-fix: atomic paper order fill.
-- Wraps the order→filled update and transactions insert in a single
-- server-side function so a mid-flight process crash cannot leave an
-- order marked "filled" with no linked transaction row.
--
-- Security: SECURITY INVOKER so the caller's RLS context applies.
-- The authenticated user can only touch rows where user_id = auth.uid().

CREATE OR REPLACE FUNCTION public.fill_paper_order(
  p_order_id     UUID,
  p_user_id      UUID,
  p_ticker       TEXT,
  p_side         public.transaction_side,
  p_qty          NUMERIC,
  p_fill_price   NUMERIC,
  p_filled_at    TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.orders
  SET
    status       = 'filled',
    filled_price = p_fill_price,
    filled_qty   = p_qty,
    filled_at    = p_filled_at
  WHERE id = p_order_id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % not found or does not belong to user', p_order_id;
  END IF;

  INSERT INTO public.transactions (
    user_id, ticker, side, qty, price, fees, executed_at, source, order_id
  ) VALUES (
    p_user_id, p_ticker, p_side, p_qty, p_fill_price, 0, p_filled_at, 'paper', p_order_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fill_paper_order FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.fill_paper_order TO authenticated;
