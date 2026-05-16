"use client";

import { useMemo, useState } from "react";
import { rMultiple, RiskError } from "@/lib/risk";
import { formatMoney, formatNumber } from "@/lib/format";
import { TickerPicker, type PickedQuote } from "@/components/ticker-picker";
import type { UserTicker } from "@/lib/user-tickers";
import {
  CalculatorCard,
  NumberField,
  ResultRow,
  WhyReveal,
  ErrorBanner,
} from "./shell";

export function RMultipleCalculator({
  tickers = [],
}: {
  tickers?: UserTicker[];
}) {
  const [entry, setEntry] = useState(100);
  const [stop, setStop] = useState(95);
  const [target, setTarget] = useState(115);
  const [exit, setExit] = useState(NaN);
  const [ticker, setTicker] = useState("");
  const [livePrice, setLivePrice] = useState<number | null>(null);

  const handlePick = (nextTicker: string, quote: PickedQuote | null) => {
    setTicker(nextTicker);
    if (quote) {
      setEntry(Number(quote.price.toFixed(2)));
      setLivePrice(quote.price);
    } else {
      setLivePrice(null);
    }
  };

  const result = useMemo(() => {
    try {
      return {
        ok: true as const,
        data: rMultiple({
          entry,
          stop,
          target,
          exit: Number.isFinite(exit) ? exit : undefined,
        }),
      };
    } catch (err) {
      const message =
        err instanceof RiskError ? err.message : "Invalid input";
      return { ok: false as const, message };
    }
  }, [entry, stop, target, exit]);

  return (
    <CalculatorCard
      title="R-multiple"
      description="Reward measured in units of risk. Planned R before entry, actual R after exit."
    >
      <TickerPicker
        tickers={tickers}
        value={ticker}
        onPick={handlePick}
        label="Ticker (auto-fills entry)"
      />
      {livePrice != null && ticker && (
        <p className="-mt-2 text-[11px] text-muted-foreground tabular-nums">
          Last {ticker}: {formatMoney(livePrice)} — auto-filled into entry
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Entry ($)" value={entry} onChange={setEntry} />
        <NumberField label="Stop ($)" value={stop} onChange={setStop} />
        <NumberField label="Target ($)" value={target} onChange={setTarget} />
        <NumberField
          label="Exit ($, optional)"
          value={exit}
          onChange={setExit}
        />
      </div>

      {result.ok ? (
        <>
          <div className="rounded-lg border border-border/60 bg-background/30 p-4 space-y-2">
            <ResultRow
              label="Planned R"
              value={`${formatNumber(result.data.plannedR)}R`}
              emphasize
            />
            <ResultRow
              label="Actual R"
              value={
                result.data.actualR === null
                  ? "— (no exit yet)"
                  : `${formatNumber(result.data.actualR)}R`
              }
            />
            <ResultRow
              label="1R (per share)"
              value={formatMoney(result.data.r)}
            />
            <ResultRow label="Direction" value={result.data.direction} />
          </div>
          <WhyReveal>
            <p>
              direction inferred from stop vs entry → {result.data.direction}
            </p>
            <p>
              1R = |entry − stop| = |{formatMoney(entry)} −{" "}
              {formatMoney(stop)}| = {formatMoney(result.data.r)}
            </p>
            <p>
              {result.data.direction === "long"
                ? `planned R = (target − entry) ÷ 1R = (${formatMoney(target)} − ${formatMoney(entry)}) ÷ ${formatMoney(result.data.r)}`
                : `planned R = (entry − target) ÷ 1R = (${formatMoney(entry)} − ${formatMoney(target)}) ÷ ${formatMoney(result.data.r)}`}{" "}
              = {formatNumber(result.data.plannedR)}R
            </p>
            {result.data.actualR !== null ? (
              <p>
                {result.data.direction === "long"
                  ? `actual R = (exit − entry) ÷ 1R = (${formatMoney(exit)} − ${formatMoney(entry)}) ÷ ${formatMoney(result.data.r)}`
                  : `actual R = (entry − exit) ÷ 1R = (${formatMoney(entry)} − ${formatMoney(exit)}) ÷ ${formatMoney(result.data.r)}`}{" "}
                = {formatNumber(result.data.actualR)}R
              </p>
            ) : null}
          </WhyReveal>
        </>
      ) : (
        <ErrorBanner message={result.message} />
      )}
    </CalculatorCard>
  );
}
