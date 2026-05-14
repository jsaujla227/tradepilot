import "server-only";

export type OrderSide = "buy" | "sell";
export type OrderStatus = "pending" | "filled" | "cancelled" | "rejected";
export type BrokerMode = "paper" | "live";

export type SubmitOrderParams = {
  ticker: string;
  side: OrderSide;
  qty: number;
  note?: string;
};

export type BrokerOrder = {
  id: string;
  ticker: string;
  side: OrderSide;
  qty: number;
  status: OrderStatus;
  broker_mode: BrokerMode;
  submitted_at: string;
  filled_price: number | null;
  filled_qty: number | null;
  filled_at: string | null;
  note: string | null;
  created_at: string;
};

/**
 * Common interface every broker adapter must satisfy.
 * Paper adapter (M13) is the only implementation for now.
 * Questrade adapter lands in M17.
 */
export interface BrokerAdapter {
  readonly mode: BrokerMode;
  submitOrder(params: SubmitOrderParams): Promise<BrokerOrder>;
  listOrders(userId: string, limit?: number): Promise<BrokerOrder[]>;
  getOrder(orderId: string, userId: string): Promise<BrokerOrder | null>;
  cancelOrder(orderId: string, userId: string): Promise<boolean>;
}
