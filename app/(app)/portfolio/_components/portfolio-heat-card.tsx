import { formatMoney, formatPct } from "@/lib/format";
import type { PortfolioHeatOutput } from "@/lib/risk";

type Severity = "ok" | "warning" | "critical";

const TONE: Record<
  Severity,
  { border: string; bar: string; text: string }
> = {
  ok: {
    border: "border-border/60",
    bar: "bg-emerald-500",
    text: "text-emerald-400",
  },
  warning: {
    border: "border-yellow-500/40",
    bar: "bg-yellow-500",
    text: "text-yellow-400",
  },
  critical: {
    border: "border-destructive/50",
    bar: "bg-destructive",
    text: "text-destructive-foreground",
  },
};

export function PortfolioHeatCard({
  heat,
  maxHeatPct,
}: {
  heat: PortfolioHeatOutput;
  maxHeatPct: number;
}) {
  const ratio = heat.maxHeat > 0 ? heat.totalRisk / heat.maxHeat : 0;
  const fillPct = Math.min(100, Math.max(0, ratio * 100));

  const severity: Severity = heat.breached
    ? "critical"
    : ratio >= 0.8
      ? "warning"
      : "ok";
  const tone = TONE[severity];

  const headline = heat.breached
    ? "Portfolio heat over ceiling — review position size before adding risk"
    : severity === "warning"
      ? "Portfolio heat approaching ceiling"
      : "Portfolio heat within ceiling";

  const quantified = heat.positions
    .filter((p) => p.hasStop)
    .sort((a, b) => (b.riskAmount ?? 0) - (a.riskAmount ?? 0));
  const unstopped = heat.positions.filter((p) => !p.hasStop);

  return (
    <div className={`rounded-md border ${tone.border} bg-card px-4 py-3 space-y-3`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className={`text-sm font-medium ${tone.text}`}>{headline}</p>
        <p className="text-xs text-muted-foreground font-mono tabular-nums">
          {formatMoney(heat.totalRisk)} at risk · {formatPct(heat.totalRiskPct)}{" "}
          of account
        </p>
      </div>

      <div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-background/60">
          <div
            className={`h-full ${tone.bar} transition-[width]`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground font-mono tabular-nums">
          <span>
            {formatPct(heat.totalRiskPct)} used
          </span>
          <span>
            ceiling {formatPct(maxHeatPct)} ({formatMoney(heat.maxHeat)})
          </span>
        </div>
      </div>

      {heat.breached ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Total open risk has reached your heat ceiling. Adding another
          position raises the loss you would take if every stop triggered at
          once. Consider tightening a stop or reducing size first.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {formatMoney(heat.remaining)} of heat room left before the ceiling.
        </p>
      )}

      {unstopped.length > 0 && (
        <p className="text-xs text-yellow-400/90 leading-relaxed">
          {unstopped.length === 1
            ? "1 position has no stop on file"
            : `${unstopped.length} positions have no stop on file`}
          {" — "}
          their risk is not counted in this total ({" "}
          {unstopped.map((p) => p.ticker).join(", ")} ).
        </p>
      )}

      <details className="group">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition list-none">
          <span className="underline underline-offset-2 decoration-dotted">
            Why?
          </span>
        </summary>
        <div className="mt-2 space-y-2 border-t border-border/40 pt-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Open risk per position = (open-risk basis − stop) × shares, where
            the basis is the live price, or entry when no quote is available.
            Portfolio heat is the sum across positions. The ceiling is account
            size × max heat % ({formatPct(maxHeatPct)}).
          </p>
          {quantified.length > 0 ? (
            <table className="w-full text-[11px] font-mono tabular-nums">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="font-medium py-0.5">Position</th>
                  <th className="font-medium py-0.5 text-right">At risk</th>
                  <th className="font-medium py-0.5 text-right">% account</th>
                </tr>
              </thead>
              <tbody>
                {quantified.map((p) => (
                  <tr key={p.ticker} className="border-t border-border/30">
                    <td className="py-0.5">
                      {p.ticker}
                      <span className="ml-1.5 text-muted-foreground">
                        {p.direction}
                      </span>
                    </td>
                    <td className="py-0.5 text-right">
                      {formatMoney(p.riskAmount ?? 0)}
                    </td>
                    <td className="py-0.5 text-right">
                      {formatPct(p.riskPct ?? 0)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border/50 font-medium">
                  <td className="py-0.5">Total</td>
                  <td className="py-0.5 text-right">
                    {formatMoney(heat.totalRisk)}
                  </td>
                  <td className="py-0.5 text-right">
                    {formatPct(heat.totalRiskPct)}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              No positions with a stop on file yet.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
