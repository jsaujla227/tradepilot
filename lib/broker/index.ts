import "server-only";
import { PaperAdapter } from "./paper-adapter";
import type { BrokerAdapter } from "./types";

export type { BrokerAdapter, BrokerOrder, BrokerMode, SubmitOrderParams } from "./types";

/**
 * Returns the broker adapter for a given user.
 * In M13 this always returns the paper adapter.
 * In M17, reads profiles.broker_mode and returns the Questrade adapter when live.
 */
export async function getBrokerAdapter(userId: string): Promise<BrokerAdapter> {
  void userId; // M17: look up profiles.broker_mode; return Questrade adapter if "live"
  return new PaperAdapter();
}
