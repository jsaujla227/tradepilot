import { describe, expect, it } from "vitest";
import { FinnhubDataError, normalizeTicker } from "./data";

describe("normalizeTicker", () => {
  it("uppercases and trims plain symbols", () => {
    expect(normalizeTicker("aapl")).toBe("AAPL");
    expect(normalizeTicker("  msft  ")).toBe("MSFT");
  });

  it("allows dots and hyphens (BRK.B, BF-B)", () => {
    expect(normalizeTicker("brk.b")).toBe("BRK.B");
    expect(normalizeTicker("bf-b")).toBe("BF-B");
  });

  it("rejects empty, numeric-leading, or too-long input", () => {
    expect(() => normalizeTicker("")).toThrow(FinnhubDataError);
    expect(() => normalizeTicker("1AAPL")).toThrow(FinnhubDataError);
    expect(() => normalizeTicker("ABCDEFGHIJK")).toThrow(FinnhubDataError);
  });

  it("rejects whitespace or special chars inside the symbol", () => {
    expect(() => normalizeTicker("AA PL")).toThrow(FinnhubDataError);
    expect(() => normalizeTicker("AA/PL")).toThrow(FinnhubDataError);
    expect(() => normalizeTicker("'; DROP TABLE")).toThrow(FinnhubDataError);
  });

  it("attaches an invalid-ticker code on bad input", () => {
    try {
      normalizeTicker("bad ticker");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FinnhubDataError);
      expect((err as FinnhubDataError).code).toBe("invalid-ticker");
    }
  });
});
