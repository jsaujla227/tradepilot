"use client";

import { useMemo, useState } from "react";
import { lossScenarios, RiskError } from "@/lib/risk";
import { formatMoney, formatPct } from "@/lib/format";
import { TickerPicker, type PickedQuote } from "@/components/ticker-picker";
import type { UserTicker } from "@/lib/user-tickers";
import {
  CalculatorCard,
  NumberField,
  WhyReveal,
  ErrorBanner,
} from "./shell";

export function LossScenariosCalculator({
  tickers = [],
}: {
  tickers?: UserTicker[];
}) {
  const [shares, setShares] = useState(100);
  const [entry, setEntry] = useState(50);
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
        data: lossScenarios({ shares, entry }),
      };
    } catch (err) {
      const message =
        err instanceof RiskError ? err.message : "Invalid input";
      return { ok: false as const, message };
    }
  }, [shares, entry]);

  return (
    <CalculatorCard
      title="Loss scenarios"
      description="What this position loses at -1%, -3%, -5%, -10%, and -20% adverse moves."
    >
      <TickerPicker
        tickers={tickers}
        value={ticker}
        onPick={handlePick}
        label="Ticker (auto-fills cost basis)"
      />
      {livePrice != null && ticker && (
        <p className="-mt-2 text-[11px] text-muted-foreground tabular-nums">
          Last {ticker}: {formatMoney(livePrice)} — auto-filled into cost basis
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Shares" value={shares} onChange={setShares} step="1" />
        <NumberField label="Cost basis ($)" value={entry} onChange={setEntry} />
      </div>

      {result.ok ? (
        <>
          <div className="rounded-lg border border-border/60 bg-background/30 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/30">
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium px-3 py-2">Drop</th>
                  <th className="text-right font-medium px-3 py-2">Price</th>
                  <th className="text-right font-medium px-3 py-2">Loss</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {result.data.scenarios.map((s) => (
                  <tr key={s.dropPct} className="border-t border-border/60">
                    <td className="px-3 py-2 text-foreground/80">
                      {formatPct(s.dropPct)}
                    </td>
                    <td className="px-3 py-2 text-right text-foreground/90">
                      {formatMoney(s.priceAtDrop)}
                    </td>
                    <td className="px-3 py-2 text-right text-destructive-foreground">
                      −{formatMoney(s.loss)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/20">
                  <td className="px-3 py-2 text-muted-foreground">
                    Position value
                  </td>
                  <td
                    colSpan={2}
                    className="px-3 py-2 text-right font-semibold tabular-nums"
                  >
                    {formatMoney(result.data.positionValue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <WhyReveal>
            <p>
              position value = shares × cost basis = {shares} ×{" "}
              {formatMoney(entry)} = {formatMoney(result.data.positionValue)}
            </p>
            <p>
              for each drop d% → price = entry × (1 + d/100), loss = shares ×
              (entry − price)
            </p>
          </WhyReveal>
        </>
      ) : (
        <ErrorBanner message={result.message} />
      )}
    </CalculatorCard>
  );
}
