// Frankfurter API client — https://api.frankfurter.dev/v1
// No API key required; data sourced from ECB

export const MAJOR_CURRENCIES = [
  'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'SEK',
  'NOK', 'DKK', 'NZD', 'HKD', 'SGD', 'INR', 'KRW', 'MXN', 'BRL', 'ZAR',
]

export interface FrankfurterResponse {
  amount: number
  base: string
  date: string
  rates: Record<string, number>
}

// Returns flat rates object plus rateDate
export interface FetchedRates {
  pairs: Record<string, number>
  rateDate: string
}

/**
 * Fetch latest rates from Frankfurter.
 * Returns { pairs: { 'EUR/USD': 1.0850, ... }, rateDate: '2026-03-27' }
 */
export async function fetchLatestRates(
  extraCurrencies: string[] = [],
): Promise<FetchedRates> {
  const [usdRes, eurRes] = await Promise.all([
    fetch('https://api.frankfurter.dev/v1/latest?from=USD'),
    fetch('https://api.frankfurter.dev/v1/latest?from=EUR'),
  ])

  if (!usdRes.ok) throw new Error(`Failed to fetch rates: ${usdRes.status}`)
  if (!eurRes.ok) throw new Error(`Failed to fetch rates: ${eurRes.status}`)

  const usdData: FrankfurterResponse = await usdRes.json()
  const eurData: FrankfurterResponse = await eurRes.json()

  const usdRates = usdData.rates   // e.g. { EUR: 0.92, JPY: 149.5, ... }
  const eurRates = eurData.rates   // e.g. { GBP: 0.857, JPY: 163.2, ... }

  const result: Record<string, number> = {}

  // Pairs quoted as {CCY}/USD (how many USD per 1 foreign unit)
  if (usdRates.EUR) result['EUR/USD'] = 1 / usdRates.EUR
  if (usdRates.GBP) result['GBP/USD'] = 1 / usdRates.GBP
  if (usdRates.AUD) result['AUD/USD'] = 1 / usdRates.AUD
  if (usdRates.NZD) result['NZD/USD'] = 1 / usdRates.NZD

  // Pairs quoted as USD/{CCY} (how many foreign units per 1 USD)
  if (usdRates.JPY) result['USD/JPY'] = usdRates.JPY
  if (usdRates.CAD) result['USD/CAD'] = usdRates.CAD
  if (usdRates.CHF) result['USD/CHF'] = usdRates.CHF
  if (usdRates.CNY) result['USD/CNY'] = usdRates.CNY
  if (usdRates.SEK) result['USD/SEK'] = usdRates.SEK
  if (usdRates.NOK) result['USD/NOK'] = usdRates.NOK
  if (usdRates.HKD) result['USD/HKD'] = usdRates.HKD
  if (usdRates.SGD) result['USD/SGD'] = usdRates.SGD
  if (usdRates.MXN) result['USD/MXN'] = usdRates.MXN
  if (usdRates.KRW) result['USD/KRW'] = usdRates.KRW
  if (usdRates.INR) result['USD/INR'] = usdRates.INR
  if (usdRates.BRL) result['USD/BRL'] = usdRates.BRL
  if (usdRates.ZAR) result['USD/ZAR'] = usdRates.ZAR
  if (usdRates.TRY) result['USD/TRY'] = usdRates.TRY
  if (usdRates.IDR) result['USD/IDR'] = usdRates.IDR
  if (usdRates.PHP) result['USD/PHP'] = usdRates.PHP
  if (usdRates.THB) result['USD/THB'] = usdRates.THB
  if (usdRates.MYR) result['USD/MYR'] = usdRates.MYR

  // EUR cross rates from EUR base
  if (eurRates.GBP) result['EUR/GBP'] = eurRates.GBP
  if (eurRates.JPY) result['EUR/JPY'] = eurRates.JPY
  if (eurRates.CHF) result['EUR/CHF'] = eurRates.CHF

  // Derived cross rates
  if (usdRates.GBP && usdRates.JPY) result['GBP/JPY'] = (1 / usdRates.GBP) * usdRates.JPY
  if (usdRates.EUR && usdRates.CAD)  result['EUR/CAD'] = (1 / usdRates.EUR) * usdRates.CAD
  if (usdRates.GBP && usdRates.CAD)  result['GBP/CAD'] = (1 / usdRates.GBP) * usdRates.CAD
  if (usdRates.EUR && usdRates.AUD)  result['EUR/AUD'] = (1 / usdRates.EUR) * usdRates.AUD

  // Extra currencies as USD/{CCY}
  for (const ccy of extraCurrencies) {
    const key = `USD/${ccy}`
    if (!(key in result) && usdRates[ccy] !== undefined) {
      result[key] = usdRates[ccy]
    }
  }

  return { pairs: result, rateDate: usdData.date }
}

/**
 * Fetch rates for a specific date (YYYY-MM-DD).
 * Used to get yesterday's rates for daily change calculation.
 */
