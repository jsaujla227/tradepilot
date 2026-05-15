"use client";

import { useActionState } from "react";
import { unlockLiveTrading } from "@/app/(app)/settings/actions";

type State = { error?: string; unlocked?: boolean };

export function UnlockLiveButton() {
  const [state, action, pending] = useActionState<State, FormData>(
    unlockLiveTrading,
    {},
  );

  if (state.unlocked) {
    return (
      <p className="text-xs font-medium text-emerald-400">
        Unlocked. Reload the page to switch to live mode.
      </p>
    );
  }

  return (
    <form action={action}>
      {state.error && (
        <p className="mb-2 text-xs text-destructive-foreground">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending ? "Unlocking…" : "Unlock live trading"}
      </button>
    </form>
  );
}
