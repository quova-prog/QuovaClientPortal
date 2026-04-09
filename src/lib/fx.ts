/**
 * Shared FX utilities — single source of truth for fallback rates and
 * currency-to-USD conversion. Import from here; do NOT define local copies.
 *
 * Keep FALLBACK_FX in sync with advisorEngine.ts (or better: migrate
 * advisorEngine to import from here).
 */

/** Approximate USD value of 1 unit of each currency — used when live rates
 *  are unavailable. Values are intentionally conservative estimates. */
export const FALLBACK_FX: Record<string, number> = {
  // Major pairs
  EUR: 1.09, GBP: 1.27, JPY: 0.0067, CAD: 0.73,
  AUD: 0.65, CHF: 1.11, CNY: 0.14,  USD: 1.0,
  NZD: 0.60, SEK: 0.091, NOK: 0.089, DKK: 0.14,
  HKD: 0.128, SGD: 0.74,
  // Emerging markets
  KRW: 0.00074, INR: 0.012,  BRL: 0.19,  ZAR: 0.054,
  TRY: 0.028,  IDR: 0.000063, PHP: 0.017, THB: 0.027,
  MYR: 0.21,   MXN: 0.056,
}

/**
 * Convert an amount in `currency` to USD using the provided live rates map.
 * Falls back to FALLBACK_FX, then to 1.0 as a last resort.
 *
 * @param amount       - Amount in the foreign currency
 * @param currency     - ISO 4217 currency code (e.g. 'EUR', 'JPY')
 * @param fxRates      - Live rates map; keys like 'EUR/USD' or 'USD/JPY'
 */
export function toUsd(
  amount: number,
  currency: string,
  fxRates: Record<string, number>,
): number {
  const ccy = currency.toUpperCase()
  if (ccy === 'USD') return amount

  // Direct {CCY}/USD key (e.g. EUR/USD, GBP/USD)
  const direct = fxRates[`${ccy}/USD`] ?? fxRates[`${ccy}USD`]
  if (direct) return amount * direct

  // Inverse USD/{CCY} key (e.g. USD/JPY → JPY/USD = 1/rate)
  const inverse = fxRates[`USD/${ccy}`] ?? fxRates[`USD${ccy}`]
  if (inverse && inverse > 0) return amount / inverse

  // Fallback table
  return amount * (FALLBACK_FX[ccy] ?? 1.0)
}
