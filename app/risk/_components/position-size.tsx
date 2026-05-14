"use client";

import { useMemo, useState } from "react";
import { positionSize, RiskError } from "@/lib/risk";
import { formatMoney, formatPct, formatNumber } from "@/lib/format";
import {
  CalculatorCard,
  NumberField,
  ResultRow,
  WhyReveal,
  ErrorBanner,
} from "./shell";

export function PositionSizeCalculator() {
  const [accountSize, setAccountSize] = useState(10000);
  const [maxRiskPct, setMaxRiskPct] = useState(1);
  const [entry, setEntry] = useState(100);
  const [stop, setStop] = useState(95);

  const result = useMemo(() => {
    try {
      return {
        ok: true as const,
        data: positionSize({ accountSize, maxRiskPct, entry, stop }),
      };
    } catch (err) {
      const message =
        err instanceof RiskError ? err.message : "Invalid input";
      return { ok: false as const, message };
    }
  }, [accountSize, maxRiskPct, entry, stop]);

  return (
    <CalculatorCard
      title="Position size"
      description="How many shares risk exactly your max-risk-per-trade if the stop fills."
    >
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
        <NumberField
          label="Entry price ($)"
          value={entry}
          onChange={setEntry}
        />
        <NumberField
          label="Stop price ($)"
          value={stop}
          onChange={setStop}
        />
      </div>

      {result.ok ? (
        <>
          <div className="rounded-lg border border-border/60 bg-background/30 p-4 space-y-2">
            <ResultRow
              label="Shares"
              value={formatNumber(result.data.shares, 0)}
              emphasize
            />
            <ResultRow
              label="$ at risk"
              value={formatMoney(result.data.riskAmount)}
            />
            <ResultRow
              label="Per-share risk"
              value={formatMoney(result.data.perShareRisk)}
            />
            <ResultRow
              label="Capital required"
              value={formatMoney(result.data.capitalRequired)}
            />
            <ResultRow
              label="% of account"
              value={formatPct(result.data.pctOfAccount)}
            />
            <ResultRow
              label="Direction"
              value={result.data.direction}
            />
          </div>
          <WhyReveal>
            <p>
              risk $ = account × max risk % ={" "}
              {formatMoney(accountSize)} × {formatPct(maxRiskPct)} ={" "}
              {formatMoney(result.data.riskAmount)}
            </p>
            <p>
              per-share risk = |entry − stop| = |{formatMoney(entry)} −{" "}
              {formatMoney(stop)}| = {formatMoney(result.data.perShareRisk)}
            </p>
            <p>
              shares = floor(risk $ ÷ per-share risk) ={" "}
              {formatNumber(result.data.shares, 0)}
            </p>
            <p>
              capital required = shares × entry ={" "}
              {formatMoney(result.data.capitalRequired)}
            </p>
          </WhyReveal>
        </>
      ) : (
        <ErrorBanner message={result.message} />
      )}
    </CalculatorCard>
  );
}
