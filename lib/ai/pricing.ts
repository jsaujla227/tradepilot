// Bedrock pricing per million tokens. Update these constants if AWS changes
// the rate card.

type Pricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

export const BEDROCK_OPUS_PRICING: Pricing = {
  input: 15.0,
  output: 75.0,
  cacheRead: 1.5,
  cacheCreation: 18.75,
};

export const BEDROCK_SONNET_PRICING: Pricing = {
  input: 3.0,
  output: 15.0,
  cacheRead: 0.3,
  cacheCreation: 3.75,
};

function calcWith(
  pricing: Pricing,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): number {
  return (
    (inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheReadTokens * pricing.cacheRead +
      cacheCreationTokens * pricing.cacheCreation) /
    1_000_000
  );
}

export function calcCost(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): number {
  return calcWith(
    BEDROCK_OPUS_PRICING,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  );
}

export function calcSonnetCost(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): number {
  return calcWith(
    BEDROCK_SONNET_PRICING,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  );
}
