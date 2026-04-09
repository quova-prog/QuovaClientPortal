import Papa from 'papaparse'
import type { RevenueForecast } from '@/hooks/useRevenueForecasts'

// ── Column aliases (case-insensitive lookup) ──────────────────

const ALIASES: Record<string, string[]> = {
  currency:    ['currency', 'ccy', 'currency_code'],
  amount:      ['amount', 'revenue', 'forecast_amount', 'revenue_amount', 'value'],
  period:      ['period', 'quarter', 'month', 'reporting_period'],
  fiscal_year: ['fiscal_year', 'year', 'fy', 'fiscal_yr'],
  segment:     ['segment', 'business_segment', 'division'],
  region:      ['region', 'geography', 'geo'],
  description: ['description', 'notes', 'memo', 'comment'],
}

function findColumn(headers: string[], aliases: string[]): string | null {
  const lowerAliases = aliases.map(a => a.toLowerCase())
  for (const header of headers) {
    if (lowerAliases.includes(header.trim().toLowerCase())) return header
  }
  return null
}

function isValidCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code)
}

// ── Parser ────────────────────────────────────────────────────

export function parseRevenueForecastCsv(
  file: File
): Promise<{ data: Omit<RevenueForecast, 'id' | 'uploaded_at'>[]; errors: string[] }> {
  return new Promise((resolve) => {
    const errors: string[] = []
    const data: Omit<RevenueForecast, 'id' | 'uploaded_at'>[] = []

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const rawData = results.data as Record<string, string>[]

        if (rawData.length === 0) {
          errors.push('No data rows found in file.')
          resolve({ data, errors })
          return
        }

        const headers = Object.keys(rawData[0])

        const colCurrency    = findColumn(headers, ALIASES.currency)
        const colAmount      = findColumn(headers, ALIASES.amount)
        const colPeriod      = findColumn(headers, ALIASES.period)
        const colFiscalYear  = findColumn(headers, ALIASES.fiscal_year)
        const colSegment     = findColumn(headers, ALIASES.segment)
        const colRegion      = findColumn(headers, ALIASES.region)
        const colDescription = findColumn(headers, ALIASES.description)

        if (!colCurrency) {
          errors.push('Missing required column: currency (or ccy, currency_code)')
          resolve({ data, errors })
          return
        }
        if (!colAmount) {
          errors.push('Missing required column: amount (or revenue, forecast_amount, revenue_amount, value)')
          resolve({ data, errors })
          return
        }
        if (!colPeriod) {
          errors.push('Missing required column: period (or quarter, month, reporting_period)')
          resolve({ data, errors })
          return
        }
        if (!colFiscalYear) {
          errors.push('Missing required column: fiscal_year (or year, fy, fiscal_yr)')
          resolve({ data, errors })
          return
        }

        rawData.forEach((row, idx) => {
          const lineNum = idx + 2 // 1-indexed + header row

          // Skip blank rows
          const allEmpty = Object.values(row).every(v => !v || !v.trim())
          if (allEmpty) return

          // Currency
          const rawCurrency = (row[colCurrency!] ?? '').trim().toUpperCase()
          if (!rawCurrency) {
            errors.push(`Row ${lineNum}: Missing currency.`)
            return
          }
          if (!isValidCurrency(rawCurrency)) {
            errors.push(`Row ${lineNum}: Invalid currency code "${rawCurrency}" — must be a 3-letter ISO code (e.g. EUR, GBP, USD).`)
            return
          }

          // Amount
          const rawAmount = (row[colAmount!] ?? '').trim().replace(/,/g, '')
          const amount = parseFloat(rawAmount)
          if (isNaN(amount)) {
            errors.push(`Row ${lineNum}: Invalid amount "${rawAmount}" — must be a number.`)
            return
          }

          // Period
          const period = (row[colPeriod!] ?? '').trim()
          if (!period) {
            errors.push(`Row ${lineNum}: Missing period.`)
            return
          }

          // Fiscal year
          const rawYear = (row[colFiscalYear!] ?? '').trim()
          const fiscal_year = parseInt(rawYear, 10)
          if (isNaN(fiscal_year) || fiscal_year < 2000 || fiscal_year > 2100) {
            errors.push(`Row ${lineNum}: Invalid fiscal_year "${rawYear}" — must be a valid 4-digit year.`)
            return
          }

          // Optional fields
          const segment     = colSegment     ? (row[colSegment] ?? '').trim()     : ''
          const region      = colRegion      ? (row[colRegion] ?? '').trim()       : ''
          const description = colDescription ? (row[colDescription] ?? '').trim() : ''

          data.push({
            currency: rawCurrency,
            amount,
            period,
            fiscal_year,
            segment,
            region,
            description,
          })
        })

        resolve({ data, errors })
      },
      error(err) {
        errors.push(`CSV parse error: ${err.message}`)
        resolve({ data, errors })
      },
    })
  })
}

// ── Template download ─────────────────────────────────────────

export function downloadRevenueForecastTemplate(): void {
  const header = 'currency,amount,period,fiscal_year,segment,region,description'
  const rows = [
    'EUR,500000,Q1 2025,2025,Enterprise,EMEA,Q1 European enterprise revenue',
    'GBP,250000,Q2 2025,2025,SMB,UK,UK SMB segment Q2 forecast',
    'JPY,80000000,Q1 2025,2025,Enterprise,APAC,Japan enterprise forecast',
  ]
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'revenue_forecasts_template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
