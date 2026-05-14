"use client";

import { useActionState, useState } from "react";
import { addWatchlistItem, type AddWatchlistState } from "../actions";

const initial: AddWatchlistState = {};

const INPUT =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

export function AddWatchlistForm() {
  const [state, formAction, pending] = useActionState(addWatchlistItem, initial);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Add to my watchlist
        </h2>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground transition"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      <form action={formAction} className="space-y-3">
        {/* Row 1: ticker + sector (always visible) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Ticker *</label>
            <input
              name="ticker"
              type="text"
              placeholder="AAPL"
              required
              maxLength={10}
              className={`${INPUT} font-mono uppercase`}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Sector</label>
            <input
              name="sector"
              type="text"
              placeholder="Technology"
              maxLength={80}
              className={INPUT}
            />
          </div>
        </div>

        {/* Optional fields */}
        {expanded && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {[
                { name: "target_entry", label: "Target entry $" },
                { name: "target_stop", label: "Target stop $" },
                { name: "target_price", label: "Target price $" },
              ].map(({ name, label }) => (
                <div key={name} className="space-y-1">
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <input
                    name={name}
                    type="number"
                    min="0.01"
                    step="any"
                    className={INPUT}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Reason / thesis</label>
              <textarea
                name="reason"
                rows={2}
                maxLength={500}
                placeholder="Why is this worth monitoring?"
                className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Notes</label>
              <textarea
                name="notes"
                rows={2}
                maxLength={500}
                className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
          </>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="h-8 rounded-md bg-foreground px-3 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:opacity-50"
          >
            {pending ? "Adding…" : "Add ticker"}
          </button>
          {state.error && (
            <p className="text-xs text-destructive">{state.error}</p>
          )}
          {state.saved && (
            <p className="text-xs text-muted-foreground">Added.</p>
          )}
        </div>
      </form>
    </section>
  );
}
