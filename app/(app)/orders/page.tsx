import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrders } from "@/lib/broker/paper";
import { getUserTickers } from "@/lib/user-tickers";
import { OrdersTable } from "./_components/orders-table";
import { SubmitOrderForm } from "./_components/submit-order-form";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [orders, tickers] = await Promise.all([
    getOrders(50),
    getUserTickers(),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paper orders fill immediately at the last cached quote. No real money,
          no external broker.
        </p>
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-card/50 p-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Submit paper order
        </h2>
        <SubmitOrderForm tickers={tickers} />
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card/50 p-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent orders
        </h2>
        <OrdersTable orders={orders} />
      </section>
    </div>
  );
}
