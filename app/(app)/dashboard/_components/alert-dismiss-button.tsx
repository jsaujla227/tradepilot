"use client";

import { useTransition } from "react";
import { dismissAlert } from "../actions";

export function AlertDismissButton({ alertId }: { alertId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault(); // don't toggle the <details>
        startTransition(() => dismissAlert(alertId));
      }}
      className="text-[10px] font-mono uppercase tracking-wider opacity-60 hover:opacity-100 transition disabled:opacity-30"
      aria-label="Dismiss alert"
    >
      {pending ? "…" : "Dismiss"}
    </button>
  );
}
