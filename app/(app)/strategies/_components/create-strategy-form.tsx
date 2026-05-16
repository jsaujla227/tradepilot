"use client";

import { useActionState } from "react";
import { createStrategy, type CreateStrategyState } from "../actions";

const INPUT =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/40";

export function CreateStrategyForm() {
  const [state, formAction, pending] = useActionState<
    CreateStrategyState,
    FormData
  >(createStrategy, {});

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-border bg-card/50 p-4"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Name</span>
          <input name="name" required maxLength={80} className={INPUT} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Ticker</span>
          <input
            name="ticker"
            required
            className={`${INPUT} font-mono uppercase`}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Fast SMA</span>
          <input
            name="fast"
            type="number"
            defaultValue={50}
            min={2}
            max={200}
            required
            className={INPUT}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Slow SMA</span>
          <input
            name="slow"
            type="number"
            defaultValue={200}
            min={3}
            max={400}
            required
            className={INPUT}
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create draft strategy"}
      </button>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      {state.saved && (
        <p className="text-xs text-green-400">Draft strategy created.</p>
      )}
    </form>
  );
}
