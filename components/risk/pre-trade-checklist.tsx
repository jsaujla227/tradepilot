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
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [qty, setQty] = useState("");
  const qtyTouched = useRef(false);

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

  // Close dialog on successful fill
  useEffect(() => {
    if (state.orderId) {
      setOpen(false);
    }
  }, [state.orderId]);

  function resetForm() {
    setTicker("");
    setEntry("");
    setStop("");
    setTarget("");
    setQty("");
    qtyTouched.current = false;
    setPsOut(null);
    setRmOut(null);
    setLsOut(null);
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
              <label className="text-xs text-muted-foreground">Ticker</label>
              <input
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
              <label className="text-xs text-muted-foreground">Side</label>
              <select name="side" className={INPUT}>
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
                <label className="text-xs text-muted-foreground">{label}</label>
                <input
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
              <label className="text-xs text-muted-foreground">
                Qty
                {psOut && !qtyTouched.current && (
                  <span className="ml-1 text-[10px] text-muted-foreground/60">
                    (suggested)
                  </span>
                )}
              </label>
              <input
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
