import { type PaperOrder } from "@/lib/broker/paper";
import { formatMoney } from "@/lib/format";

const STATUS_STYLES: Record<string, string> = {
  pending:   "bg-yellow-500/15 text-yellow-400",
  filled:    "bg-green-500/15 text-green-400",
  cancelled: "bg-zinc-500/15 text-zinc-400",
  rejected:  "bg-red-500/15 text-red-400",
};

export function OrdersTable({ orders }: { orders: PaperOrder[] }) {
  if (orders.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No orders yet. Use the form above to submit a paper order.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 pr-4">Ticker</th>
            <th className="pb-2 pr-4">Side</th>
            <th className="pb-2 pr-4 text-right">Qty</th>
            <th className="pb-2 pr-4 text-right">Fill price</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2">Filled at</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {orders.map((o) => (
            <tr key={o.id} className="transition hover:bg-foreground/5">
              <td className="py-2 pr-4 font-mono font-medium">{o.ticker}</td>
              <td className="py-2 pr-4 capitalize text-muted-foreground">{o.side}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{o.qty}</td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {o.filled_price != null ? formatMoney(o.filled_price) : "—"}
              </td>
              <td className="py-2 pr-4">
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    STATUS_STYLES[o.status] ?? ""
                  }`}
                >
                  {o.status}
                </span>
              </td>
              <td className="py-2 text-xs text-muted-foreground">
                {o.filled_at ? new Date(o.filled_at).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
