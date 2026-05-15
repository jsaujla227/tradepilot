"use client";

import { useActionState, useId, useState, useEffect } from "react";
import { submitReview, type ReviewState } from "../actions";
import { formatMoney } from "@/lib/format";

export type PendingPosition = {
  position_id: string;
  ticker: string;
  realized_pnl: number;
  opened_at: string;
  closed_at: string;
};

const initial: ReviewState = {};

const TEXTAREA =
  "w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none";
const INPUT =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

function ReviewForm({
  position,
  onDone,
}: {
  position: PendingPosition;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(submitReview, initial);
  const idPrefix = useId();

  useEffect(() => {
    if (state.saved) onDone();
  }, [state.saved, onDone]);

  return (
    <form action={formAction} className="mt-3 space-y-3 border-t border-border/50 pt-3">
      <input type="hidden" name="position_id" value={position.position_id} />
      <input type="hidden" name="ticker" value={position.ticker} />
      <input type="hidden" name="realized_pnl" value={position.realized_pnl} />

      {(
        [
          { name: "what_worked", label: "What worked?" },
          { name: "what_didnt", label: "What didn't work?" },
          { name: "lessons", label: "Lessons" },
        ] as const
      ).map(({ name, label }) => {
        const fieldId = `${idPrefix}-${name}`;
        return (
          <div key={name} className="space-y-1">
            <label htmlFor={fieldId} className="text-xs text-muted-foreground">
              {label}
            </label>
            <textarea
              id={fieldId}
              name={name}
              required
              rows={2}
              maxLength={1000}
              className={TEXTAREA}
            />
          </div>
        );
      })}

      <div className="space-y-1">
        <label
          htmlFor={`${idPrefix}-r_realized`}
          className="text-xs text-muted-foreground"
        >
          R realized{" "}
          <span className="text-muted-foreground/50">(optional)</span>
        </label>
        <input
          id={`${idPrefix}-r_realized`}
          name="r_realized"
          type="number"
          step="any"
          className={`${INPUT} w-28`}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-8 rounded-md bg-foreground px-3 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save review"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-xs text-muted-foreground hover:text-foreground transition"
        >
          Skip for now
        </button>
        {state.error && (
          <p className="text-xs text-destructive">{state.error}</p>
        )}
      </div>
    </form>
  );
}

export function PendingReviews({ positions }: { positions: PendingPosition[] }) {
  const [openId, setOpenId] = useState<string | null>(
    positions[0]?.position_id ?? null,
  );
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = positions.filter((p) => !dismissed.has(p.position_id));
  if (visible.length === 0) return null;

  function dismiss(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
    if (openId === id) setOpenId(null);
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Needs review ({visible.length})
      </h2>
      {visible.map((pos) => (
        <div
          key={pos.position_id}
          className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="font-mono font-semibold">{pos.ticker}</span>
              <span
                className={`text-sm tabular-nums ${
                  pos.realized_pnl >= 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                {pos.realized_pnl >= 0 ? "+" : ""}
                {formatMoney(pos.realized_pnl)} realized
              </span>
              <span className="text-xs text-muted-foreground">
                closed {new Date(pos.closed_at).toLocaleDateString()}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setOpenId((prev) =>
                    prev === pos.position_id ? null : pos.position_id,
                  )
                }
                className="text-xs font-medium text-foreground hover:underline transition"
              >
                {openId === pos.position_id ? "Collapse" : "Write review"}
              </button>
              <button
                type="button"
                onClick={() => dismiss(pos.position_id)}
                className="text-xs text-muted-foreground hover:text-foreground transition"
              >
                Skip
              </button>
            </div>
          </div>

          {openId === pos.position_id && (
            <ReviewForm position={pos} onDone={() => dismiss(pos.position_id)} />
          )}
        </div>
      ))}
    </section>
  );
}
