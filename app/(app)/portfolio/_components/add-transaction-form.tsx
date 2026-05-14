"use client";

import { useActionState, useState } from "react";
import {
  addTransaction,
  type AddTransactionState,
} from "../actions";

const initialState: AddTransactionState = {};

export function AddTransactionForm() {
  const [state, formAction, pending] = useActionState<
    AddTransactionState,
    FormData
  >(addTransaction, initialState);
  const [side, setSide] = useState<"buy" | "sell">("buy");

  return (
    <form
      action={(fd) => {
        // Re-set side from local state because radios use their own name binding.
        fd.set("side", side);
        formAction(fd);
      }}
      className="rounded-xl border border-border bg-card text-card-foreground p-6 space-y-4"
    >
      <header>
        <h2 className="text-base font-semibold tracking-tight">
          Add transaction
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Manual buy or sell. Updates holdings on save.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1.5 text-xs col-span-2 md:col-span-1">
          <span className="font-medium text-foreground/90">Ticker</span>
          <input
            type="text"
            name="ticker"
            required
            autoCapitalize="characters"
            placeholder="AAPL"
            maxLength={12}
            className="rounded-md border border-input bg-background/40 px-3 py-2 text-sm font-mono text-foreground uppercase outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
          />
        </label>

        <fieldset className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-foreground/90">Side</span>
          <div className="flex rounded-md border border-input bg-background/40 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setSide("buy")}
              className={`flex-1 px-3 py-2 transition ${
                side === "buy"
                  ? "bg-emerald-500/15 text-emerald-300 font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => setSide("sell")}
              className={`flex-1 px-3 py-2 transition ${
                side === "sell"
                  ? "bg-amber-500/15 text-amber-300 font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sell
            </button>
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-foreground/90">Qty</span>
          <input
            type="number"
            name="qty"
            required
            step="any"
            min={0}
            inputMode="decimal"
            placeholder="100"
            className="rounded-md border border-input bg-background/40 px-3 py-2 text-sm font-mono tabular-nums outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-foreground/90">Price ($)</span>
          <input
            type="number"
            name="price"
            required
            step="any"
            min={0}
            inputMode="decimal"
            placeholder="10.00"
            className="rounded-md border border-input bg-background/40 px-3 py-2 text-sm font-mono tabular-nums outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
          />
        </label>
      </div>

      <details className="rounded-md border border-border/60 bg-background/30">
        <summary className="cursor-pointer select-none list-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition">
          Optional fields (fees, executed_at, note)
        </summary>
        <div className="px-3 pb-3 pt-1 grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground/90">Fees ($)</span>
            <input
              type="number"
              name="fees"
              step="any"
              min={0}
              defaultValue={0}
              className="rounded-md border border-input bg-background/40 px-3 py-2 text-sm font-mono tabular-nums outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground/90">
              Executed at (defaults to now)
            </span>
            <input
              type="datetime-local"
              name="executed_at"
              className="rounded-md border border-input bg-background/40 px-3 py-2 text-sm font-mono outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs md:col-span-2">
            <span className="font-medium text-foreground/90">Note</span>
            <textarea
              name="note"
              rows={2}
              maxLength={500}
              placeholder="Optional context"
              className="rounded-md border border-input bg-background/40 px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
            />
          </label>
        </div>
      </details>

      {state.error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
        >
          {state.error}
        </div>
      ) : null}
      {state.saved ? (
        <div
          role="status"
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
        >
          Saved. Holdings updated.
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 disabled:opacity-60 disabled:cursor-not-allowed transition"
      >
        {pending ? "Saving…" : `Record ${side}`}
      </button>
    </form>
  );
}