export async function fetchRatesForDate(date: string): Promise<FetchedRates> {
  const [usdRes, eurRes] = await Promise.all([
    fetch(`https://api.frankfurter.dev/v1/${date}?from=USD`),
    fetch(`https://api.frankfurter.dev/v1/${date}?from=EUR`),
  ])
  if (!usdRes.ok || !eurRes.ok) throw new Error(`Failed to fetch rates for ${date}`)
  const usdData: FrankfurterResponse = await usdRes.json()
  const eurData: FrankfurterResponse = await eurRes.json()
  const usdRates = usdData.rates
  const eurRates = eurData.rates
  const result: Record<string, number> = {}
  if (usdRates.EUR) result['EUR/USD'] = 1 / usdRates.EUR
  if (usdRates.GBP) result['GBP/USD'] = 1 / usdRates.GBP
  if (usdRates.AUD) result['AUD/USD'] = 1 / usdRates.AUD
  if (usdRates.NZD) result['NZD/USD'] = 1 / usdRates.NZD
  if (usdRates.JPY) result['USD/JPY'] = usdRates.JPY
  if (usdRates.CAD) result['USD/CAD'] = usdRates.CAD
  if (usdRates.CHF) result['USD/CHF'] = usdRates.CHF
  if (usdRates.SEK) result['USD/SEK'] = usdRates.SEK
  if (eurRates.GBP) result['EUR/GBP'] = eurRates.GBP
  if (eurRates.JPY) result['EUR/JPY'] = eurRates.JPY
  if (usdRates.GBP && usdRates.JPY) result['GBP/JPY'] = (1 / usdRates.GBP) * usdRates.JPY
  if (usdRates.EUR && usdRates.CAD)  result['EUR/CAD'] = (1 / usdRates.EUR) * usdRates.CAD
  if (usdRates.GBP && usdRates.CAD)  result['GBP/CAD'] = (1 / usdRates.GBP) * usdRates.CAD
  return { pairs: result, rateDate: usdData.date }
}

// ── Historical Timeseries ──────────────────────────────────

/** One month's worth of FX rate data, keyed by canonical pair (e.g. EUR/USD). */
export interface MonthlySnapshot {
  date: string                    // YYYY-MM-DD — first business day of the month
  rates: Record<string, number>   // pair → rate
}

/**
 * Fetch a 2-year daily timeseries from Frankfurter and reduce it to
 * one data point per calendar month (the first available trading day).
 *
 * Single request — the Frankfurter timeseries endpoint returns all dates
 * in the range as a { rates: { "YYYY-MM-DD": { CCY: rate } } } structure.
 */
export async function fetchHistoricalTimeseries(
  startDate: string,   // 'YYYY-MM-DD'
  endDate: string,
): Promise<MonthlySnapshot[]> {
  const res = await fetch(
    `https://api.frankfurter.dev/v1/${startDate}..${endDate}?from=USD&to=EUR,GBP,CAD,JPY,AUD,CHF`,
  )
  if (!res.ok) throw new Error(`Frankfurter timeseries error: ${res.status}`)

  const data = await res.json() as {
    rates: Record<string, Record<string, number>>
  }

  // Extract first trading day of each month
  const monthsSeen = new Set<string>()
  const snapshots: MonthlySnapshot[] = []

  for (const [dateStr, rawRates] of Object.entries(data.rates).sort()) {
    const monthKey = dateStr.slice(0, 7)
    if (monthsSeen.has(monthKey)) continue
    monthsSeen.add(monthKey)

    const r = rawRates as Record<string, number>
    const pairs: Record<string, number> = {}

    // Direct USD-base pairs
    if (r.CAD) pairs['USD/CAD'] = r.CAD
    if (r.JPY) pairs['USD/JPY'] = r.JPY
    if (r.CHF) pairs['USD/CHF'] = r.CHF

    // Pairs quoted as {CCY}/USD
    if (r.EUR) pairs['EUR/USD'] = 1 / r.EUR
    if (r.GBP) pairs['GBP/USD'] = 1 / r.GBP
    if (r.AUD) pairs['AUD/USD'] = 1 / r.AUD

    // Derived cross rates
    if (r.EUR && r.CAD) pairs['EUR/CAD'] = (1 / r.EUR) * r.CAD
    if (r.GBP && r.CAD) pairs['GBP/CAD'] = (1 / r.GBP) * r.CAD
    if (r.EUR && r.JPY) pairs['EUR/JPY'] = (1 / r.EUR) * r.JPY
    if (r.GBP && r.JPY) pairs['GBP/JPY'] = (1 / r.GBP) * r.JPY

    snapshots.push({ date: dateStr, rates: pairs })
  }

  return snapshots
}

/** JPY pairs show 2 decimal places, all others show 4. */
export function getRateDecimalPlaces(pair: string): number {
  return pair.includes('JPY') || pair.includes('KRW') ? 2 : 4
}

/** Format a rate for display based on pair convention. */
export function formatRate(pair: string, rate: number): string {
  return rate.toFixed(getRateDecimalPlaces(pair))
}
