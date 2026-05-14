// Top 100 S&P 500 constituents by approximate market cap (as of 2025).
// Static list — update manually if composition changes significantly.
// The scanner cron scans these daily; the full 500 is impractical on
// Finnhub's free tier (60 calls/min) within a single Vercel function call.

export const SP500_TOP100: readonly string[] = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "TSLA", "BRK.B",
  "AVGO", "JPM", "LLY", "V", "UNH", "XOM", "MA", "COST", "HD", "PG", "WMT",
  "JNJ", "ORCL", "BAC", "ABBV", "MRK", "CVX", "KO", "NFLX", "CRM", "AMD",
  "TMO", "ACN", "PEP", "LIN", "MCD", "ADBE", "WFC", "PM", "IBM", "CSCO",
  "TXN", "ABT", "DHR", "GE", "INTU", "ISRG", "CAT", "AMGN", "RTX", "VZ",
  "SPGI", "BKNG", "PFE", "NOW", "QCOM", "GS", "BLK", "T", "LOW", "SYK",
  "AMAT", "UNP", "AXP", "NEE", "HON", "DE", "ELV", "UBER", "BA", "TJX",
  "ETN", "PGR", "MS", "MDT", "VRTX", "ADI", "CB", "GILD", "LRCX", "REGN",
  "BSX", "MMC", "C", "ADP", "PANW", "SCHW", "SO", "AMT", "ZTS", "MU",
  "SNPS", "CI", "DUK", "BDX", "EOG", "SHW", "CME", "CDNS", "ITW", "NOC",
] as const;
