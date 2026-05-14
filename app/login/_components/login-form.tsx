"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "../actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    sendMagicLink,
    initialState,
  );

  if (state.sentTo) {
    return (
      <div className="rounded-xl border border-border bg-card text-card-foreground p-6 space-y-3">
        <h2 className="text-base font-semibold tracking-tight">
          Check your email
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          A magic sign-in link is on its way to{" "}
          <span className="font-mono text-foreground">{state.sentTo}</span>.
          Click it to land in your cockpit.
        </p>
        <p className="text-xs text-muted-foreground">
          Link expires in 1 hour. If it doesn&apos;t arrive, check spam or
          retry below.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="text-xs font-medium text-foreground/90">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="mt-1.5 w-full rounded-md border border-input bg-background/40 px-3 py-2 text-sm font-mono text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/60"
        />
      </label>
      {state.error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
        >
          {state.error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 disabled:opacity-60 disabled:cursor-not-allowed transition"
      >
        {pending ? "Sending…" : "Send magic link"}
      </button>
      <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
        No password. Click the link in your inbox to sign in.
      </p>
    </form>
  );
}
