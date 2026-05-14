"use client";

import { useActionState } from "react";
import { addSuggestionToWatchlist } from "../actions";

export function AddToWatchlistButton({ ticker }: { ticker: string }) {
  const [state, dispatch, pending] = useActionState(addSuggestionToWatchlist, {});

  if (state.saved) {
    return <span className="text-[11px] text-green-400">Added</span>;
  }

  return (
    <form action={dispatch}>
      <input type="hidden" name="ticker" value={ticker} />
      <button
        type="submit"
        disabled={pending}
        className="text-[11px] text-muted-foreground hover:text-foreground transition disabled:opacity-50"
      >
        {pending ? "Adding…" : "+ Watchlist"}
      </button>
      {state.error && (
        <p className="text-[10px] text-destructive mt-0.5">{state.error}</p>
      )}
    </form>
  );
}
