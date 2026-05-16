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

// -- portfolioHeat --------------------------------------------------------

export type HeatPositionInput = {
  ticker: string;
  /** Absolute share count of the open position. */
  shares: number;
  /** Average entry price. */
  entry: number;
  /** Planned stop. null when no stop is on file for the position. */
  stop: number | null;
  /** Live price; the open-risk basis. Falls back to entry when omitted. */
  price?: number;
  /** Position direction. When omitted it is inferred from stop vs entry —
   *  pass it explicitly for open positions whose stop may sit in profit. */
  direction?: Direction;
};

export type HeatPositionRisk = {
  ticker: string;
  hasStop: boolean;
  /** Dollars at risk from the open-risk basis down to the stop; null when
   *  no stop is on file. Never negative — a stop in profit reads as 0. */
  riskAmount: number | null;
  /** riskAmount as a percent of account size; null when no stop on file. */
  riskPct: number | null;
  direction: Direction | null;
};

export type PortfolioHeatInput = {
  positions: HeatPositionInput[];
  accountSize: number;
  /** Ceiling for total open risk as a percent of account size. */
  maxHeatPct: number;
};

export type PortfolioHeatOutput = {
  positions: HeatPositionRisk[];
  /** Sum of quantified per-position risk in dollars. */
  totalRisk: number;
  totalRiskPct: number;
  /** Dollar ceiling: accountSize * maxHeatPct / 100. */
  maxHeat: number;
  /** Dollars of heat room left before the ceiling; 0 once breached. */
  remaining: number;
  breached: boolean;
  /** Count of positions with no stop on file — risk not quantified. */
  unquantifiedCount: number;
};

/**
 * Aggregate "portfolio heat": the total open R-at-risk across every open
 * position, measured from each position's open-risk basis (live price, or
 * entry when no price is supplied) down to its stop. Positions with no stop
 * on file are reported as unquantified rather than silently counted as zero.
 */
export function portfolioHeat(input: PortfolioHeatInput): PortfolioHeatOutput {
  assertPositive(input.accountSize, "account size");
  assertPositive(input.maxHeatPct, "max heat %");
  if (input.maxHeatPct >= 100) {
    throw new RiskError("max heat % must be less than 100", "invalid-input");
  }

  let totalRisk = 0;
  let unquantifiedCount = 0;

  const positions: HeatPositionRisk[] = input.positions.map((pos) => {
    assertNonNegative(pos.shares, "shares");
    assertPositive(pos.entry, "entry");
    if (pos.price !== undefined) assertPositive(pos.price, "price");

    if (pos.stop === null) {
      unquantifiedCount += 1;
      return {
        ticker: pos.ticker,
        hasStop: false,
        riskAmount: null,
        riskPct: null,
        direction: null,
      };
    }

    assertPositive(pos.stop, "stop");
    if (pos.stop === pos.entry) {
      throw new RiskError("stop must differ from entry", "entry-equals-stop");
    }

    const direction: Direction =
      pos.direction ?? (pos.stop < pos.entry ? "long" : "short");
    const basis = pos.price ?? pos.entry;
    const perShareRisk =
      direction === "long" ? basis - pos.stop : pos.stop - basis;
    const riskAmount = Math.max(0, perShareRisk * pos.shares);
    totalRisk += riskAmount;

    return {
      ticker: pos.ticker,
      hasStop: true,
      riskAmount,
      riskPct: (riskAmount / input.accountSize) * 100,
      direction,
    };
  });

  const maxHeat = (input.accountSize * input.maxHeatPct) / 100;
  const totalRiskPct = (totalRisk / input.accountSize) * 100;
  const remaining = Math.max(0, maxHeat - totalRisk);
  const breached = totalRisk >= maxHeat;

  return {
    positions,
    totalRisk,
    totalRiskPct,
    maxHeat,
    remaining,
    breached,
    unquantifiedCount,
  };
}

// -- volatilityTargetSize -------------------------------------------------

export type VolatilityTargetSizeInput = {
  entry: number;
  /** Average True Range in price units (e.g. ATR-14). */
  atr: number;
  accountSize: number;
  /** Max risk per trade as a percent of account size. */
  maxRiskPct: number;
  /** Stop distance expressed in ATRs (e.g. 2 = a 2×ATR stop). */
  atrMultiplier: number;
  direction: Direction;
};

export type VolatilityTargetSizeOutput = {
  shares: number;
  /** ATR-derived stop price. */
  stop: number;
  /** Stop distance in price units = atrMultiplier × atr. */
  perShareRisk: number;
  /** Stop distance as a percent of entry. */
  stopDistancePct: number;
  riskAmount: number;
  capitalRequired: number;
  pctOfAccount: number;
};

