-- M17: DB-level enforcement — prevent broker_mode = 'live' unless real_money_unlocked.
-- Application layer (settings action) validates first; this trigger is the
-- safety net so no SQL path can bypass the lock.

CREATE OR REPLACE FUNCTION public.enforce_broker_mode_unlock()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.broker_mode = 'live' AND NEW.real_money_unlocked = FALSE THEN
    RAISE EXCEPTION 'broker_mode cannot be set to ''live'' while real_money_unlocked is false';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER profiles_broker_mode_lock
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_broker_mode_unlock();
