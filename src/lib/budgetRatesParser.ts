import Papa from 'papaparse'

export interface ParsedBudgetRate {
  currency_pair: string   // normalized to 'USD/CAD' format
  budget_rate: number
  fiscal_year: number
  period: string          // 'Annual' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | month name
  notional_budget: number
  description: string
}

export interface BudgetRateParseResult {
  rows: ParsedBudgetRate[]
  errors: string[]
  warnings: string[]
}

// Column aliases
const ALIASES: Record<string, string[]> = {
  currency_pair:   ['currency_pair', 'Currency Pair', 'CurrencyPair', 'Pair', 'CCY', 'FX Pair'],
  budget_rate:     ['budget_rate', 'Budget Rate', 'BudgetRate', 'Rate', 'FX Rate', 'Budgeted Rate'],
  fiscal_year:     ['fiscal_year', 'Fiscal Year', 'FY', 'Year'],
  period:          ['period', 'Period', 'Quarter', 'Month'],
  notional_budget: ['notional_budget', 'Notional', 'Budget Amount', 'Amount', 'Notional Budget'],
  description:     ['description', 'Description', 'Notes', 'Memo', 'Comment'],
}

function findColumn(headers: string[], aliases: string[]): string | null {
  for (const alias of aliases) {
    const found = headers.find(h => h.trim() === alias)
    if (found) return found
  }
  return null
}

function normalizeCurrencyPair(raw: string): string {
  const stripped = raw.replace(/[^A-Za-z]/g, '').toUpperCase()
  if (stripped.length === 6) {
    return `${stripped.slice(0, 3)}/${stripped.slice(3, 6)}`
  }
  // If it already had a separator, it's already normalized
  return raw.toUpperCase().trim()
}

function isValidCurrencyPair(pair: string): boolean {
  return /^[A-Z]{3}\/[A-Z]{3}$/.test(pair)
}

const VALID_PERIODS = new Set([
  'Annual', 'Q1', 'Q2', 'Q3', 'Q4',
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
])

function normalizePeriod(raw: string): string {
  const trimmed = raw.trim()
  // Check exact match first
  if (VALID_PERIODS.has(trimmed)) return trimmed
  // Case-insensitive match
  const lower = trimmed.toLowerCase()
  for (const p of VALID_PERIODS) {
    if (p.toLowerCase() === lower) return p
  }
  return trimmed || 'Annual'
}

export function parseBudgetRatesCsv(file: File): Promise<BudgetRateParseResult> {
  return new Promise((resolve) => {
    const currentYear = new Date().getFullYear()
    const errors: string[] = []
    const warnings: string[] = []
    const rows: ParsedBudgetRate[] = []

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const rawData = results.data as Record<string, string>[]
        if (rawData.length === 0) {
          errors.push('No data rows found in file.')
          resolve({ rows, errors, warnings })
          return
        }

        const headers = Object.keys(rawData[0])

        const colPair        = findColumn(headers, ALIASES.currency_pair)
        const colRate        = findColumn(headers, ALIASES.budget_rate)
        const colYear        = findColumn(headers, ALIASES.fiscal_year)
        const colPeriod      = findColumn(headers, ALIASES.period)
        const colNotional    = findColumn(headers, ALIASES.notional_budget)
        const colDescription = findColumn(headers, ALIASES.description)

        if (!colPair) {
          errors.push('Missing required column: currency_pair (or Currency Pair, Pair, CCY, FX Pair)')
          resolve({ rows, errors, warnings })
          return
        }
        if (!colRate) {
          errors.push('Missing required column: budget_rate (or Budget Rate, Rate, FX Rate, Budgeted Rate)')
          resolve({ rows, errors, warnings })
          return
        }

        if (!colYear) warnings.push('No fiscal_year column found — defaulting to current year.')
        if (!colPeriod) warnings.push('No period column found — defaulting to "Annual".')

        rawData.forEach((row, idx) => {
          const lineNum = idx + 2 // 1-indexed + header row

          // Skip blank lines
          const allEmpty = Object.values(row).every(v => !v || !v.trim())
          if (allEmpty) return

          // Currency pair
          const rawPair = colPair ? (row[colPair] ?? '').trim() : ''
          if (!rawPair) {
            errors.push(`Row ${lineNum}: Missing currency_pair.`)
            return
          }
          const pair = normalizeCurrencyPair(rawPair)
          if (!isValidCurrencyPair(pair)) {
            errors.push(`Row ${lineNum}: Invalid currency pair "${rawPair}" (expected format: USD/CAD).`)
            return
          }

          // Budget rate
          const rawRate = colRate ? (row[colRate] ?? '').trim() : ''
          const rate = parseFloat(rawRate)
          if (isNaN(rate) || rate <= 0) {
            errors.push(`Row ${lineNum}: Invalid budget_rate "${rawRate}" — must be a positive number.`)
            return
          }

          // Fiscal year
          let fiscalYear = currentYear
          if (colYear) {
            const rawYear = (row[colYear] ?? '').trim()
            if (rawYear) {
              const parsed = parseInt(rawYear, 10)
              if (isNaN(parsed) || parsed < 2020 || parsed > 2030) {
                warnings.push(`Row ${lineNum}: Fiscal year "${rawYear}" is outside expected range 2020-2030 — skipping row.`)
                return
              }
              fiscalYear = parsed
            }
          }

          // Period
          let period = 'Annual'
          if (colPeriod) {
            const rawPeriod = (row[colPeriod] ?? '').trim()
            period = rawPeriod ? normalizePeriod(rawPeriod) : 'Annual'
          }

          // Notional budget
          let notional = 0
          if (colNotional) {
            const rawNotional = (row[colNotional] ?? '').trim().replace(/,/g, '')
            if (rawNotional) {
              const parsed = parseFloat(rawNotional)
              if (!isNaN(parsed)) notional = parsed
            }
          }

          // Description
          const description = colDescription ? (row[colDescription] ?? '').trim() : ''

          rows.push({
            currency_pair: pair,
            budget_rate: rate,
            fiscal_year: fiscalYear,
            period,
            notional_budget: notional,
            description,
          })
        })

        resolve({ rows, errors, warnings })
      },
      error(err) {
        errors.push(`CSV parse error: ${err.message}`)
        resolve({ rows, errors, warnings })
      },
    })
  })
}

export function downloadBudgetRateTemplate(): void {
  const header = 'currency_pair,budget_rate,fiscal_year,period,notional_budget,description'
  const rows = [
    'USD/CAD,1.3200,2025,Annual,12000000,Full year USD receivables',
    'EUR/CAD,1.4850,2025,Q2,3500000,Q2 EU sales proceeds',
    'GBP/CAD,1.7100,2025,Annual,5500000,UK office operating costs',
  ]
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'budget_rates_template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
