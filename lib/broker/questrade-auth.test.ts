import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseTokenResponse,
  accessTokenIsValid,
  computeExpiresAt,
  exchangeRefreshToken,
  QuestradeAuthError,
} from "./questrade-auth";

const sample = {
  access_token: "acc-123",
  token_type: "Bearer",
  expires_in: 1800,
  refresh_token: "ref-456",
  api_server: "https://api01.iq.questrade.com/",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseTokenResponse", () => {
  it("maps a valid payload", () => {
    const t = parseTokenResponse(sample);
    expect(t.accessToken).toBe("acc-123");
    expect(t.refreshToken).toBe("ref-456");
    expect(t.apiServer).toBe("https://api01.iq.questrade.com/");
    expect(t.expiresIn).toBe(1800);
  });

  it("throws on a missing field", () => {
    const { access_token, ...rest } = sample;
    void access_token;
    expect(() => parseTokenResponse(rest)).toThrow(QuestradeAuthError);
  });

  it("throws on a non-object", () => {
    expect(() => parseTokenResponse(null)).toThrow(QuestradeAuthError);
  });

  it("throws when expires_in is not positive", () => {
    expect(() => parseTokenResponse({ ...sample, expires_in: 0 })).toThrow(
      QuestradeAuthError,
    );
  });
});

describe("accessTokenIsValid", () => {
  const now = 1_000_000_000_000;

  it("is true well before expiry", () => {
    expect(
      accessTokenIsValid(new Date(now + 600_000).toISOString(), now),
    ).toBe(true);
  });

  it("is false past expiry", () => {
    expect(accessTokenIsValid(new Date(now - 1).toISOString(), now)).toBe(
      false,
    );
  });

  it("is false within the 60s refresh margin", () => {
    expect(
      accessTokenIsValid(new Date(now + 30_000).toISOString(), now),
    ).toBe(false);
  });

  it("is false for null or an unparseable string", () => {
    expect(accessTokenIsValid(null, now)).toBe(false);
    expect(accessTokenIsValid("not-a-date", now)).toBe(false);
  });
});

describe("computeExpiresAt", () => {
  it("adds expires_in seconds to now", () => {
    const now = 1_000_000_000_000;
    expect(computeExpiresAt(1800, now)).toBe(
      new Date(now + 1_800_000).toISOString(),
    );
  });
});

describe("exchangeRefreshToken", () => {
  it("returns tokens on a 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(sample), { status: 200 })),
    );
    const t = await exchangeRefreshToken("old-token");
    expect(t.accessToken).toBe("acc-123");
    expect(t.refreshToken).toBe("ref-456");
    expect(t.apiServer).toBe("https://api01.iq.questrade.com/");
  });

  it("throws invalid-refresh-token on HTTP 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Bad Request", { status: 400 })),
    );
    await expect(exchangeRefreshToken("dead")).rejects.toMatchObject({
      code: "invalid-refresh-token",
    });
  });

  it("throws token-request-failed on HTTP 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status: 500 })),
    );
    await expect(exchangeRefreshToken("x")).rejects.toMatchObject({
      code: "token-request-failed",
    });
  });

  it("throws network-error when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(exchangeRefreshToken("x")).rejects.toMatchObject({
      code: "network-error",
    });
  });

  it("throws bad-response when the payload is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 })),
    );
    await expect(exchangeRefreshToken("x")).rejects.toMatchObject({
      code: "bad-response",
    });
  });
});
