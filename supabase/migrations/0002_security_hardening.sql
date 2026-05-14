-- M3 follow-up: lock down profile bootstrap trigger from being RPC-callable
-- and set immutable search_path on the updated_at trigger function.
--
-- Why: handle_new_user() is SECURITY DEFINER so the trigger can write to
-- public.profiles regardless of the inserting user's grants. Supabase exposes
-- public functions as RPCs by default, so anon could call /rest/v1/rpc/
-- handle_new_user and create rows. Revoking execute keeps the trigger working
-- (triggers run as the function owner regardless of grants) but blocks the
-- RPC surface.

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
