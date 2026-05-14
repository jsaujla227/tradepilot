import { formatMoney, formatNumber, formatPct } from "@/lib/format";
import type { Holding } from "@/lib/portfolio";

export function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  if (holdings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No open positions yet. Add a transaction below to get started.
        </p>
      </div>
    );
  }

  const totalCostBasis = holdings.reduce((sum, h) => sum + h.cost_basis, 0);

  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/20">
          <tr className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <th className="text-left font-medium px-4 py-2.5">Ticker</th>
            <th className="text-right font-medium px-4 py-2.5">Qty</th>
            <th className="text-right font-medium px-4 py-2.5">Avg cost</th>
            <th className="text-right font-medium px-4 py-2.5">Cost basis</th>
            <th
              className="text-right font-medium px-4 py-2.5"
              title="Live prices ship in M5"
            >
              Price
            </th>
            <th
              className="text-right font-medium px-4 py-2.5"
              title="Live prices ship in M5"
            >
              Market value
            </th>
            <th
              className="text-right font-medium px-4 py-2.5"
              title="By cost basis until M5 unlocks live market value"
            >
              Allocation
            </th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {holdings.map((h) => {
            const allocation =
              totalCostBasis > 0 ? (h.cost_basis / totalCostBasis) * 100 : 0;
            return (
              <tr key={h.ticker} className="border-t border-border/60">
                <td className="px-4 py-2.5 font-sans font-medium text-foreground">
                  {h.ticker}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {formatNumber(h.qty, 4).replace(/\.?0+$/, "")}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {formatMoney(h.avg_cost)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {formatMoney(h.cost_basis)}
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">
                  —
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">
                  —
                </td>
                <td className="px-4 py-2.5 text-right">
                  {formatPct(allocation, 1)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-muted/20">
          <tr className="border-t border-border">
            <td
              className="px-4 py-2.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground"
              colSpan={3}
            >
              Total cost basis
            </td>
            <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold">
              {formatMoney(totalCostBasis)}
            </td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
