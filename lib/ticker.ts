import { z } from "zod";

// Canonical ticker validation. Must start with a letter (US-stock convention),
// followed by up to 9 alphanumeric/dot/hyphen chars → max 10 chars total.
// This matches the Finnhub /quote symbol constraint exactly.
export const TICKER_REGEX = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

export const tickerSchema = z
  .string()
  .trim()
  .min(1, "Ticker required")
  .max(10, "Ticker too long")
  .regex(TICKER_REGEX, "Invalid ticker")
  .transform((s) => s.toUpperCase());
