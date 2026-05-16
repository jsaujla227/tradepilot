import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrokerCredentials, applyRotatedTokens } from "./credentials";

// Questrade OAuth client. Questrade rotates the refresh token on every token
// exchange and invalidates the old one, so each exchange's refresh_token must
// be persisted immediately. The token endpoint lives at the login host; the
// returned api_server is the base URL for all subsequent data/order calls.

const QUESTRADE_TOKEN_URL = "https://login.questrade.com/oauth2/token";
// Refresh this many ms before the access token's real expiry.
const REFRESH_MARGIN_MS = 60_000;

export type QuestradeAuthErrorCode =
  | "not-connected"
  | "invalid-refresh-token"
  | "token-request-failed"
  | "bad-response"
  | "network-error"
  | "refresh-failed";

export class QuestradeAuthError extends Error {
  readonly code: QuestradeAuthErrorCode;
  constructor(message: string, code: QuestradeAuthErrorCode) {
    super(message);
    this.name = "QuestradeAuthError";
    this.code = code;
  }
}

export type QuestradeTokens = {
  accessToken: string;
  refreshToken: string;
  apiServer: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
};

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1),
  api_server: z.string().url(),
});

/** Validates a raw Questrade token-endpoint payload. Pure. */
export function parseTokenResponse(raw: unknown): QuestradeTokens {
  const parsed = tokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new QuestradeAuthError(
      "Unexpected response from the Questrade token endpoint",
      "bad-response",
    );
  }
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    apiServer: parsed.data.api_server,
    expiresIn: parsed.data.expires_in,
  };
}

/** True when the access token is present and not within the refresh margin
 *  of expiry. Pure. */
export function accessTokenIsValid(
  expiresAtIso: string | null,
  now: number = Date.now(),
): boolean {
  if (!expiresAtIso) return false;
  const expiresAt = Date.parse(expiresAtIso);
  if (Number.isNaN(expiresAt)) return false;
  return expiresAt > now + REFRESH_MARGIN_MS;
}

/** ISO timestamp for when an access token issued `now` expires. Pure. */
export function computeExpiresAt(
  expiresIn: number,
  now: number = Date.now(),
): string {
  return new Date(now + expiresIn * 1000).toISOString();
}

/**
 * Exchanges a refresh token for a fresh token set. Questrade rotates the
 * refresh token on every call, so the returned refreshToken must be persisted
 * and the one passed in is now dead.
 */
export async function exchangeRefreshToken(
  refreshToken: string,
): Promise<QuestradeTokens> {
  const url =
    `${QUESTRADE_TOKEN_URL}?grant_type=refresh_token` +
    `&refresh_token=${encodeURIComponent(refreshToken)}`;

  let res: Response;
  try {
    res = await fetch(url, { method: "GET" });
  } catch {
    throw new QuestradeAuthError(
      "Could not reach the Questrade token endpoint",
      "network-error",
    );
  }

  if (!res.ok) {
    if (res.status === 400) {
      throw new QuestradeAuthError(
        "Questrade rejected the refresh token — reconnect your account",
        "invalid-refresh-token",
      );
    }
    throw new QuestradeAuthError(
      `Questrade token request failed (HTTP ${res.status})`,
      "token-request-failed",
    );
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new QuestradeAuthError(
      "Questrade token response was not valid JSON",
      "bad-response",
    );
  }
  return parseTokenResponse(raw);
}

export type ValidAccessToken = {
  accessToken: string;
  apiServer: string;
  accountId: string | null;
};

/**
 * Returns a usable Questrade access token for the user, refreshing it when the
 * cached one is missing or near expiry. The rotated refresh token is persisted
 * with a compare-and-swap so a concurrent refresh cannot clobber a newer
 * token; on a lost swap this re-reads and uses the winner's token.
 */
export async function getValidAccessToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<ValidAccessToken> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const creds = await getBrokerCredentials(supabase, userId);
    if (!creds) {
      throw new QuestradeAuthError(
        "Questrade is not connected for this user",
        "not-connected",
      );
    }

    if (
      creds.accessToken &&
      creds.apiServer &&
      accessTokenIsValid(creds.accessTokenExpiresAt)
    ) {
      return {
        accessToken: creds.accessToken,
        apiServer: creds.apiServer,
        accountId: creds.accountId,
      };
    }

    let tokens: QuestradeTokens;
    try {
      tokens = await exchangeRefreshToken(creds.refreshToken);
    } catch (err) {
      // A concurrent refresh may have rotated the token under us — re-read once.
      if (attempt === 0) continue;
      throw err;
    }

    const swapped = await applyRotatedTokens(
      supabase,
      userId,
      creds.refreshToken,
      {
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: computeExpiresAt(tokens.expiresIn),
        apiServer: tokens.apiServer,
      },
    );
    if (swapped) {
      return {
        accessToken: tokens.accessToken,
        apiServer: tokens.apiServer,
        accountId: creds.accountId,
      };
    }
    // Lost the compare-and-swap — loop to read the concurrent winner's tokens.
  }

  throw new QuestradeAuthError(
    "Could not obtain a valid Questrade access token",
    "refresh-failed",
  );
}
