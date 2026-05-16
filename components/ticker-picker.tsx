"use client";

import { useId, useState, useTransition } from "react";
import type { UserTicker } from "@/lib/user-tickers";

export type PickedQuote = {
  ticker: string;
  price: number;
  prevClose: number | null;
  asOf: string;
};

const CUSTOM_VALUE = "__custom__";

/**
 * Dropdown of the user's watchlist + holdings tickers. On select, fetches the
 * current quote from `/api/quote/[ticker]` and calls `onPick` with the result.
 * The parent component decides what to do with the price (auto-fill an entry
 * field, display a badge, etc).
 *
 * Falls back to a free-text input when "Custom…" is chosen so the user is
 * never locked out of a ticker that isn't on their watchlist.
 */
export function TickerPicker({
  tickers,
  value,
  onPick,
  label = "Ticker",
  autoCustomFetch = true,
}: {
  tickers: UserTicker[];
  value: string;
  onPick: (ticker: string, quote: PickedQuote | null, error: string | null) => void;
  label?: string;
  autoCustomFetch?: boolean;
}) {
  const baseId = useId();
  const selectId = `${baseId}-select`;
  const customId = `${baseId}-custom`;
  const [showCustom, setShowCustom] = useState(
    value !== "" && !tickers.some((t) => t.ticker === value),
  );
  const [customInput, setCustomInput] = useState(showCustom ? value : "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const fetchQuote = (ticker: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/quote/${encodeURIComponent(ticker)}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg =
            typeof body?.error === "string"
              ? body.error
              : `Quote unavailable (${res.status})`;
          setError(msg);
          onPick(ticker, null, msg);
          return;
        }
        const json = (await res.json()) as {
          quote: PickedQuote;
        };
        onPick(ticker, json.quote, null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Quote fetch failed";
        setError(msg);
        onPick(ticker, null, msg);
      }
    });
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    if (next === CUSTOM_VALUE) {
      setShowCustom(true);
      setCustomInput("");
      onPick("", null, null);
      return;
    }
    setShowCustom(false);
    setCustomInput("");
    if (next === "") {
      onPick("", null, null);
      return;
    }
    onPick(next, null, null);
    fetchQuote(next);
  };

  const handleCustomBlur = () => {
    const ticker = customInput.trim().toUpperCase();
    if (!ticker) {
      onPick("", null, null);
      return;
    }
    if (!autoCustomFetch) {
      onPick(ticker, null, null);
      return;
    }
    onPick(ticker, null, null);
    fetchQuote(ticker);
  };

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <label
        htmlFor={showCustom ? customId : selectId}
        className="font-medium text-foreground/90"
      >
        {label}
      </label>
      {showCustom ? (
        <div className="flex gap-1">
          <input
            id={customId}
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value.toUpperCase())}
            onBlur={handleCustomBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCustomBlur();
              }
            }}
            placeholder="AAPL"
            maxLength={10}
            className="h-9 flex-1 rounded-md border border-input bg-background/40 px-3 font-mono text-sm uppercase outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
          />
          {tickers.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowCustom(false);
                setCustomInput("");
                onPick("", null, null);
              }}
              className="h-9 rounded-md border border-input bg-background/40 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              List
            </button>
          )}
        </div>
      ) : (
        <select
          id={selectId}
          value={value}
          onChange={handleSelectChange}
          className="h-9 rounded-md border border-input bg-background/40 px-2 font-mono text-sm outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
        >
          <option value="">— pick a ticker —</option>
          {tickers.map((t) => (
            <option key={t.ticker} value={t.ticker}>
              {t.ticker}
              {t.source === "holding"
                ? " · held"
                : t.source === "both"
                  ? " · held + watch"
                  : ""}
            </option>
          ))}
          <option value={CUSTOM_VALUE}>Custom…</option>
        </select>
      )}
      <span className="text-[10px] text-muted-foreground tabular-nums min-h-[14px]">
        {pending
          ? "Fetching live quote…"
          : error
            ? error
            : tickers.length === 0 && !showCustom
              ? "Watchlist empty — enter a custom ticker"
              : ""}
      </span>
    </div>
  );
}
