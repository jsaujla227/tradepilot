export default function LandingPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-border bg-card text-card-foreground p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div
            aria-hidden
            className="h-2.5 w-2.5 rounded-full bg-foreground/80"
          />
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Private
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-2">
          TradePilot
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          A trading cockpit for one. Paper trades, risk discipline, and an AI
          helper that shows its work.
        </p>
        <div className="mt-6 pt-6 border-t border-border">
          <p className="text-xs text-muted-foreground font-mono">
            Build in progress. Sign-in lands in M3.
          </p>
        </div>
      </div>
    </div>
  );
}
