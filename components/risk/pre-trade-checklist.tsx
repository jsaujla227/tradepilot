"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  positionSize,
  rMultiple,
  lossScenarios,
  type PositionSizeOutput,
  type RMultipleOutput,
  type LossScenariosOutput,
} from "@/lib/risk";
import { formatMoney, formatPct, formatNumber } from "@/lib/format";
import {
  submitTrade,
  type SubmitTradeState,
} from "@/app/(app)/orders/actions";
import { TickerContextPanel } from "@/components/ticker/ticker-context-panel";

type PatternMatch = {
  pattern_type: "winning" | "losing" | "neutral";
  description: string;
  win_rate: number;
  expectancy: number;
  profit_factor: number | null;
  sample_count: number;
  match_reason: string;
};

type PreTradeVerdict = {
  matched_patterns: PatternMatch[];
  assessment: {
    confidence: "low" | "medium" | "high";
    primary_risk: string;
    reasoning: string;
  } | null;
  total_patterns_in_library: number;
};

type Props = {
  accountSize: number;
  maxRiskPct: number;
};

const initial: SubmitTradeState = {};

const INPUT =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

export function PreTradeChecklist({ accountSize, maxRiskPct }: Props) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(submitTrade, initial);

  // Controlled fields that drive live calculations
  const [ticker, setTicker] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [qty, setQty] = useState("");
  const qtyTouched = useRef(false);

  // Pre-trade pattern verdict
  const [patternVerdict, setPatternVerdict] = useState<PreTradeVerdict | null>(null);
  const [verdictPending, setVerdictPending] = useState(false);
  const verdictTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live outputs
  const [psOut, setPsOut] = useState<PositionSizeOutput | null>(null);
  const [rmOut, setRmOut] = useState<RMultipleOutput | null>(null);
  const [lsOut, setLsOut] = useState<LossScenariosOutput | null>(null);

  useEffect(() => {
    const e = parseFloat(entry);
    const s = parseFloat(stop);
    const t = parseFloat(target);

    // Position size
    if (e > 0 && s > 0 && e !== s && accountSize > 0 && maxRiskPct > 0) {
      try {
        const ps = positionSize({ entry: e, stop: s, accountSize, maxRiskPct });
        setPsOut(ps);
        if (!qtyTouched.current) {
          setQty(String(ps.shares));
        }
      } catch {
        setPsOut(null);
      }
    } else {
      setPsOut(null);
    }

    // R-multiple
    if (e > 0 && s > 0 && t > 0 && e !== s) {
      try {
        setRmOut(rMultiple({ entry: e, stop: s, target: t }));
      } catch {
        setRmOut(null);
      }
    } else {
      setRmOut(null);
    }
  }, [entry, stop, target, accountSize, maxRiskPct]);

  useEffect(() => {
    const e = parseFloat(entry);
    const q = parseFloat(qty);
    const effectiveQty = q > 0 ? q : (psOut?.shares ?? 0);
    if (e > 0 && effectiveQty > 0) {
      try {
        setLsOut(lossScenarios({ shares: effectiveQty, entry: e }));
      } catch {
        setLsOut(null);
      }
    } else {
      setLsOut(null);
    }
  }, [entry, qty, psOut?.shares]);

  // Debounced pre-trade pattern fetch
  useEffect(() => {
    if (verdictTimer.current) clearTimeout(verdictTimer.current);

    const e = parseFloat(entry);
    const s = parseFloat(stop);
    const t = parseFloat(target);
    if (!ticker || !rmOut || !(e > 0) || !(s > 0) || !(t > 0)) {
      setPatternVerdict(null);
      return;
    }

    verdictTimer.current = setTimeout(async () => {
      setVerdictPending(true);
      try {
        const direction = side === "buy" ? "long" : "short";
        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "pre-trade",
            prompt: `Evaluate this setup for ${ticker}: ${direction} entry $${e}, stop $${s}, target $${t}. R-multiple ${rmOut.plannedR.toFixed(2)}.`,
            dataProvided: {
              ticker,
              direction,
              entry: e,
              stop: s,
              target: t,
              planned_r: rmOut.plannedR,
            },
            setupDirection: direction,
            setupRAtEntry: rmOut.plannedR,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.matched_patterns !== undefined) {
          setPatternVerdict({
            matched_patterns: data.matched_patterns,
            assessment: data.assessment ?? null,
            total_patterns_in_library: data.total_patterns_in_library ?? 0,
          });
        }
      } catch {
        // non-critical — verdict panel simply won't show
      } finally {
        setVerdictPending(false);
      }
    }, 800);

    return () => {
      if (verdictTimer.current) clearTimeout(verdictTimer.current);
    };
  }, [ticker, side, entry, stop, target, rmOut]);

  // Close dialog on successful fill
  useEffect(() => {
    if (state.orderId) {
      setOpen(false);
    }
  }, [state.orderId]);

  function resetForm() {
    setTicker("");
    setSide("buy");
    setEntry("");
    setStop("");
    setTarget("");
    setQty("");
    qtyTouched.current = false;
    setPsOut(null);
    setRmOut(null);
    setLsOut(null);
    setPatternVerdict(null);
  }

  // Proposed notional (entry × qty) drives sector-exposure projection.
  const proposedNotional = (() => {
    const e = parseFloat(entry);
    const q = parseFloat(qty);
    const effectiveQty = q > 0 ? q : (psOut?.shares ?? 0);
    if (e > 0 && effectiveQty > 0) return e * effectiveQty;
    return null;
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:bg-foreground/90">
          New trade
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pre-trade checklist</DialogTitle>
        </DialogHeader>

        {/* Circuit-breaker block */}
        {state.blocked && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 space-y-2">
            <p className="text-sm font-semibold text-destructive">
              Daily loss limit reached — trading blocked
            </p>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>Open P&amp;L today: <span className="tabular-nums font-mono">{formatMoney(state.blocked.totalToday)}</span></p>
              <p>Limit: <span className="tabular-nums font-mono">{formatMoney(-state.blocked.limit)}</span></p>
              <p>Room remaining: <span className="tabular-nums font-mono">{formatMoney(state.blocked.remaining)}</span></p>
            </div>
            <p className="text-xs text-muted-foreground">
              Why? Your portfolio is down more than your daily loss limit ({formatPct(0)} of account). Reset tomorrow or raise the limit in Settings.
            </p>
          </div>
        )}

        <form action={formAction} className="space-y-5">
          {/* Row 1: ticker + side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="ptc-ticker" className="text-xs text-muted-foreground">
                Ticker
              </label>
              <input
                id="ptc-ticker"
                name="ticker"
                type="text"
                placeholder="AAPL"
                required
                maxLength={12}
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                className={`${INPUT} font-mono uppercase`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="ptc-side" className="text-xs text-muted-foreground">
                Side
              </label>
              <select
                id="ptc-side"
                name="side"
                value={side}
                onChange={(e) => setSide(e.target.value as "buy" | "sell")}
                className={INPUT}
              >
                <option value="buy">Buy (long)</option>
                <option value="sell">Sell (short)</option>
              </select>
            </div>
          </div>

          {/* Row 2: entry / stop / target / qty */}
          <div className="grid grid-cols-4 gap-3">
            {(
              [
                { id: "entry", label: "Entry $", val: entry, set: setEntry },
                { id: "stop", label: "Stop $", val: stop, set: setStop },
                { id: "target", label: "Target $", val: target, set: setTarget },
              ] as const
            ).map(({ id, label, val, set }) => (
              <div key={id} className="space-y-1">
                <label htmlFor={`ptc-${id}`} className="text-xs text-muted-foreground">
                  {label}
                </label>
                <input
                  id={`ptc-${id}`}
                  name={id}
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  value={val}
                  onChange={(e) => set(e.target.value)}
                  className={INPUT}
                />
              </div>
            ))}
            <div className="space-y-1">
              <label htmlFor="ptc-qty" className="text-xs text-muted-foreground">
                Qty
                {psOut && !qtyTouched.current && (
                  <span className="ml-1 text-[10px] text-muted-foreground/60">
                    (suggested)
                  </span>
                )}
              </label>
              <input
                id="ptc-qty"
                name="qty"
                type="number"
                min="0.00000001"
                step="any"
                required
                value={qty}
                onChange={(e) => {
                  qtyTouched.current = true;
                  setQty(e.target.value);
                }}
                className={INPUT}
              />
            </div>
          </div>

          {/* Ticker context (earnings, news, analyst consensus, sector exposure) */}
          {ticker && (
            <TickerContextPanel
              ticker={ticker}
              proposedNotional={proposedNotional}
            />
          )}

          {/* Live risk panel */}
          {(psOut || rmOut || lsOut) && (
            <div className="rounded-md border border-border bg-card/60 p-3 space-y-3 text-xs">
              {psOut && (
                <div className="space-y-1">
                  <p className="font-medium text-muted-foreground uppercase tracking-wide">
                    Position size
                  </p>
                  <div className="grid grid-cols-3 gap-x-4 tabular-nums text-foreground/80">
                    <span>Risk amount: <b>{formatMoney(psOut.riskAmount)}</b></span>
                    <span>Per-share risk: <b>{formatMoney(psOut.perShareRisk)}</b></span>
                    <span>Capital req: <b>{formatMoney(psOut.capitalRequired)}</b></span>
                    <span>% of account: <b>{formatPct(psOut.pctOfAccount)}</b></span>
                    <span>Direction: <b className="capitalize">{psOut.direction}</b></span>
                  </div>
                </div>
              )}

              {rmOut && (
                <div className="space-y-1">
                  <p className="font-medium text-muted-foreground uppercase tracking-wide">
                    R-multiple
                  </p>
                  <div className="flex gap-x-4 tabular-nums text-foreground/80">
                    <span>1R = <b>{formatMoney(rmOut.r)}</b></span>
                    <span>
                      Planned R:{" "}
                      <b
                        className={
                          rmOut.plannedR >= 2
                            ? "text-green-400"
                            : rmOut.plannedR < 1
                              ? "text-red-400"
                              : ""
                        }
                      >
                        {formatNumber(rmOut.plannedR, 2)}R
                      </b>
                    </span>
                  </div>
                </div>
              )}

              {lsOut && (
                <div className="space-y-1">
                  <p className="font-medium text-muted-foreground uppercase tracking-wide">
                    Loss scenarios
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 tabular-nums text-foreground/80">
                    {lsOut.scenarios.map((sc) => (
                      <span key={sc.dropPct}>
                        {sc.dropPct}%: <b className="text-red-400">{formatMoney(sc.loss)}</b>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pre-trade pattern verdict */}
          {(verdictPending || patternVerdict) && (
            <div className="rounded-md border border-border bg-card/60 p-3 space-y-2 text-xs">
              <p className="font-medium text-muted-foreground uppercase tracking-wide">
                Pattern library match
                {verdictPending && (
                  <span className="ml-2 normal-case font-normal text-muted-foreground/60">
                    analysing…
                  </span>
                )}
                {!verdictPending && patternVerdict && (
                  <span className="ml-2 normal-case font-normal text-muted-foreground/60">
                    {patternVerdict.total_patterns_in_library} pattern
                    {patternVerdict.total_patterns_in_library !== 1 ? "s" : ""} in library
                  </span>
                )}
              </p>

              {!verdictPending && patternVerdict && (
                <>
                  {patternVerdict.matched_patterns.length === 0 ? (
                    <p className="text-muted-foreground/70">
                      No matching patterns found yet — keep logging trades to build your library.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {patternVerdict.matched_patterns.map((pm, i) => (
                        <div
                          key={i}
                          className={`rounded border px-2 py-1.5 space-y-0.5 ${
                            pm.pattern_type === "winning"
                              ? "border-green-500/30 bg-green-500/5"
                              : pm.pattern_type === "losing"
                                ? "border-red-500/30 bg-red-500/5"
                                : "border-border"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                pm.pattern_type === "winning"
                                  ? "bg-green-500/20 text-green-400"
                                  : pm.pattern_type === "losing"
                                    ? "bg-red-500/20 text-red-400"
                                    : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {pm.pattern_type}
                            </span>
                            <span className="text-foreground/80">{pm.description}</span>
                          </div>
                          <div className="flex gap-x-4 tabular-nums text-muted-foreground">
                            <span>
                              Win rate:{" "}
                              <b className="text-foreground/80">
                                {(pm.win_rate * 100).toFixed(0)}%
                              </b>
                            </span>
                            <span>
                              Expectancy:{" "}
                              <b
                                className={
                                  pm.expectancy > 0 ? "text-green-400" : "text-red-400"
                                }
                              >
                                {pm.expectancy > 0 ? "+" : ""}
                                {pm.expectancy.toFixed(2)}R
                              </b>
                            </span>
                            <span>
                              Profit factor:{" "}
                              <b
                                className={
                                  pm.profit_factor == null
                                    ? "text-foreground/80"
                                    : pm.profit_factor >= 1
                                      ? "text-green-400"
                                      : "text-red-400"
                                }
                              >
                                {pm.profit_factor == null
                                  ? "no losses"
                                  : pm.profit_factor.toFixed(2)}
                              </b>
                            </span>
                            <span>
                              Samples: <b className="text-foreground/80">{pm.sample_count}</b>
                            </span>
                          </div>
                          <p className="text-muted-foreground/70 italic">{pm.match_reason}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {patternVerdict.assessment && (
                    <div
                      className={`rounded border px-2 py-1.5 space-y-0.5 ${
                        patternVerdict.assessment.confidence === "high"
                          ? "border-amber-500/30 bg-amber-500/5"
                          : "border-border"
                      }`}
                    >
                      <p className="font-medium text-muted-foreground">
                        AI assessment —{" "}
                        <span
                          className={
                            patternVerdict.assessment.confidence === "high"
                              ? "text-amber-400"
                              : patternVerdict.assessment.confidence === "medium"
                                ? "text-yellow-400"
                                : "text-muted-foreground"
                          }
                        >
                          {patternVerdict.assessment.confidence} confidence
                        </span>
                      </p>
                      <p className="text-muted-foreground/80">
                        {patternVerdict.assessment.reasoning}
                      </p>
                      {patternVerdict.assessment.primary_risk && (
                        <p className="text-red-400/80">
                          Primary risk: {patternVerdict.assessment.primary_risk}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Reason */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Reason for this trade
            </label>
            <textarea
              name="reason"
              required
              rows={2}
              maxLength={1000}
              placeholder="Why are you entering this position?"
              className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          {/* What could go wrong */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              What could go wrong?
            </label>
            <textarea
              name="what_could_go_wrong"
              required
              rows={2}
              maxLength={1000}
              placeholder="What is your high-risk scenario?"
              className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          {state.error && !state.blocked && (
            <p className="text-xs text-destructive">{state.error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || Boolean(state.blocked)}
              className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:opacity-50"
            >
              {pending ? "Submitting…" : "Submit paper order"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
