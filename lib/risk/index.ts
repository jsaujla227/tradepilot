// Pure risk-management math. No side effects, no I/O.
// Every function throws RiskError on invalid input so the caller can render
// a useful message; UI wraps calls in try/catch.

export type Direction = "long" | "short";

export class RiskError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "RiskError";
    this.code = code;
  }
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RiskError(`${name} must be a positive number`, "invalid-input");
  }
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RiskError(`${name} must be zero or positive`, "invalid-input");
  }
}

// -- positionSize ---------------------------------------------------------

export type PositionSizeInput = {
  entry: number;
  stop: number;
  accountSize: number;
  maxRiskPct: number;
};

export type PositionSizeOutput = {
  shares: number;
  riskAmount: number;
  perShareRisk: number;
  capitalRequired: number;
  pctOfAccount: number;
  direction: Direction;
};

export function positionSize(input: PositionSizeInput): PositionSizeOutput {
  assertPositive(input.entry, "entry");
  assertPositive(input.stop, "stop");
  assertPositive(input.accountSize, "account size");
  assertPositive(input.maxRiskPct, "max risk %");
  if (input.entry === input.stop) {
    throw new RiskError("stop must differ from entry", "entry-equals-stop");
  }
  if (input.maxRiskPct >= 100) {
    throw new RiskError("max risk % must be less than 100", "invalid-input");
  }

  const direction: Direction = input.stop < input.entry ? "long" : "short";
  const perShareRisk = Math.abs(input.entry - input.stop);
  const riskAmount = (input.accountSize * input.maxRiskPct) / 100;
  const shares = Math.floor(riskAmount / perShareRisk);
  const capitalRequired = shares * input.entry;
  const pctOfAccount = (capitalRequired / input.accountSize) * 100;

  return {
    shares,
    riskAmount,
    perShareRisk,
    capitalRequired,
    pctOfAccount,
    direction,
  };
}

// -- rMultiple ------------------------------------------------------------

export type RMultipleInput = {
  entry: number;
  stop: number;
  target: number;
  exit?: number;
};

export type RMultipleOutput = {
  direction: Direction;
  r: number; // dollars of risk per share (1R)
  plannedR: number;
  actualR: number | null;
};

export function rMultiple(input: RMultipleInput): RMultipleOutput {
  assertPositive(input.entry, "entry");
  assertPositive(input.stop, "stop");
  assertPositive(input.target, "target");
  if (input.entry === input.stop) {
    throw new RiskError("stop must differ from entry", "entry-equals-stop");
  }
  if (input.exit !== undefined) assertPositive(input.exit, "exit");

  const direction: Direction = input.stop < input.entry ? "long" : "short";
  const r = Math.abs(input.entry - input.stop);
  const plannedR =
    direction === "long"
      ? (input.target - input.entry) / r
      : (input.entry - input.target) / r;
  const actualR =
    input.exit === undefined
      ? null
      : direction === "long"
        ? (input.exit - input.entry) / r
        : (input.entry - input.exit) / r;

  return { direction, r, plannedR, actualR };
}

// -- lossScenarios --------------------------------------------------------

export type LossScenariosInput = {
  shares: number;
  entry: number;
  /** Each percent should be ≤ 0 (e.g. -1, -3, -10). Defaults to [-1,-3,-5,-10,-20]. */
  dropPcts?: number[];
};

export type LossScenario = {
  dropPct: number;
  priceAtDrop: number;
  loss: number;
};

export type LossScenariosOutput = {
  scenarios: LossScenario[];
  positionValue: number;
};

const DEFAULT_DROPS: readonly number[] = [-1, -3, -5, -10, -20];

export function lossScenarios(
  input: LossScenariosInput,
): LossScenariosOutput {
  assertNonNegative(input.shares, "shares");
  assertPositive(input.entry, "entry");
  const drops = input.dropPcts ?? [...DEFAULT_DROPS];
  for (const d of drops) {
    if (!Number.isFinite(d) || d > 0) {
      throw new RiskError(
        `drop percentages must be ≤ 0 (got ${d})`,
        "invalid-input",
      );
    }
  }

  const positionValue = input.shares * input.entry;
  const scenarios = drops.map((dropPct) => {
    const priceAtDrop = input.entry * (1 + dropPct / 100);
    const loss = input.shares * (input.entry - priceAtDrop);
    return { dropPct, priceAtDrop, loss };
  });

  return { scenarios, positionValue };
}

// -- concentrationLabel ---------------------------------------------------

export type ConcentrationInput = {
  positionValue: number;
  portfolioValue: number;
};

export type ConcentrationSeverity = "low" | "moderate" | "high" | "critical";

export type ConcentrationOutput = {
  pct: number;
  label: string;
  severity: ConcentrationSeverity;
};

export function concentrationLabel(
  input: ConcentrationInput,
): ConcentrationOutput {
  assertNonNegative(input.positionValue, "position value");
  assertPositive(input.portfolioValue, "portfolio value");
  if (input.positionValue > input.portfolioValue) {
    throw new RiskError(
      "position value cannot exceed portfolio value",
      "invalid-input",
    );
  }

  const pct = (input.positionValue / input.portfolioValue) * 100;
  let label: string;
  let severity: ConcentrationSeverity;
  if (pct < 10) {
    label = "diversified";
    severity = "low";
  } else if (pct < 25) {
    label = "concentrated";
    severity = "moderate";
  } else if (pct < 50) {
    label = "high concentration";
    severity = "high";
  } else {
    label = "single-name risk";
    severity = "critical";
  }

  return { pct, label, severity };
}

// -- dailyLossBreached ----------------------------------------------------

export type DailyLossInput = {
  accountSize: number;
  dailyLossLimitPct: number;
  /** Realized P/L for today; negative = loss. */
  realizedToday: number;
  /** Mark-to-market on open positions; negative = unrealized loss. */
  openPnL: number;
};

export type DailyLossOutput = {
  totalToday: number;
  limit: number;
  breached: boolean;
  /** Dollars of loss room left before the breaker trips; 0 once breached. */
  remaining: number;
};

export function dailyLossBreached(input: DailyLossInput): DailyLossOutput {
  assertPositive(input.accountSize, "account size");
  assertPositive(input.dailyLossLimitPct, "daily loss limit %");
  if (input.dailyLossLimitPct >= 100) {
    throw new RiskError(
      "daily loss limit % must be less than 100",
      "invalid-input",
    );
  }
  if (!Number.isFinite(input.realizedToday)) {
    throw new RiskError("realizedToday must be a number", "invalid-input");
  }
  if (!Number.isFinite(input.openPnL)) {
    throw new RiskError("openPnL must be a number", "invalid-input");
  }

  const totalToday = input.realizedToday + input.openPnL;
  const limit = (input.accountSize * input.dailyLossLimitPct) / 100;
  const lossSoFar = totalToday < 0 ? Math.abs(totalToday) : 0;
  const breached = lossSoFar >= limit;
  const remaining = Math.max(0, limit - lossSoFar);

  return { totalToday, limit, breached, remaining };
}
