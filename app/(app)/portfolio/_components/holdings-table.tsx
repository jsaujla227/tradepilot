import Link from "next/link";
import { formatMoney, formatNumber, formatPct } from "@/lib/format";
import type { HoldingsView } from "@/lib/portfolio";

function PnlCell({
  pnl,
  pct,
}: {
  pnl: number | null;
  pct: number | null;
}) {
  if (pnl === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const sign = pnl > 0 ? "+" : pnl < 0 ? "-" : "";
  const color =
    pnl > 0
      ? "text-emerald-400"
      : pnl < 0
        ? "text-rose-400"
        : "text-foreground";
  return (
    <span className={color}>
      {sign}
      {formatMoney(Math.abs(pnl))}
      {pct !== null && (
        <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          {sign}
          {formatPct(Math.abs(pct), 2)}
        </span>
      )}
    </span>
  );
}

export function HoldingsTable({ view }: { view: HoldingsView }) {
  const { holdings, total_cost_basis, total_market_value, total_open_pnl } =
    view;

  if (holdings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No open positions yet. Add a transaction below to get started.
        </p>
      </div>
    );
  }

  // Allocation switches to market value once any row has a live price; falls
  // back to cost basis until then so the column always sums to ~100%.
  const allocationBasis =
    total_market_value !== null && total_market_value > 0
      ? "market"
      : "cost";
  const allocationDenominator =
    allocationBasis === "market"
      ? (total_market_value ?? 0)
      : total_cost_basis;

  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/20">
          <tr className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <th className="text-left font-medium px-4 py-2.5">Ticker</th>
            <th className="text-right font-medium px-4 py-2.5">Qty</th>
            <th className="text-right font-medium px-4 py-2.5">Avg cost</th>
            <th className="text-right font-medium px-4 py-2.5">Cost basis</th>
            <th className="text-right font-medium px-4 py-2.5">Price</th>
            <th className="text-right font-medium px-4 py-2.5">Market value</th>
            <th className="text-right font-medium px-4 py-2.5">Open P/L</th>
            <th
              className="text-right font-medium px-4 py-2.5"
              title={
                allocationBasis === "market"
                  ? "By live market value"
                  : "By cost basis (no live prices)"
              }
            >
              Allocation
            </th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {holdings.map((h) => {
            const allocationNumerator =
              allocationBasis === "market"
                ? (h.market_value ?? 0)
                : h.cost_basis;
            const allocation =
              allocationDenominator > 0
                ? (allocationNumerator / allocationDenominator) * 100
                : 0;
            return (
              <tr key={h.ticker} className="border-t border-border/60">
                <td className="px-4 py-2.5 font-sans font-medium text-foreground">
                  <Link
                    href={`/ticker/${h.ticker}`}
                    className="hover:text-foreground/70 transition underline-offset-4 hover:underline"
                  >
                    {h.ticker}
                  </Link>
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
                <td className="px-4 py-2.5 text-right">
                  {h.price === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    formatMoney(h.price)
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {h.market_value === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    formatMoney(h.market_value)
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <PnlCell pnl={h.open_pnl} pct={h.open_pnl_pct} />
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
              {formatMoney(total_cost_basis)}
            </td>
            <td className="px-4 py-2.5 text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Total
            </td>
            <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold">
              {total_market_value === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                formatMoney(total_market_value)
              )}
            </td>
            <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold">
              <PnlCell
                pnl={total_open_pnl}
                pct={
                  total_open_pnl !== null && total_cost_basis > 0
                    ? (total_open_pnl / total_cost_basis) * 100
                    : null
                }
              />
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
