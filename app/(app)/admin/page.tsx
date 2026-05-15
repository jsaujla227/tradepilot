import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminJobs } from "./_components/jobs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · TradePilot" };

type AgentLogRow = {
  id: string;
  event_type: string;
  ticker: string | null;
  qty: number | null;
  order_id: string | null;
  reason: string;
  created_at: string;
};

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: logRows } = await supabase
    .from("agent_log")
    .select("id, event_type, ticker, qty, order_id, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  const log: AgentLogRow[] = (logRows ?? []).map((r) => ({
    id: String(r.id),
    event_type: String(r.event_type),
    ticker: r.ticker as string | null,
    qty: r.qty != null ? Number(r.qty) : null,
    order_id: r.order_id as string | null,
    reason: String(r.reason),
    created_at: String(r.created_at),
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Admin tools</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manually trigger background jobs. Run context refresh first, then scanner, then agent trade.
        </p>
      </div>

      <AdminJobs />

      <p className="text-xs text-muted-foreground">
        Automatic schedule (weekdays): context refresh 09:00 UTC · scanner 13:35 UTC · agent trade 14:05 UTC · position monitor 19:30 UTC · snapshot 23:00 UTC · journal review 1st of month 23:00 UTC.
      </p>

      {/* Agent activity log */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Agent activity log (last 30)
        </h2>

        {log.length === 0 ? (
          <div className="rounded-lg border border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
            No agent activity yet. Enable the agent in Settings and run the agent trade job.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2 max-w-xs">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {log.map((entry) => (
                  <tr key={entry.id} className="hover:bg-foreground/5 transition">
                    <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`font-mono ${
                          entry.event_type === "buy_submitted"
                            ? "text-green-400"
                            : entry.event_type === "sell_submitted"
                              ? "text-blue-400"
                              : entry.event_type === "error"
                                ? "text-red-400"
                                : "text-muted-foreground"
                        }`}
                      >
                        {entry.event_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono font-medium">
                      {entry.ticker ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">
                      {entry.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
