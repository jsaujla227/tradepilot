-- M3: profiles table for per-user trading settings.
-- One row per auth.users entry, auto-created on signup. RLS scoped to owner.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_size_initial numeric(20, 2) not null default 10000,
  max_risk_per_trade_pct numeric(5, 2) not null default 1.00,
  daily_loss_limit_pct numeric(5, 2) not null default 3.00,
  ai_token_budget_monthly integer not null default 100000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_size_positive
    check (account_size_initial > 0),
  constraint max_risk_in_range
    check (max_risk_per_trade_pct > 0 and max_risk_per_trade_pct < 100),
  constraint daily_loss_in_range
    check (daily_loss_limit_pct > 0 and daily_loss_limit_pct < 100),
  constraint ai_budget_non_negative
    check (ai_token_budget_monthly >= 0)
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = user_id);

create policy "profiles_insert_own"
  on public.profiles
  for insert
  with check (auth.uid() = user_id);

create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Auto-update updated_at on every mutation.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Auto-create a profile row when a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
