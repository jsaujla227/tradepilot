-- Security hardening for the broker-mode enforcement trigger function.
-- Clears two Supabase database-linter findings:
--   * function_search_path_mutable
--   * anon / authenticated security-definer function is executable
--
-- enforce_broker_mode_unlock() is a trigger function only — it must never be
-- reachable as a standalone PostgREST RPC. Pinning search_path removes the
-- mutable-path risk; revoking EXECUTE from the API roles removes the RPC
-- surface. The trigger itself is unaffected: triggers invoke their function
-- regardless of EXECUTE grants.

ALTER FUNCTION public.enforce_broker_mode_unlock() SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.enforce_broker_mode_unlock() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_broker_mode_unlock() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_broker_mode_unlock() FROM authenticated;
