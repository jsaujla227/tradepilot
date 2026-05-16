import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrokerAdapter, BrokerOrder, SubmitOrderParams } from "./types";
import { getValidAccessToken } from "./questrade-auth";
import { setBrokerAccountId } from "./credentials";
import {
  searchSymbolId,
  listAccounts,
  getAccountOrders,
  getAccountOrder,
  placeOrder,
  cancelAccountOrder,
  questradeOrderToBrokerOrder,
} from "./questrade-api";

/**
 * Live broker adapter backed by the Questrade REST API. Reachable only when
 * the user has broker_mode = "live" and real_money_unlocked = true (enforced
 * by getBrokerAdapter). Every method resolves a valid access token first,
 * refreshing and rotating credentials as needed.
 */
export class QuestradeAdapter implements BrokerAdapter {
  readonly mode = "live" as const;

  constructor(
    private readonly userId: string,
    private readonly supabase: SupabaseClient,
  ) {}

  /** Resolves a valid access token and the account orders route to. The
   *  account is discovered once (the primary account) and persisted. */
  private async resolveAuth(): Promise<{
    accessToken: string;
    apiServer: string;
    accountId: string;
  }> {
    const token = await getValidAccessToken(this.supabase, this.userId);
    if (token.accountId) {
      return {
        accessToken: token.accessToken,
        apiServer: token.apiServer,
        accountId: token.accountId,
      };
    }
    const accounts = await listAccounts(token.apiServer, token.accessToken);
    const chosen = accounts.find((a) => a.isPrimary) ?? accounts[0];
    if (!chosen) {
      throw new Error("No Questrade account is available for this connection.");
    }
    await setBrokerAccountId(this.supabase, this.userId, chosen.number);
    return {
      accessToken: token.accessToken,
      apiServer: token.apiServer,
      accountId: chosen.number,
    };
  }

  async submitOrder(params: SubmitOrderParams): Promise<BrokerOrder> {
    const { accessToken, apiServer, accountId } = await this.resolveAuth();
    const symbolId = await searchSymbolId(apiServer, accessToken, params.ticker);
    const order = await placeOrder(apiServer, accessToken, accountId, {
      symbolId,
      quantity: params.qty,
      action: params.side === "buy" ? "Buy" : "Sell",
      orderType: "Market",
      timeInForce: "Day",
      primaryRoute: "AUTO",
      secondaryRoute: "AUTO",
    });
    return questradeOrderToBrokerOrder(order);
  }

  async listOrders(userId: string, limit = 50): Promise<BrokerOrder[]> {
    void userId; // adapter is already scoped to its user via the constructor
    const { accessToken, apiServer, accountId } = await this.resolveAuth();
    const orders = await getAccountOrders(apiServer, accessToken, accountId);
    return orders
      .map(questradeOrderToBrokerOrder)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, limit);
  }

  async getOrder(orderId: string, userId: string): Promise<BrokerOrder | null> {
    void userId;
    const { accessToken, apiServer, accountId } = await this.resolveAuth();
    const order = await getAccountOrder(
      apiServer,
      accessToken,
      accountId,
      orderId,
    );
    return order ? questradeOrderToBrokerOrder(order) : null;
  }

  async cancelOrder(orderId: string, userId: string): Promise<boolean> {
    void userId;
    const { accessToken, apiServer, accountId } = await this.resolveAuth();
    return cancelAccountOrder(apiServer, accessToken, accountId, orderId);
  }
}
