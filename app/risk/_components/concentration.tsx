"use client";

import { useMemo, useState } from "react";
import {
  concentrationLabel,
  RiskError,
  type ConcentrationSeverity,
} from "@/lib/risk";
import { formatMoney, formatPct } from "@/lib/format";
import {
  CalculatorCard,
  NumberField,
  ResultRow,
  WhyReveal,
  ErrorBanner,
} from "./shell";

const severityClass: Record<ConcentrationSeverity, string> = {
  low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  moderate: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  high: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  critical: "bg-red-500/15 text-red-300 border-red-500/30",
};

export function ConcentrationCalculator() {
  const [positionValue, setPositionValue] = useState(3000);
  const [portfolioValue, setPortfolioValue] = useState(10000);

  const result = useMemo(() => {
    try {
      return {
        ok: true as const,
        data: concentrationLabel({ positionValue, portfolioValue }),
      };
    } catch (err) {
      const message =
        err instanceof RiskError ? err.message : "Invalid input";
      return { ok: false as const, message };
    }
  }, [positionValue, portfolioValue]);

  return (
    <CalculatorCard
      title="Concentration"
      description="How much of the portfolio sits in a single position — and what bucket it falls in."
    >
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Position value ($)"
          value={positionValue}
          onChange={setPositionValue}
          step="1"
        />
        <NumberField
          label="Portfolio value ($)"
          value={portfolioValue}
          onChange={setPortfolioValue}
          step="1"
        />
      </div>

      {result.ok ? (
        <>
          <div className="rounded-lg border border-border/60 bg-background/30 p-4 space-y-3">
            <ResultRow
              label="Allocation"
              value={formatPct(result.data.pct)}
              emphasize
            />
            <div
              className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${severityClass[result.data.severity]}`}
            >
              {result.data.label}
            </div>
          </div>
          <WhyReveal>
            <p>
              allocation = position ÷ portfolio ={" "}
              {formatMoney(positionValue)} ÷ {formatMoney(portfolioValue)} ={" "}
              {formatPct(result.data.pct)}
            </p>
            <p>thresholds:</p>
            <p>· &lt; 10% → diversified (low)</p>
            <p>· 10–25% → concentrated (moderate)</p>
            <p>· 25–50% → high concentration (high)</p>
            <p>· ≥ 50% → single-name risk (critical)</p>
          </WhyReveal>
        </>
      ) : (
        <ErrorBanner message={result.message} />
      )}
    </CalculatorCard>
  );
}
