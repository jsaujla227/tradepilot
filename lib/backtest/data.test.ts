import { describe, it, expect } from "vitest";
import { toHistoricalBar } from "./data";

describe("toHistoricalBar", () => {
  it("maps a row, coercing string numerics from Postgres", () => {
    const bar = toHistoricalBar({
      ticker: "AAPL",
      bar_date: "2024-03-01",
      open: "182.5",
      high: "184.0",
      low: "181.9",
      close: "183.2",
      volume: "52000000",
    });
    expect(bar).toEqual({
      ticker: "AAPL",
      date: "2024-03-01",
      open: 182.5,
      high: 184.0,
      low: 181.9,
      close: 183.2,
      volume: 52_000_000,
    });
  });

  it("accepts numeric fields already typed as numbers", () => {
    const bar = toHistoricalBar({
      ticker: "MSFT",
      bar_date: "2024-03-01",
      open: 400,
      high: 405,
      low: 398,
      close: 402,
      volume: 20_000_000,
    });
    expect(bar.close).toBe(402);
    expect(bar.date).toBe("2024-03-01");
  });

  it("throws on a malformed or missing row", () => {
    expect(() => toHistoricalBar({ ticker: "AAPL" })).toThrow();
    expect(() => toHistoricalBar(null)).toThrow();
  });
});
