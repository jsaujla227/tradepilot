import "server-only";
import { z } from "zod";
import type { BrokerOrder, OrderStatus } from "./types";

// Thin Questrade REST client. Every call targets the account-specific
// api_server returned by the OAuth token exchange and carries a Bearer token.
// Pure response → BrokerOrder mapping lives here too so it can be unit-tested.

export class QuestradeApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.name = "QuestradeApiError";
    this.code = code;
    this.status = status;
  }
}

function apiUrl(apiServer: string, path: string): string {
  const base = apiServer.endsWith("/") ? apiServer : `${apiServer}/`;
  return `${base}v1/${path}`;
}

async function questradeFetch(
  apiServer: string,
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(apiUrl(apiServer, path), {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new QuestradeApiError(
      "Could not reach the Questrade API",
      "network-error",
    );
  }
  if (!res.ok) {
    throw new QuestradeApiError(
      `Questrade API request failed (HTTP ${res.status})`,
      "request-failed",
      res.status,
    );
  }
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new QuestradeApiError(
      "Questrade API returned a non-JSON response",
      "bad-response",
    );
  }
}

// --- symbols ---------------------------------------------------------------

const symbolSearchSchema = z.object({
  symbols: z.array(z.object({ symbolId: z.number(), symbol: z.string() })),
});

/** Resolves a ticker to Questrade's internal numeric symbolId. */
export async function searchSymbolId(
  apiServer: string,
  accessToken: string,
  ticker: string,
): Promise<number> {
  const raw = await questradeFetch(
    apiServer,
    accessToken,
    `symbols/search?prefix=${encodeURIComponent(ticker)}`,
  );
  const parsed = symbolSearchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new QuestradeApiError(
      "Unexpected Questrade symbol-search response",
      "bad-response",
    );
  }
  const upper = ticker.toUpperCase();
  const match =
    parsed.data.symbols.find((s) => s.symbol.toUpperCase() === upper) ??
    parsed.data.symbols[0];
  if (!match) {
    throw new QuestradeApiError(
      `No Questrade symbol found for ${ticker}`,
      "symbol-not-found",
    );
  }
  return match.symbolId;
}

// --- accounts --------------------------------------------------------------

const accountsSchema = z.object({
  accounts: z.array(
    z.object({
      type: z.string(),
      number: z.string(),
      status: z.string(),
      isPrimary: z.boolean(),
    }),
  ),
});

export type QuestradeAccount = {
  number: string;
  type: string;
  isPrimary: boolean;
};

export async function listAccounts(
  apiServer: string,
  accessToken: string,
): Promise<QuestradeAccount[]> {
  const raw = await questradeFetch(apiServer, accessToken, "accounts");
  const parsed = accountsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new QuestradeApiError(
      "Unexpected Questrade accounts response",
      "bad-response",
    );
  }
  return parsed.data.accounts.map((a) => ({
    number: a.number,
    type: a.type,
    isPrimary: a.isPrimary,
  }));
}

// --- orders ----------------------------------------------------------------

const questradeOrderSchema = z.object({
  id: z.number(),
  symbol: z.string(),
  totalQuantity: z.number(),
  filledQuantity: z.number().nullable().optional(),
  side: z.string(),
  state: z.string(),
  avgExecPrice: z.number().nullable().optional(),
  creationTime: z.string(),
  updateTime: z.string().nullable().optional(),
});

export type QuestradeOrder = z.infer<typeof questradeOrderSchema>;

const ordersResponseSchema = z.object({
  orders: z.array(questradeOrderSchema),
});

/** Maps a Questrade order state to a BrokerOrder status. Pure. */
export function mapOrderState(state: string): OrderStatus {
  switch (state) {
    case "Executed":
      return "filled";
    case "Canceled":
    case "Expired":
      return "cancelled";
    case "Rejected":
    case "Failed":
      return "rejected";
    default:
      return "pending";
  }
}

/** Maps a Questrade order to a BrokerOrder. Pure. */
export function questradeOrderToBrokerOrder(q: QuestradeOrder): BrokerOrder {
  const status = mapOrderState(q.state);
  return {
    id: String(q.id),
    ticker: q.symbol,
    side: q.side.toLowerCase() === "sell" ? "sell" : "buy",
    qty: q.totalQuantity,
    status,
    broker_mode: "live",
    submitted_at: q.creationTime,
    filled_price: q.avgExecPrice ?? null,
    filled_qty: q.filledQuantity ?? null,
    filled_at: status === "filled" ? (q.updateTime ?? null) : null,
    note: null,
    created_at: q.creationTime,
  };
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function getAccountOrders(
  apiServer: string,
  accessToken: string,
  accountId: string,
  lookbackDays = 30,
): Promise<QuestradeOrder[]> {
  const qs =
    `startTime=${encodeURIComponent(isoDaysAgo(lookbackDays))}` +
    `&endTime=${encodeURIComponent(new Date().toISOString())}`;
  const raw = await questradeFetch(
    apiServer,
    accessToken,
    `accounts/${encodeURIComponent(accountId)}/orders?${qs}`,
  );
  const parsed = ordersResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new QuestradeApiError(
      "Unexpected Questrade orders response",
      "bad-response",
    );
  }
  return parsed.data.orders;
}

export async function getAccountOrder(
  apiServer: string,
  accessToken: string,
  accountId: string,
  orderId: string,
): Promise<QuestradeOrder | null> {
  const raw = await questradeFetch(
    apiServer,
    accessToken,
    `accounts/${encodeURIComponent(accountId)}/orders/${encodeURIComponent(orderId)}`,
  );
  const parsed = ordersResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new QuestradeApiError(
      "Unexpected Questrade order response",
      "bad-response",
    );
  }
  return parsed.data.orders[0] ?? null;
}

export type QuestradeOrderRequest = {
  symbolId: number;
  quantity: number;
  action: "Buy" | "Sell";
  orderType: "Market";
  timeInForce: "Day";
  primaryRoute: "AUTO";
  secondaryRoute: "AUTO";
};

export async function placeOrder(
  apiServer: string,
  accessToken: string,
  accountId: string,
  order: QuestradeOrderRequest,
): Promise<QuestradeOrder> {
  const raw = await questradeFetch(
    apiServer,
    accessToken,
    `accounts/${encodeURIComponent(accountId)}/orders`,
    { method: "POST", body: JSON.stringify(order) },
  );
  const parsed = ordersResponseSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.orders[0]) {
    throw new QuestradeApiError(
      "Questrade did not return the placed order",
      "bad-response",
    );
  }
  return parsed.data.orders[0];
}

/** Cancels an order. Returns false when Questrade rejects the cancel (e.g.
 *  the order already filled), rather than throwing. */
export async function cancelAccountOrder(
  apiServer: string,
  accessToken: string,
  accountId: string,
  orderId: string,
): Promise<boolean> {
  try {
    await questradeFetch(
      apiServer,
      accessToken,
      `accounts/${encodeURIComponent(accountId)}/orders/${encodeURIComponent(orderId)}`,
      { method: "DELETE" },
    );
    return true;
  } catch {
    return false;
  }
}
