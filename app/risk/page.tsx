import { PositionSizeCalculator } from "./_components/position-size";
import { RMultipleCalculator } from "./_components/r-multiple";
import { LossScenariosCalculator } from "./_components/loss-scenarios";
import { ConcentrationCalculator } from "./_components/concentration";

export const metadata = {
  title: "Risk · TradePilot",
  description:
    "Position sizing, R-multiple, loss scenarios, and concentration math — with the math shown.",
};

export default function RiskPage() {
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
          Four pure-math calculators for sizing trades, framing reward against
          risk, and stress-testing positions. Every result has a{" "}
          <span className="font-mono text-foreground/80">Why?</span> reveal
          showing exactly how the number was computed — no black boxes.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <PositionSizeCalculator />
        <RMultipleCalculator />
        <LossScenariosCalculator />
        <ConcentrationCalculator />
      </div>
    </div>
  );
}
