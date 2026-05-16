"use client";

import { useActionState } from "react";
import {
  connectQuestrade,
  disconnectQuestrade,
  type QuestradeConnectState,
} from "../actions";

export type QuestradeStatus = {
  connected: boolean;
  accountId: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function QuestradeConnect({ status }: { status: QuestradeStatus }) {
  const [connectState, connectAction, connecting] = useActionState<
    QuestradeConnectState,
    FormData
  >(connectQuestrade, {});
  const [disconnectState, disconnectAction, disconnecting] = useActionState<
    QuestradeConnectState,
    FormData
  >(disconnectQuestrade, {});

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
        Questrade connection
      </p>
      <div className="rounded-lg border border-border/60 bg-background/30 px-4 py-3 space-y-3">
        {status.connected ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm">Status</span>
              <span className="text-xs font-mono uppercase font-semibold text-emerald-400">
                Connected
              </span>
            </div>
            <dl className="text-[11px] text-muted-foreground space-y-1">
              <div className="flex justify-between gap-4">
                <dt>Account</dt>
                <dd className="font-mono text-foreground/80">
                  {status.accountId ??
                    "selected when live trading is enabled"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Connected</dt>
                <dd className="font-mono">{formatWhen(status.connectedAt)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Token last refreshed</dt>
                <dd className="font-mono">{formatWhen(status.updatedAt)}</dd>
              </div>
            </dl>
            {disconnectState.error && (
              <p className="text-xs text-destructive-foreground">
                {disconnectState.error}
              </p>
            )}
            <form action={disconnectAction}>
              <button
                type="submit"
                disabled={disconnecting}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 hover:bg-card/80 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Generate a personal-app refresh token in the Questrade App Hub
              (API access), then paste it here. TradePilot exchanges it for an
              access token and stores the rotating credentials — the token you
              paste is consumed immediately and replaced.
            </p>
            {connectState.error && (
              <p className="text-xs text-destructive-foreground">
                {connectState.error}
              </p>
            )}
            <form action={connectAction} className="space-y-2">
              <input
                type="password"
                name="refresh_token"
                autoComplete="off"
                placeholder="Questrade refresh token"
                required
                className="w-full rounded-md border border-input bg-background/40 px-3 py-2 text-sm font-mono text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
              />
              <button
                type="submit"
                disabled={connecting}
                className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {connecting ? "Connecting…" : "Connect Questrade"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
