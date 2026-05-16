import { getUserAndProfile } from "@/lib/profile";
import { DEFAULT_PROFILE } from "@/lib/profile";
import { getUserTickers } from "@/lib/user-tickers";
import { PositionSizeCalculator } from "./_components/position-size";
import { VolatilitySizeCalculator } from "./_components/volatility-size";
import { RMultipleCalculator } from "./_components/r-multiple";
import { LossScenariosCalculator } from "./_components/loss-scenarios";
import { ConcentrationCalculator } from "./_components/concentration";

export const metadata = {
  title: "Risk · TradePilot",
  description:
    "Position sizing, volatility-targeted sizing, R-multiple, loss scenarios, and concentration math — with the math shown.",
};

export default async function RiskPage() {
  const session = await getUserAndProfile();
  const defaults = session?.profile ?? DEFAULT_PROFILE;
  const signedIn = !!session;
  const tickers = signedIn ? await getUserTickers() : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:py-14">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <div aria-hidden className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
          <span>My risk</span>
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Risk calculators
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground leading-relaxed">
          Five pure-math calculators for sizing trades, framing reward against
          risk, and stress-testing positions. Every result has a{" "}
          <span className="font-mono text-foreground/80">Why?</span> reveal
          showing exactly how the number was computed — no black boxes.
        </p>
        {signedIn ? (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Auto-filled with your saved account size and max-risk-per-trade.{" "}
            <a
              href="/settings"
              className="underline-offset-2 hover:underline text-foreground/80"
            >
              Change in settings
            </a>
            . Pick a ticker to auto-populate the entry price from a live quote.
          </p>
        ) : (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Using public defaults.{" "}
            <a
              href="/login?next=/risk"
              className="underline-offset-2 hover:underline text-foreground/80"
            >
              Sign in
            </a>{" "}
            to auto-fill from your profile.
          </p>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <PositionSizeCalculator
          defaultAccountSize={defaults.account_size_initial}
          defaultMaxRiskPct={defaults.max_risk_per_trade_pct}
          tickers={tickers}
        />
        <VolatilitySizeCalculator
          defaultAccountSize={defaults.account_size_initial}
          defaultMaxRiskPct={defaults.max_risk_per_trade_pct}
          tickers={tickers}
        />
        <RMultipleCalculator tickers={tickers} />
        <LossScenariosCalculator tickers={tickers} />
        <ConcentrationCalculator
          defaultPortfolioValue={defaults.account_size_initial}
        />
      </div>
    </div>
  );
}
