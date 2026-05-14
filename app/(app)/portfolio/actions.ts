"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const addTransactionSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "Ticker required")
    .max(12, "Ticker too long")
    .regex(/^[A-Za-z0-9.\-]+$/, "Invalid ticker characters")
    .transform((s) => s.toUpperCase()),
  side: z.enum(["buy", "sell"]),
  qty: z.coerce.number().positive("Qty must be positive").max(1e10),
  price: z.coerce.number().positive("Price must be positive").max(1e10),
  fees: z.coerce.number().min(0, "Fees can't be negative").max(1e8).default(0),
  executed_at: z
    .string()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined)),
  note: z
    .string()
    .max(500, "Note too long")
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined)),
});

export type AddTransactionState = {
  error?: string;
  saved?: boolean;
};

export async function addTransaction(
  _prev: AddTransactionState,
  formData: FormData,
): Promise<AddTransactionState> {
  const parsed = addTransactionSchema.safeParse({
    ticker: formData.get("ticker"),
    side: formData.get("side"),
    qty: formData.get("qty"),
    price: formData.get("price"),
    fees: formData.get("fees") ?? 0,
    executed_at: formData.get("executed_at"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase is not configured." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const insertRow: Record<string, unknown> = {
    user_id: user.id,
    ticker: parsed.data.ticker,
    side: parsed.data.side,
    qty: parsed.data.qty,
    price: parsed.data.price,
    fees: parsed.data.fees,
    source: "manual",
  };
  if (parsed.data.executed_at) insertRow.executed_at = parsed.data.executed_at;
  if (parsed.data.note) insertRow.note = parsed.data.note;

  const { error } = await supabase.from("transactions").insert(insertRow);
  if (error) return { error: error.message };

  revalidatePath("/portfolio");
  return { saved: true };
}

export async function deleteTransaction(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/portfolio");
}
