import { describe, it, expect } from "vitest";
import {
  LIVE_CAPITAL_CAP_MAX,
  cappedLiveCapital,
  liveOrderShares,
  isLiveRoutingEligible,
} from "./live";

describe("cappedLiveCapital", () => {
  it("passes through a request within the ceiling", () => {
    expect(cappedLiveCapital(250)).toBe(250);
  });

  it("clamps any request above the hard ceiling", () => {
    expect(cappedLiveCapital(5000)).toBe(LIVE_CAPITAL_CAP_MAX);
    expect(cappedLiveCapital(Number.MAX_SAFE_INTEGER)).toBe(
      LIVE_CAPITAL_CAP_MAX,
    );
  });

  it("yields 0 for a non-positive or non-finite request", () => {
    expect(cappedLiveCapital(0)).toBe(0);
    expect(cappedLiveCapital(-100)).toBe(0);
    expect(cappedLiveCapital(Number.NaN)).toBe(0);
    expect(cappedLiveCapital(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("liveOrderShares", () => {
  it("floors to whole shares affordable within the capital", () => {
    expect(liveOrderShares(50, 500)).toBe(10);
    expect(liveOrderShares(30, 500)).toBe(16);
  });

  it("yields 0 for invalid price or capital", () => {
    expect(liveOrderShares(0, 500)).toBe(0);
    expect(liveOrderShares(50, 0)).toBe(0);
    expect(liveOrderShares(-1, 500)).toBe(0);
  });
});

describe("isLiveRoutingEligible", () => {
  it("permits only live_small and approved strategies", () => {
    expect(isLiveRoutingEligible("live_small")).toBe(true);
    expect(isLiveRoutingEligible("approved")).toBe(true);
    expect(isLiveRoutingEligible("paper")).toBe(false);
    expect(isLiveRoutingEligible("backtested")).toBe(false);
    expect(isLiveRoutingEligible("draft")).toBe(false);
    expect(isLiveRoutingEligible("rejected")).toBe(false);
  });
});
