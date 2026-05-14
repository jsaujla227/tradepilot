-- M4: holdings computation + positions view.
--
-- compute_holdings: runs in caller context (security invoker), so RLS on
-- public.transactions automatically scopes to the calling user. Streams
-- transactions ordered by (ticker, time) and maintains a running
-- (qty, avg_cost) per ticker. Average cost on net position: buys do a
-- weighted average, sells decrement qty without touching avg cost. An
-- oversell zeros the position; the next buy starts a fresh basis.
--
-- Why a function instead of a view: a view would have to compute avg cost
-- via window functions, which is tricky with the "sells don't change avg"
-- rule (the running cost basis depends on prior state). The procedural
-- function is easier to read and audit.

create or replace function public.compute_holdings()
returns table (
  ticker text,
  qty numeric(20, 4),
  avg_cost numeric(20, 4),
  cost_basis numeric(20, 2)
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  rec record;
  v_ticker text := null;
  v_qty numeric(20, 4) := 0;
  v_avg numeric(20, 4) := 0;
begin
  for rec in
    select t.ticker as tk, t.side, t.qty as q, t.price as p
    from public.transactions t
    order by t.ticker, t.executed_at, t.created_at
  loop
    if v_ticker is distinct from rec.tk then
      if v_ticker is not null and v_qty > 0 then
        ticker := v_ticker;
        qty := v_qty;
        avg_cost := v_avg;
        cost_basis := round(v_qty * v_avg, 2);
        return next;
      end if;
      v_ticker := rec.tk;
      v_qty := 0;
      v_avg := 0;
    end if;

    if rec.side = 'buy' then
      v_avg := (v_qty * v_avg + rec.q * rec.p) / (v_qty + rec.q);
      v_qty := v_qty + rec.q;
    else
      if rec.q >= v_qty then
        v_qty := 0;
        v_avg := 0;
      else
        v_qty := v_qty - rec.q;
      end if;
    end if;
  end loop;

  if v_ticker is not null and v_qty > 0 then
    ticker := v_ticker;
    qty := v_qty;
    avg_cost := v_avg;
    cost_basis := round(v_qty * v_avg, 2);
    return next;
  end if;
end;
$$;

revoke execute on function public.compute_holdings() from public, anon;
grant execute on function public.compute_holdings() to authenticated;

-- positions: groups a ticker's buy/sell sequence into one position_id per
-- "open → close" cycle. A new position starts whenever the running net
-- before the txn is 0. closed_at is set when the running net after a txn
-- reaches 0. realized_pnl is computed only for closed positions. M9 uses
-- this view for the journal.
create or replace view public.positions
with (security_invoker = on)
as
with txns as (
  select
    t.id, t.user_id, t.ticker, t.side, t.qty, t.price,
    t.executed_at, t.created_at,
    case when t.side = 'buy' then t.qty else -t.qty end as signed_qty
  from public.transactions t
),
running as (
  select *,
    sum(signed_qty) over (
      partition by user_id, ticker
      order by executed_at, created_at
      rows between unbounded preceding and current row
    ) as net_after,
    coalesce(
      sum(signed_qty) over (
        partition by user_id, ticker
        order by executed_at, created_at
        rows between unbounded preceding and 1 preceding
      ),
      0
    ) as net_before
  from txns
),
seq as (
  select *,
    sum(case when net_before = 0 then 1 else 0 end) over (
      partition by user_id, ticker
      order by executed_at, created_at
      rows between unbounded preceding and current row
    ) as position_seq
  from running
)
select
  user_id::text || ':' || ticker || ':' || position_seq::text as position_id,
  user_id,
  ticker,
  position_seq,
  min(executed_at) as opened_at,
  max(executed_at) filter (where net_after = 0) as closed_at,
  bool_or(net_after = 0) as is_closed,
  sum(case when side = 'buy' then qty else 0 end) as total_bought,
  sum(case when side = 'sell' then qty else 0 end) as total_sold,
  round(sum(case when side = 'buy' then qty * price else 0 end), 2) as total_buy_cost,
  round(sum(case when side = 'sell' then qty * price else 0 end), 2) as total_sell_proceeds,
  case
    when bool_or(net_after = 0) then
      round(
        sum(case when side = 'sell' then qty * price else 0 end)
        - sum(case when side = 'buy' then qty * price else 0 end),
        2
      )
    else null
  end as realized_pnl,
  count(*) as transaction_count
from seq
group by user_id, ticker, position_seq;