/**
 * Volatility-targeted position sizing. Derives the stop from the stock's own
 * ATR (entry ∓ atrMultiplier × atr) rather than a guessed level, then sizes
 * the position so dollars-at-risk stay fixed at maxRiskPct. A more volatile
 * stock gets a wider stop and fewer shares; a quiet one gets a tighter stop
 * and more shares — the dollar risk is constant, the share count adapts.
 */
export function volatilityTargetSize(
  input: VolatilityTargetSizeInput,
): VolatilityTargetSizeOutput {
  assertPositive(input.entry, "entry");
  assertPositive(input.atr, "ATR");
  assertPositive(input.accountSize, "account size");
  assertPositive(input.maxRiskPct, "max risk %");
  assertPositive(input.atrMultiplier, "ATR multiplier");
  if (input.maxRiskPct >= 100) {
    throw new RiskError("max risk % must be less than 100", "invalid-input");
  }

  const perShareRisk = input.atrMultiplier * input.atr;
  const stop =
    input.direction === "long"
      ? input.entry - perShareRisk
      : input.entry + perShareRisk;
  if (stop <= 0) {
    throw new RiskError(
      "ATR stop falls at or below zero — multiplier is too wide for this price",
      "stop-below-zero",
    );
  }

  const riskAmount = (input.accountSize * input.maxRiskPct) / 100;
  const shares = Math.floor(riskAmount / perShareRisk);
  const capitalRequired = shares * input.entry;
  const pctOfAccount = (capitalRequired / input.accountSize) * 100;
  const stopDistancePct = (perShareRisk / input.entry) * 100;

  return {
    shares,
    stop,
    perShareRisk,
    stopDistancePct,
    riskAmount,
    capitalRequired,
    pctOfAccount,
  };
}

// -- atrTrailingStop ------------------------------------------------------

export type AtrTrailingStopInput = {
  entry: number;
  direction: Direction;
  /** Current ATR in price units (e.g. ATR-14). */
  atr: number;
  /** Trailing distance expressed in ATRs (e.g. 3). */
  atrMultiplier: number;
  /** Highest price reached since entry for a long; lowest for a short. */
  extreme: number;
  /** Initial stop set at entry — the 1R reference. */
  initialStop: number;
  /** Stop currently on file; the trailing stop never loosens past it.
   *  Defaults to initialStop. */
  currentStop?: number;
};

export type AtrTrailingStopOutput = {
  /** Suggested stop after applying the ratchet rule. */
  trailingStop: number;
  /** Raw ATR-derived (chandelier) stop before ratcheting. */
  rawStop: number;
  /** True when the trailing stop advances past the current stop. */
  hasRatcheted: boolean;
  /** True once the trailing stop reaches/passes entry — initial risk removed. */
  riskFree: boolean;
  /** R locked in by the trailing stop. Negative while still below entry. */
  lockedInR: number;
};

/**
 * ATR trailing stop (chandelier-exit style). The raw stop trails the extreme
 * price reached since entry by atrMultiplier × ATR. A ratchet rule then keeps
 * the suggested stop from ever loosening past the stop already on file — for
 * a long it only moves up. lockedInR reports how much of the initial 1R risk
 * the trailing stop has converted into protected profit.
 */
export function atrTrailingStop(
  input: AtrTrailingStopInput,
): AtrTrailingStopOutput {
  assertPositive(input.entry, "entry");
  assertPositive(input.atr, "ATR");
  assertPositive(input.atrMultiplier, "ATR multiplier");
  assertPositive(input.extreme, "extreme price");
  assertPositive(input.initialStop, "initial stop");
  if (input.currentStop !== undefined) {
    assertPositive(input.currentStop, "current stop");
  }
  if (input.entry === input.initialStop) {
    throw new RiskError("initial stop must differ from entry", "entry-equals-stop");
  }

  const longTrade = input.direction === "long";
  if (longTrade && input.initialStop >= input.entry) {
    throw new RiskError(
      "a long's initial stop must sit below entry",
      "stop-wrong-side",
    );
  }
  if (!longTrade && input.initialStop <= input.entry) {
    throw new RiskError(
      "a short's initial stop must sit above entry",
      "stop-wrong-side",
    );
  }

  const oneR = Math.abs(input.entry - input.initialStop);
  const floor = input.currentStop ?? input.initialStop;
  const offset = input.atrMultiplier * input.atr;

  const rawStop = longTrade
    ? input.extreme - offset
    : input.extreme + offset;
  const trailingStop = longTrade
    ? Math.max(rawStop, floor)
    : Math.min(rawStop, floor);
  const hasRatcheted = longTrade
    ? trailingStop > floor
    : trailingStop < floor;
  const riskFree = longTrade
    ? trailingStop >= input.entry
    : trailingStop <= input.entry;
  const lockedInR = longTrade
    ? (trailingStop - input.entry) / oneR
    : (input.entry - trailingStop) / oneR;

  return { trailingStop, rawStop, hasRatcheted, riskFree, lockedInR };
}
