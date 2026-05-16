import { describe, it, expect } from "vitest";
import {
  mapOrderState,
  questradeOrderToBrokerOrder,
  type QuestradeOrder,
} from "./questrade-api";

describe("mapOrderState", () => {
  it("maps executed to filled", () => {
    expect(mapOrderState("Executed")).toBe("filled");
  });

  it("maps canceled and expired to cancelled", () => {
    expect(mapOrderState("Canceled")).toBe("cancelled");
    expect(mapOrderState("Expired")).toBe("cancelled");
  });

  it("maps rejected and failed to rejected", () => {
    expect(mapOrderState("Rejected")).toBe("rejected");
    expect(mapOrderState("Failed")).toBe("rejected");
  });

  it("maps open and unknown states to pending", () => {
    expect(mapOrderState("Pending")).toBe("pending");
    expect(mapOrderState("Queued")).toBe("pending");
    expect(mapOrderState("Partial")).toBe("pending");
    expect(mapOrderState("Whatever")).toBe("pending");
  });
});

describe("questradeOrderToBrokerOrder", () => {
  const base: QuestradeOrder = {
    id: 12345,
    symbol: "AAPL",
    totalQuantity: 10,
    filledQuantity: 10,
    side: "Buy",
    state: "Executed",
    avgExecPrice: 187.5,
    creationTime: "2026-05-16T14:30:00Z",
    updateTime: "2026-05-16T14:31:00Z",
  };

  it("maps a filled buy order", () => {
    const o = questradeOrderToBrokerOrder(base);
    expect(o.id).toBe("12345");
    expect(o.ticker).toBe("AAPL");
    expect(o.side).toBe("buy");
    expect(o.qty).toBe(10);
    expect(o.status).toBe("filled");
    expect(o.broker_mode).toBe("live");
    expect(o.filled_price).toBe(187.5);
    expect(o.filled_qty).toBe(10);
    expect(o.filled_at).toBe("2026-05-16T14:31:00Z");
    expect(o.submitted_at).toBe("2026-05-16T14:30:00Z");
  });

  it("lowercases a sell side", () => {
    expect(questradeOrderToBrokerOrder({ ...base, side: "Sell" }).side).toBe(
      "sell",
    );
  });

  it("leaves filled_at null for a pending order", () => {
    const o = questradeOrderToBrokerOrder({
      ...base,
      state: "Queued",
      filledQuantity: 0,
      avgExecPrice: null,
    });
    expect(o.status).toBe("pending");
    expect(o.filled_at).toBeNull();
    expect(o.filled_price).toBeNull();
  });

  it("tolerates missing optional fields", () => {
    const o = questradeOrderToBrokerOrder({
      id: 9,
      symbol: "MSFT",
      totalQuantity: 5,
      side: "Buy",
      state: "Pending",
      creationTime: "2026-05-16T10:00:00Z",
    });
    expect(o.filled_price).toBeNull();
    expect(o.filled_qty).toBeNull();
    expect(o.filled_at).toBeNull();
  });
});
