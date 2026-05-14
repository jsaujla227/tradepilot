import { describe, it, expect } from "vitest";
import type { BrokerAdapter, BrokerOrder, SubmitOrderParams } from "./types";

// A minimal in-memory fake that satisfies the BrokerAdapter interface.
// If the interface changes in a breaking way, this test won't compile.
class FakeAdapter implements BrokerAdapter {
  readonly mode = "paper" as const;
  private store: BrokerOrder[] = [];

  async submitOrder(params: SubmitOrderParams): Promise<BrokerOrder> {
    const order: BrokerOrder = {
      id: `fake-${Date.now()}`,
      ticker: params.ticker,
      side: params.side,
      qty: params.qty,
      status: "filled",
      broker_mode: "paper",
      submitted_at: new Date().toISOString(),
      filled_price: 100,
      filled_qty: params.qty,
      filled_at: new Date().toISOString(),
      note: params.note ?? null,
      created_at: new Date().toISOString(),
    };
    this.store.push(order);
    return order;
  }

  async listOrders(userId: string, limit = 50): Promise<BrokerOrder[]> {
    void userId;
    return this.store.slice(0, limit);
  }

  async getOrder(orderId: string, userId: string): Promise<BrokerOrder | null> {
    void userId;
    return this.store.find((o) => o.id === orderId) ?? null;
  }

  async cancelOrder(orderId: string, userId: string): Promise<boolean> {
    void userId;
    const idx = this.store.findIndex((o) => o.id === orderId);
    if (idx === -1) return false;
    this.store[idx] = { ...this.store[idx]!, status: "cancelled" };
    return true;
  }
}

describe("BrokerAdapter contract", () => {
  it("submitOrder returns a filled BrokerOrder with all required fields", async () => {
    const adapter: BrokerAdapter = new FakeAdapter();
    const order = await adapter.submitOrder({ ticker: "AAPL", side: "buy", qty: 10 });
    expect(order.id).toBeTruthy();
    expect(order.ticker).toBe("AAPL");
    expect(order.side).toBe("buy");
    expect(order.qty).toBe(10);
    expect(order.status).toBe("filled");
    expect(order.broker_mode).toBe("paper");
    expect(order.filled_price).not.toBeNull();
    expect(order.filled_qty).toBe(10);
  });

  it("listOrders returns submitted orders", async () => {
    const adapter: BrokerAdapter = new FakeAdapter();
    await adapter.submitOrder({ ticker: "MSFT", side: "buy", qty: 5 });
    await adapter.submitOrder({ ticker: "GOOG", side: "sell", qty: 2 });
    const orders = await adapter.listOrders("user-1");
    expect(orders).toHaveLength(2);
  });

  it("getOrder returns the right order by id", async () => {
    const adapter: BrokerAdapter = new FakeAdapter();
    const created = await adapter.submitOrder({ ticker: "TSLA", side: "buy", qty: 1 });
    const fetched = await adapter.getOrder(created.id, "user-1");
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.ticker).toBe("TSLA");
  });

  it("cancelOrder flips status to cancelled", async () => {
    const adapter: BrokerAdapter = new FakeAdapter();
    const order = await adapter.submitOrder({ ticker: "NVDA", side: "buy", qty: 3 });
    const ok = await adapter.cancelOrder(order.id, "user-1");
    expect(ok).toBe(true);
    const fetched = await adapter.getOrder(order.id, "user-1");
    expect(fetched?.status).toBe("cancelled");
  });

  it("getOrder returns null for unknown id", async () => {
    const adapter: BrokerAdapter = new FakeAdapter();
    const result = await adapter.getOrder("does-not-exist", "user-1");
    expect(result).toBeNull();
  });
});
