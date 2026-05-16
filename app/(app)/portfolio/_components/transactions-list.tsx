"use client";

import { useTransition } from "react";
import { deleteTransaction } from "../actions";
import { formatMoney, formatNumber } from "@/lib/format";
import type { Transaction } from "@/lib/portfolio";

function formatExecutedAt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DeleteButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Delete this transaction? Holdings recompute.")) return;
        startTransition(async () => {
          try {
            await deleteTransaction(id);
          } catch (err) {
            window.alert(
              err instanceof Error ? err.message : "Failed to delete",
            );
          }
        });
      }}
      className="text-[11px] text-muted-foreground hover:text-destructive-foreground transition disabled:opacity-50"
    >
      {pending ? "…" : "delete"}
    </button>
  );
}

export function TransactionsList({
  transactions,
}: {
  transactions: Transaction[];
}) {
  if (transactions.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
      <header className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">
          Recent transactions
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {transactions.length} most recent
        </span>
      </header>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/10">
          <tr className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <th className="text-left font-medium px-4 py-2">When</th>
            <th className="text-left font-medium px-4 py-2">Ticker</th>
            <th className="text-left font-medium px-4 py-2">Side</th>
            <th className="text-right font-medium px-4 py-2">Qty</th>
            <th className="text-right font-medium px-4 py-2">Price</th>
            <th className="text-right font-medium px-4 py-2">Fees</th>
            <th className="text-left font-medium px-4 py-2">Source</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {transactions.map((t) => (
            <tr key={t.id} className="border-t border-border/60">
              <td className="px-4 py-2 text-xs text-muted-foreground">
                {formatExecutedAt(t.executed_at)}
              </td>
              <td className="px-4 py-2 font-sans font-medium text-foreground">
                {t.ticker}
              </td>
              <td className="px-4 py-2 font-sans">
                <span
                  className={
                    t.side === "buy"
                      ? "text-emerald-300"
                      : "text-amber-300"
                  }
                >
                  {t.side}
                </span>
              </td>
              <td className="px-4 py-2 text-right">
                {formatNumber(t.qty, 4).replace(/\.?0+$/, "")}
              </td>
              <td className="px-4 py-2 text-right">{formatMoney(t.price)}</td>
              <td className="px-4 py-2 text-right text-muted-foreground">
                {t.fees > 0 ? formatMoney(t.fees) : "—"}
              </td>
              <td className="px-4 py-2 font-sans text-xs text-muted-foreground">
                {t.source}
              </td>
              <td className="px-4 py-2 text-right">
                <DeleteButton id={t.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}
