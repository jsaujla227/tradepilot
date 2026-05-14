// Bedrock pricing for Claude Opus — per million tokens.
// Update these constants if AWS changes the rate card.
export const BEDROCK_OPUS_PRICING = {
  input: 15.0,
  output: 75.0,
  cacheRead: 1.5,
  cacheCreation: 18.75,
} as const;

export function calcCost(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): number {
  const p = BEDROCK_OPUS_PRICING;
  return (
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheReadTokens * p.cacheRead +
      cacheCreationTokens * p.cacheCreation) /
    1_000_000
  );
}
