import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock redis to a pass-through (no cache hits) so each test exercises the
// fetcher exactly once. The Redis module is server-only so we mock by path.
vi.mock("@/lib/redis", () => ({
  cached: async <T,>(_k: string, _ttl: number, fetcher: () => Promise<T>) => ({
    value: await fetcher(),
    hit: false,
  }),
}));

// Mock the finnhub fetch wrapper. We don't go to the network in tests; we
// hand-feed each test the raw payload shape we want to exercise.
const mockFetch = vi.fn();
vi.mock("./data", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    finnhubFetch: (path: string) => mockFetch(path),
  };
});

import {
  getEarningsContext,
  getNewsContext,
  getRecommendationContext,
  getTickerContext,
} from "./context";

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  mockFetch.mockReset();
});

describe("getEarningsContext", () => {
  it("returns the next earnings date and integer days-until for a matching symbol", async () => {
    const today = new Date();
    const future = new Date(today);
    future.setDate(future.getDate() + 7);
    const futureISO = future.toISOString().slice(0, 10);

    mockFetch.mockResolvedValueOnce({
      earningsCalendar: [
        { date: futureISO, symbol: "AAPL", epsActual: null, epsEstimate: 2.1 },
      ],
    });

    const ctx = await getEarningsContext("AAPL");
    expect(ctx).not.toBeNull();
    expect(ctx?.nextEarningsDate).toBe(futureISO);
    expect(ctx?.daysUntil).toBe(7);
  });

  it("returns nulls when no upcoming earnings are scheduled", async () => {
    mockFetch.mockResolvedValueOnce({ earningsCalendar: [] });
    const ctx = await getEarningsContext("AAPL");
    expect(ctx).toEqual({ nextEarningsDate: null, daysUntil: null });
  });

  it("handles a null earningsCalendar response", async () => {
    mockFetch.mockResolvedValueOnce({ earningsCalendar: null });
    const ctx = await getEarningsContext("AAPL");
    expect(ctx).toEqual({ nextEarningsDate: null, daysUntil: null });
  });

  it("filters out earnings for other symbols even if the API echoes them back", async () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    const iso = future.toISOString().slice(0, 10);
    mockFetch.mockResolvedValueOnce({
      earningsCalendar: [
        { date: iso, symbol: "MSFT" },
        { date: iso, symbol: "AAPL" },
      ],
    });
    const ctx = await getEarningsContext("AAPL");
    expect(ctx?.nextEarningsDate).toBe(iso);
  });

  it("returns null when the fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("upstream 500"));
    const ctx = await getEarningsContext("AAPL");
    expect(ctx).toBeNull();
  });
});

describe("getNewsContext", () => {
  it("returns the top 3 headlines, most recent first", async () => {
    mockFetch.mockResolvedValueOnce([
      { headline: "oldest", source: "X", datetime: 1_700_000_000, url: "u1" },
      { headline: "newest", source: "Y", datetime: 1_800_000_000, url: "u2" },
      { headline: "middle", source: "Z", datetime: 1_750_000_000, url: "u3" },
      { headline: "extra",  source: "W", datetime: 1_600_000_000, url: "u4" },
    ]);
    const news = await getNewsContext("AAPL");
    expect(news).not.toBeNull();
    expect(news?.map((n) => n.headline)).toEqual(["newest", "middle", "oldest"]);
    expect(news?.[0]?.datetime).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });

  it("returns an empty array when no news is available", async () => {
    mockFetch.mockResolvedValueOnce([]);
    const news = await getNewsContext("AAPL");
    expect(news).toEqual([]);
  });

  it("returns null on schema mismatch", async () => {
    mockFetch.mockResolvedValueOnce({ not: "an array" });
    const news = await getNewsContext("AAPL");
    expect(news).toBeNull();
  });
});

describe("getRecommendationContext", () => {
  it("returns only the latest period", async () => {
    mockFetch.mockResolvedValueOnce([
      { period: "2026-04-01", buy: 1, hold: 1, sell: 1, strongBuy: 0, strongSell: 0 },
      { period: "2026-05-01", buy: 5, hold: 3, sell: 1, strongBuy: 4, strongSell: 0 },
      { period: "2026-03-01", buy: 2, hold: 2, sell: 1, strongBuy: 1, strongSell: 0 },
    ]);
    const rec = await getRecommendationContext("AAPL");
    expect(rec?.period).toBe("2026-05-01");
    expect(rec?.buy).toBe(5);
    expect(rec?.strongBuy).toBe(4);
  });

  it("returns null when the array is empty", async () => {
    mockFetch.mockResolvedValueOnce([]);
    const rec = await getRecommendationContext("AAPL");
    expect(rec).toBeNull();
  });
});

describe("getTickerContext", () => {
  it("returns null sections when any endpoint fails — others still succeed", async () => {
    // Order: earnings → news → recommendation. Make news throw.
    mockFetch
      .mockResolvedValueOnce({ earningsCalendar: [] }) // earnings
      .mockRejectedValueOnce(new Error("rate limited")) // news
      .mockResolvedValueOnce([
        { period: "2026-05-01", buy: 1, hold: 1, sell: 1, strongBuy: 0, strongSell: 0 },
      ]); // recommendation

    const ctx = await getTickerContext("AAPL");
    expect(ctx.earnings).toEqual({ nextEarningsDate: null, daysUntil: null });
    expect(ctx.news).toBeNull();
    expect(ctx.recommendation?.period).toBe("2026-05-01");
  });
});
