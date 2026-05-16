import "server-only";
import type { BrokerAdapter, BrokerOrder, SubmitOrderParams } from "./types";

/**
 * Questrade adapter stub — M17.
 * Satisfies the BrokerAdapter interface so live-mode wiring can be tested
 * before Questrade OAuth credentials are configured. Full OAuth integration
 * requires QUESTRADE_REFRESH_TOKEN + QUESTRADE_ACCOUNT_ID in environment.
 */
export class QuestradeAdapter implements BrokerAdapter {
  readonly mode = "live" as const;

  async submitOrder(params: SubmitOrderParams): Promise<BrokerOrder> {
    void params;
    throw new Error(
      "Questrade integration not yet configured. " +
        "Add QUESTRADE_REFRESH_TOKEN and QUESTRADE_ACCOUNT_ID to enable live trading.",
    );
  }

  async listOrders(userId: string, limit?: number): Promise<BrokerOrder[]> {
    void userId;
    void limit;
    return [];
  }

  async getOrder(orderId: string, userId: string): Promise<BrokerOrder | null> {
    void orderId;
    void userId;
    return null;
  }

  async cancelOrder(orderId: string, userId: string): Promise<boolean> {
    void orderId;
    void userId;
    return false;
  }
}
