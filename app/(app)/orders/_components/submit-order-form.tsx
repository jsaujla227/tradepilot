"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import { submitOrder, type SubmitOrderState } from "../actions";

const initial: SubmitOrderState = {};

export function SubmitOrderForm() {
  const [state, formAction, pending] = useActionState(submitOrder, initial);
  const sideRef = useRef<HTMLSelectElement>(null);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="order-ticker">
          Ticker
        </label>
        <input
          id="order-ticker"
          name="ticker"
          type="text"
          placeholder="AAPL"
          required
          maxLength={10}
          className="h-8 w-24 rounded-md border border-input bg-transparent px-2 font-mono text-sm uppercase focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="order-side">
          Side
        </label>
        <select
          id="order-side"
          name="side"
          ref={sideRef}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="order-qty">
          Qty
        </label>
        <input
          id="order-qty"
          name="qty"
          type="number"
          placeholder="10"
          min="0.00000001"
          step="any"
          required
          className="h-8 w-24 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="h-8 rounded-md bg-foreground px-3 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:opacity-50"
      >
        {pending ? "Submitting…" : "Submit paper order"}
      </button>

      {state.error && (
        <p className="w-full text-xs text-destructive">{state.error}</p>
      )}
      {state.orderId && !state.error && (
        <p className="w-full text-xs text-muted-foreground">
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
