"use server";

import { revalidatePath } from "next/cache";
import { submitPaperOrder, submitParamsSchema } from "@/lib/broker/paper";

export type SubmitOrderState = {
  error?: string;
  orderId?: string;
};

export async function submitOrder(
  _prev: SubmitOrderState,
  formData: FormData,
): Promise<SubmitOrderState> {
  const parsed = submitParamsSchema.safeParse({
    ticker: formData.get("ticker"),
    side: formData.get("side"),
    qty: formData.get("qty"),
    note: formData.get("note") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    const order = await submitPaperOrder(parsed.data);
    revalidatePath("/orders");
    revalidatePath("/portfolio");
    return { orderId: order.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Order failed" };
  }
}
