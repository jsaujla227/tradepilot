"use client";

import { useMemo, useState } from "react";
import { volatilityTargetSize, RiskError, type Direction } from "@/lib/risk";
import { formatMoney, formatPct, formatNumber } from "@/lib/format";
import { TickerPicker, type PickedQuote } from "@/components/ticker-picker";
import type { UserTicker } from "@/lib/user-tickers";
import {
  CalculatorCard,
  NumberField,
  ResultRow,
  WhyReveal,
  ErrorBanner,
} from "./shell";

type AtrStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "loaded"; barCount: number }
  | { state: "unavailable" };

export function VolatilitySizeCalculator({
  defaultAccountSize = 10000,
  defaultMaxRiskPct = 1,
  tickers = [],
}: {
  defaultAccountSize?: number;
  defaultMaxRiskPct?: number;
  tickers?: UserTicker[];
}) {
  const [accountSize, setAccountSize] = useState(defaultAccountSize);
  const [maxRiskPct, setMaxRiskPct] = useState(defaultMaxRiskPct);
  const [entry, setEntry] = useState(100);
  const [atr, setAtr] = useState(2.5);
  const [atrMultiplier, setAtrMultiplier] = useState(2);
  const [direction, setDirection] = useState<Direction>("long");
  const [ticker, setTicker] = useState("");
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [atrStatus, setAtrStatus] = useState<AtrStatus>({ state: "idle" });

  const loadBarStats = async (nextTicker: string) => {
    setAtrStatus({ state: "loading" });
    try {
      const res = await fetch(
        `/api/bar-stats/${encodeURIComponent(nextTicker)}`,
      );
      if (!res.ok) throw new Error("request failed");
      const data: { atr14: number | null; barCount: number } =
        await res.json();
      if (typeof data.atr14 === "number" && data.atr14 > 0) {
        setAtr(Number(data.atr14.toFixed(2)));
        setAtrStatus({ state: "loaded", barCount: data.barCount });
      } else {
        setAtrStatus({ state: "unavailable" });
      }
    } catch {
      setAtrStatus({ state: "unavailable" });
    }
  };

  const handlePick = (nextTicker: string, quote: PickedQuote | null) => {
    setTicker(nextTicker);
    if (quote) {
      setEntry(Number(quote.price.toFixed(2)));
      setLivePrice(quote.price);
      void loadBarStats(nextTicker);
    } else {
      setLivePrice(null);
      if (!nextTicker) setAtrStatus({ state: "idle" });
    }
  };

  const result = useMemo(() => {
    try {
      return {
        ok: true as const,
        data: volatilityTargetSize({
          entry,
          atr,
          accountSize,
          maxRiskPct,
          atrMultiplier,
          direction,
        }),
      };
    } catch (err) {
      const message = err instanceof RiskError ? err.message : "Invalid input";
      return { ok: false as const, message };
    }
  }, [entry, atr, accountSize, maxRiskPct, atrMultiplier, direction]);

  return (
    <CalculatorCard
      title="Volatility-targeted size"
      description="Sizes the position from an ATR-derived stop, so dollar risk stays fixed while the stop adapts to how volatile the stock is."
    >
      <TickerPicker
        tickers={tickers}
        value={ticker}
        onPick={handlePick}
        label="Ticker (auto-fills entry + ATR)"
      />
      {livePrice != null && ticker && (
        <p className="-mt-2 text-[11px] text-muted-foreground tabular-nums">
          Last {ticker}: {formatMoney(livePrice)} — auto-filled into entry
        </p>
      )}
      {atrStatus.state === "loading" && (
        <p className="-mt-2 text-[11px] text-muted-foreground">Loading ATR…</p>
      )}
      {atrStatus.state === "loaded" && (
        <p className="-mt-2 text-[11px] text-muted-foreground tabular-nums">
          ATR-14 auto-filled from {atrStatus.barCount} daily bars.
        </p>
      )}
      {atrStatus.state === "unavailable" && (
        <p className="-mt-2 text-[11px] text-yellow-400/80">
          No stored bars for {ticker} — enter ATR manually.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Account size ($)"
          value={accountSize}
          onChange={setAccountSize}
          step="1"
        />
        <NumberField
          label="Max risk per trade (%)"
          value={maxRiskPct}
          onChange={setMaxRiskPct}
          step="0.1"
        />
        <NumberField label="Entry price ($)" value={entry} onChange={setEntry} />
        <NumberField label="ATR ($)" value={atr} onChange={setAtr} />
        <NumberField
          label="Stop distance (ATRs)"
          value={atrMultiplier}
          onChange={setAtrMultiplier}
          step="0.1"
        />
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-foreground/90">Direction</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
            className="rounded-md border border-input bg-background/40 px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>
      </div>

      {result.ok ? (
        <>
          <div className="rounded-lg border border-border/60 bg-background/30 p-4 space-y-2">
            <ResultRow
              label="Shares"
              value={formatNumber(result.data.shares, 0)}
              emphasize
            />
            <ResultRow label="ATR stop" value={formatMoney(result.data.stop)} />
            <ResultRow
              label="Per-share risk"
              value={formatMoney(result.data.perShareRisk)}
            />
            <ResultRow
              label="Stop distance"
              value={formatPct(result.data.stopDistancePct)}
            />
            <ResultRow
              label="$ at risk"
              value={formatMoney(result.data.riskAmount)}
            />
            <ResultRow
              label="Capital required"
              value={formatMoney(result.data.capitalRequired)}
            />
            <ResultRow
              label="% of account"
              value={formatPct(result.data.pctOfAccount)}
            />
          </div>
          <WhyReveal>
            <p>
              per-share risk = stop distance × ATR ={" "}
              {formatNumber(atrMultiplier, 1)} × {formatMoney(atr)} ={" "}
              {formatMoney(result.data.perShareRisk)}
            </p>
            <p>
              ATR stop = entry {direction === "long" ? "−" : "+"} per-share risk
              = {formatMoney(entry)} {direction === "long" ? "−" : "+"}{" "}
              {formatMoney(result.data.perShareRisk)} ={" "}
              {formatMoney(result.data.stop)}
            </p>
            <p>
              risk $ = account × max risk % = {formatMoney(accountSize)} ×{" "}
              {formatPct(maxRiskPct)} = {formatMoney(result.data.riskAmount)}
            </p>
            <p>
              shares = floor(risk $ ÷ per-share risk) ={" "}
              {formatNumber(result.data.shares, 0)}
            </p>
            <p>
              The stop scales with this stock&apos;s ATR, so dollar risk is
              fixed while the share count adapts to volatility.
            </p>
          </WhyReveal>
        </>
      ) : (
        <ErrorBanner message={result.message} />
      )}
    </CalculatorCard>
  );
}
