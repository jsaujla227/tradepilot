import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PaperAdapter } from "./paper-adapter";
import { QuestradeAdapter } from "./questrade-adapter";
import type { BrokerAdapter } from "./types";

export type { BrokerAdapter, BrokerOrder, BrokerMode, SubmitOrderParams } from "./types";

/**
 * Returns the broker adapter for a given user.
 * Reads profiles.broker_mode: returns QuestradeAdapter when "live",
 * PaperAdapter otherwise.
 */
export async function getBrokerAdapter(userId: string): Promise<BrokerAdapter> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return new PaperAdapter();

  const { data } = await supabase
    .from("profiles")
    .select("broker_mode, real_money_unlocked")
    .eq("user_id", userId)
    .maybeSingle();

  if (data?.broker_mode === "live" && data?.real_money_unlocked === true) {
    return new QuestradeAdapter(userId, supabase);
  }
  return new PaperAdapter();
}
