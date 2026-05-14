import { describe, expect, it } from "vitest";
import { AlpacaDataError, normalizeTicker } from "./data";

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
    expect(() => normalizeTicker("")).toThrow(AlpacaDataError);
    expect(() => normalizeTicker("1AAPL")).toThrow(AlpacaDataError);
    expect(() => normalizeTicker("ABCDEFGHIJK")).toThrow(AlpacaDataError);
  });

  it("rejects whitespace or special chars inside the symbol", () => {
    expect(() => normalizeTicker("AA PL")).toThrow(AlpacaDataError);
    expect(() => normalizeTicker("AA/PL")).toThrow(AlpacaDataError);
    expect(() => normalizeTicker("'; DROP TABLE")).toThrow(AlpacaDataError);
  });
});
