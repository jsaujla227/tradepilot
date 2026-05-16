import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BacktestRunner } from "./_components/backtest-runner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backtest · TradePilot" };

type RecentRun = {
  id: string;
  ticker: string;
  strategy: string;
  from_date: string;
  to_date: string;
  metrics: { totalReturnPct?: number; sharpe?: number } | null;
  created_at: string;
};

export default async function BacktestPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("backtest_runs")
    .select("id, ticker, strategy, from_date, to_date, metrics, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  const recent = (data ?? []) as RecentRun[];

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Backtest</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Replay an SMA-crossover strategy over historical daily bars. Fills are
          modelled at the next open with slippage and commission; a decision
          made on one day&apos;s close executes the next day, so there is no
          lookahead. Every metric expands to show its math.
        </p>
      </div>

      <BacktestRunner />

      {recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent runs
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card/30 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Ticker</th>
                  <th className="px-3 py-2 font-medium">Strategy</th>
                  <th className="px-3 py-2 font-medium">Range</th>
                  <th className="px-3 py-2 text-right font-medium">Return</th>
                  <th className="px-3 py-2 text-right font-medium">Sharpe</th>
                  <th className="px-3 py-2 text-right font-medium">Run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {recent.map((r) => {
                  const ret = r.metrics?.totalReturnPct ?? 0;
                  const sharpe = r.metrics?.sharpe ?? 0;
                  return (
                    <tr key={r.id} className="hover:bg-foreground/5 transition">
                      <td className="px-3 py-1.5 font-mono font-medium">
                        {r.ticker}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {r.strategy}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
                        {r.from_date} → {r.to_date}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right tabular-nums ${
                          ret >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {ret >= 0 ? "+" : ""}
                        {ret.toFixed(2)}%
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {sharpe.toFixed(2)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs text-muted-foreground tabular-nums">
                        {r.created_at.slice(0, 10)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
