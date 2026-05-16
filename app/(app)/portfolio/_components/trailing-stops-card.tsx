import { formatMoney } from "@/lib/format";
import type { TrailingStopsView } from "@/lib/portfolio";

function formatR(r: number): string {
  const sign = r > 0 ? "+" : "";
  return `${sign}${r.toFixed(2)}R`;
}

export function TrailingStopsCard({ view }: { view: TrailingStopsView }) {
  const actionable = view.rows.filter((r) => r.hasRatcheted).length;

  return (
    <div className="rounded-md border border-border/60 bg-card px-4 py-3 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-sm font-medium text-foreground">Trailing stops</p>
        <p className="text-xs text-muted-foreground">
          {actionable > 0
            ? `${actionable} position${actionable === 1 ? "" : "s"} could raise its stop`
            : "No stop adjustments suggested"}
        </p>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="font-medium py-1">Position</th>
            <th className="font-medium py-1 text-right">Current stop</th>
            <th className="font-medium py-1 text-right">Suggested</th>
            <th className="font-medium py-1 text-right">Locked in</th>
            <th className="font-medium py-1 text-right" />
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {view.rows.map((r) => (
            <tr key={r.ticker} className="border-t border-border/30">
              <td className="py-1">
                {r.ticker}
                <span className="ml-1.5 text-muted-foreground">
                  {r.direction}
                </span>
              </td>
              <td className="py-1 text-right text-muted-foreground">
                {formatMoney(r.currentStop)}
              </td>
              <td
                className={`py-1 text-right ${
                  r.hasRatcheted ? "text-emerald-400" : "text-foreground/80"
                }`}
              >
                {formatMoney(r.suggestedStop)}
              </td>
              <td
                className={`py-1 text-right ${
                  r.lockedInR > 0 ? "text-emerald-400" : "text-muted-foreground"
                }`}
              >
                {formatR(r.lockedInR)}
              </td>
              <td className="py-1 text-right">
                {r.hasRatcheted ? (
                  <span className="text-[10px] rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5">
                    raise stop
                  </span>
                ) : r.riskFree ? (
                  <span className="text-[10px] rounded border border-border/60 text-muted-foreground px-1.5 py-0.5">
                    risk removed
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {view.skippedCount > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {view.skippedCount} open position
          {view.skippedCount === 1 ? "" : "s"} not shown — no stop on file or no
          stored price history.
        </p>
      )}

      <details className="group">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition list-none">
          <span className="underline underline-offset-2 decoration-dotted">
            Why?
          </span>
        </summary>
        <div className="mt-2 border-t border-border/40 pt-2 text-[11px] text-muted-foreground leading-relaxed space-y-1">
          <p>
            The trailing stop sits {view.atrMultiplier} ATRs back from the
            highest price reached since the position opened (the lowest, for a
            short). It only ratchets in your favour — it never loosens past the
            stop already on file.
          </p>
          <p>
            Locked in = (suggested stop − entry) ÷ 1R. Once it turns positive
            the suggested stop has moved past entry: the initial risk is gone
            and the stop now protects profit rather than capital.
          </p>
        </div>
      </details>
    </div>
  );
}
