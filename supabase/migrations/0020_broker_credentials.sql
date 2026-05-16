-- Q1: broker_credentials — per-user OAuth credentials for live broker access
-- (Questrade). Questrade rotates the refresh token on every token exchange,
-- so it cannot live in a static env var; it is persisted here and updated in
-- place. Sensitive: RLS scopes every row to its owner; cron paths reach it
-- via the service-role client. Postgres encrypts the table at rest.
--
-- Token rotation is made safe with a compare-and-swap UPDATE in application
-- code (update ... where refresh_token = <old>): a stale write affects zero
-- rows, so a concurrent refresh cannot clobber a newer token.

CREATE TABLE public.broker_credentials (
  user_id                  UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider                 TEXT         NOT NULL DEFAULT 'questrade',
  refresh_token            TEXT         NOT NULL,
  access_token             TEXT,
  access_token_expires_at  TIMESTAMPTZ,
  api_server               TEXT,
  account_id               TEXT,
  connected_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.broker_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "broker_credentials: user owns row"
  ON public.broker_credentials
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER broker_credentials_set_updated_at
  BEFORE UPDATE ON public.broker_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
