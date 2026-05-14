"use server";

import { getTickerInsight, type TickerInsight } from "@/lib/ticker-insight";

export async function fetchTickerInsight(
  ticker: string,
  proposedNotional: number | null,
): Promise<TickerInsight | null> {
  return getTickerInsight(ticker, proposedNotional);
}
