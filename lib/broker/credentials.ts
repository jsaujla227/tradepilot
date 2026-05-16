import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Data-access layer for broker_credentials (migration 0020). The caller passes
// the Supabase client so a Server Action can use the user-session client and a
// cron can use the service-role client.

export type BrokerCredentials = {
  userId: string;
  provider: string;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  apiServer: string | null;
  accountId: string | null;
  connectedAt: string;
  updatedAt: string;
};

function toBrokerCredentials(row: Record<string, unknown>): BrokerCredentials {
  return {
    userId: String(row.user_id),
    provider: String(row.provider),
    refreshToken: String(row.refresh_token),
    accessToken: (row.access_token as string | null) ?? null,
    accessTokenExpiresAt:
      (row.access_token_expires_at as string | null) ?? null,
    apiServer: (row.api_server as string | null) ?? null,
    accountId: (row.account_id as string | null) ?? null,
    connectedAt: String(row.connected_at),
    updatedAt: String(row.updated_at),
  };
}

export async function getBrokerCredentials(
  supabase: SupabaseClient,
  userId: string,
): Promise<BrokerCredentials | null> {
  const { data, error } = await supabase
    .from("broker_credentials")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return toBrokerCredentials(data as Record<string, unknown>);
}

export type RotatedTokens = {
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  apiServer: string;
};

/**
 * Compare-and-swap update of the rotating tokens. The update only lands when
 * the stored refresh_token still equals `expectedRefreshToken` — a concurrent
 * refresh that already rotated the token makes this a zero-row no-op. Returns
 * true when this call won the swap.
 */
export async function applyRotatedTokens(
  supabase: SupabaseClient,
  userId: string,
  expectedRefreshToken: string,
  next: RotatedTokens,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("broker_credentials")
    .update({
      refresh_token: next.refreshToken,
      access_token: next.accessToken,
      access_token_expires_at: next.accessTokenExpiresAt,
      api_server: next.apiServer,
    })
    .eq("user_id", userId)
    .eq("refresh_token", expectedRefreshToken)
    .select("user_id");
  if (error || !data) return false;
  return data.length > 0;
}

/**
 * Stores a fresh Questrade connection (insert or full overwrite). account_id
 * is left untouched so a re-connect keeps any selected account.
 */
export async function upsertBrokerCredentials(
  supabase: SupabaseClient,
  userId: string,
  fields: {
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: string;
    apiServer: string;
  },
): Promise<boolean> {
  const { error } = await supabase.from("broker_credentials").upsert(
    {
      user_id: userId,
      provider: "questrade",
      refresh_token: fields.refreshToken,
      access_token: fields.accessToken,
      access_token_expires_at: fields.accessTokenExpiresAt,
      api_server: fields.apiServer,
    },
    { onConflict: "user_id" },
  );
  return !error;
}

/** Removes the user's broker connection entirely. */
export async function deleteBrokerCredentials(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("broker_credentials")
    .delete()
    .eq("user_id", userId);
  return !error;
}
