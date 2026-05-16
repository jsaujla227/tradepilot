"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { submitOrder, type SubmitOrderState } from "../actions";
import { TickerPicker, type PickedQuote } from "@/components/ticker-picker";
import type { UserTicker } from "@/lib/user-tickers";
import { formatMoney } from "@/lib/format";

const initial: SubmitOrderState = {};

export function SubmitOrderForm({
  tickers = [],
}: {
  tickers?: UserTicker[];
}) {
  const [state, formAction, pending] = useActionState(submitOrder, initial);
  const sideRef = useRef<HTMLSelectElement>(null);
  const [ticker, setTicker] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState<string>("");
  const [livePrice, setLivePrice] = useState<number | null>(null);

  const handlePick = (nextTicker: string, quote: PickedQuote | null) => {
    setTicker(nextTicker);
    setLivePrice(quote?.price ?? null);
  };

  const qtyNum = Number(qty);
  const estimatedCost =
    livePrice != null && Number.isFinite(qtyNum) && qtyNum > 0
      ? livePrice * qtyNum
      : null;

  const canSubmit = useMemo(
    () => ticker.length > 0 && Number.isFinite(qtyNum) && qtyNum > 0,
    [ticker, qtyNum],
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <TickerPicker
          tickers={tickers}
          value={ticker}
          onPick={handlePick}
          label="Ticker"
        />

        <div className="flex flex-col gap-1.5 text-xs">
          <label htmlFor="order-side" className="font-medium text-foreground/90">
            Side
          </label>
          <select
            id="order-side"
            name="side"
            ref={sideRef}
            value={side}
            onChange={(e) => setSide(e.target.value as "buy" | "sell")}
            className="h-9 rounded-md border border-input bg-background/40 px-2 text-sm outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5 text-xs">
          <label htmlFor="order-qty" className="font-medium text-foreground/90">
            Shares
          </label>
          <input
            id="order-qty"
            name="qty"
            type="number"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="10"
            min="0.00000001"
            step="any"
            required
            className="h-9 w-28 rounded-md border border-input bg-background/40 px-3 text-sm tabular-nums outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
          />
        </div>

        <div className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-foreground/90">&nbsp;</span>
          <button
            type="submit"
            disabled={pending || !canSubmit}
            className="h-9 rounded-md bg-foreground px-4 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:opacity-50"
          >
            {pending ? "Submitting…" : "Submit paper order"}
          </button>
        </div>
      </div>

      {/* Hidden field carries the picker's ticker into the form action */}
      <input type="hidden" name="ticker" value={ticker} />

      {ticker && livePrice != null && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-border/60 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Last <span className="font-mono text-foreground">{ticker}</span>:{" "}
            <span className="font-mono tabular-nums text-foreground">
              {formatMoney(livePrice)}
            </span>
          </span>
          {estimatedCost != null && (
            <span>
              Estimated {side === "buy" ? "cost" : "proceeds"}:{" "}
              <span className="font-mono tabular-nums text-foreground">
                {formatMoney(estimatedCost)}
              </span>
            </span>
          )}
          <span className="text-[10px]">
            Paper orders fill immediately at the cached quote.
          </span>
        </div>
      )}

      {state.error && (
        <p className="text-xs text-destructive">{state.error}</p>
      )}
      {state.orderId && !state.error && (
        <p className="text-xs text-muted-foreground">
          Filled — order{" "}
          <span className="font-mono">{state.orderId.slice(0, 8)}…</span>
          {sideRef.current?.value === "sell" && (
            <>
              {" · "}
              <Link href="/journal" className="underline hover:text-foreground transition">
                Check Journal for position reviews
              </Link>
            </>
          )}
        </p>
      )}
    </form>
  );
}
