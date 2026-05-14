-- M4: trading-data schema. All tables RLS-scoped to the owning user.
--
-- Lifecycle:
--   - cash_transactions: deposits/withdrawals (separate from buy/sell flow)
--   - transactions:      every fill, manual / CSV / Alpaca (M6 adds order_id FK)
--   - ticker_meta:       user-managed sector tagging (powers M8 concentration)
--   - trade_checklists:  M7 captures one per intended trade (pre-trade)
--   - trade_reviews:     M9 prompts one per closed position (post-trade)
--   - watchlist:         M8
--   - portfolio_snapshots: M11 daily cron
--   - ai_notes:          M10 audit trail with token cost

create type public.cash_transaction_type as enum ('deposit', 'withdrawal');
create type public.transaction_side as enum ('buy', 'sell');
create type public.transaction_source as enum ('manual', 'csv', 'alpaca');

create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type public.cash_transaction_type not null,
  amount numeric(20, 2) not null check (amount > 0),
  occurred_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);
create index cash_transactions_user_idx
  on public.cash_transactions (user_id, occurred_at desc);
alter table public.cash_transactions enable row level security;

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker = upper(ticker) and length(ticker) between 1 and 12),
  side public.transaction_side not null,
  qty numeric(20, 4) not null check (qty > 0),
  price numeric(20, 4) not null check (price > 0),
  fees numeric(20, 2) not null default 0 check (fees >= 0),
  executed_at timestamptz not null default now(),
  source public.transaction_source not null default 'manual',
  order_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index transactions_user_ticker_idx
  on public.transactions (user_id, ticker, executed_at, created_at);
alter table public.transactions enable row level security;

create table public.ticker_meta (
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker = upper(ticker)),
  sector text,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, ticker)
);
alter table public.ticker_meta enable row level security;

create trigger ticker_meta_set_updated_at
  before update on public.ticker_meta
  for each row execute function public.set_updated_at();

create table public.trade_checklists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker = upper(ticker)),
  side public.transaction_side not null,
  entry numeric(20, 4) not null check (entry > 0),
  stop numeric(20, 4) not null check (stop > 0),
  target numeric(20, 4) not null check (target > 0),
  qty numeric(20, 4) not null check (qty > 0),
  reason text,
  what_could_go_wrong text,
  position_size_at_entry numeric(20, 2),
  r_at_entry numeric(10, 4),
  daily_loss_at_entry numeric(20, 2),
  created_at timestamptz not null default now()
);
create index trade_checklists_user_idx
  on public.trade_checklists (user_id, created_at desc);
alter table public.trade_checklists enable row level security;

create table public.trade_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id text not null,
  ticker text not null check (ticker = upper(ticker)),
  realized_pnl numeric(20, 2),
  r_realized numeric(10, 4),
  what_worked text,
  what_didnt text,
  lessons text,
  reviewed_at timestamptz not null default now(),
  unique (user_id, position_id)
);
create index trade_reviews_user_idx
  on public.trade_reviews (user_id, reviewed_at desc);
alter table public.trade_reviews enable row level security;

create table public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker = upper(ticker)),
  target_entry numeric(20, 4),
  target_stop numeric(20, 4),
  reason text,
  notes text,
  added_at timestamptz not null default now(),
  unique (user_id, ticker)
);
create index watchlist_user_idx
  on public.watchlist (user_id, added_at desc);
alter table public.watchlist enable row level security;

create table public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  total_value numeric(20, 2) not null,
  cash numeric(20, 2) not null,
  positions_value numeric(20, 2) not null,
  realized_pnl_today numeric(20, 2) not null default 0,
  unique (user_id, snapshot_date)
);
create index portfolio_snapshots_user_date_idx
  on public.portfolio_snapshots (user_id, snapshot_date desc);
alter table public.portfolio_snapshots enable row level security;

create table public.ai_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  response text not null,
  model text not null,
  data_provided jsonb not null default '{}'::jsonb,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index ai_notes_user_idx on public.ai_notes (user_id, created_at desc);
alter table public.ai_notes enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'cash_transactions','transactions','ticker_meta','trade_checklists',
    'trade_reviews','watchlist','portfolio_snapshots','ai_notes'
  ])
  loop
    execute format('create policy %I on public.%I for select using (auth.uid() = user_id);', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert with check (auth.uid() = user_id);', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete using (auth.uid() = user_id);', t || '_delete_own', t);
  end loop;
end$$;
