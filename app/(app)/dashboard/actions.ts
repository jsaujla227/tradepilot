"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function dismissAlert(alertId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("position_alerts")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", alertId)
    .eq("user_id", user.id);

  revalidatePath("/dashboard");
}
