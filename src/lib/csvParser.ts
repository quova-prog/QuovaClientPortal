import Papa from 'papaparse'
import { normalizeCurrencyPair, parseCurrencyPair } from './utils'
import type { CsvExposureRow, CsvParseResult, ParsedExposure } from '@/types'

// Column name aliases — handles Workday exports and manual spreadsheets
const ENTITY_COLS      = ['entity', 'Entity', 'ENTITY', 'Company', 'Legal Entity', 'BusinessUnit']
const PAIR_COLS        = ['currency_pair', 'Currency Pair', 'CurrencyPair', 'Pair', 'FX Pair', 'CCY Pair']
const DIRECTION_COLS   = ['direction', 'Direction', 'Type', 'Flow Type', 'AR/AP', 'Receivable/Payable']
const NOTIONAL_COLS    = ['notional', 'Notional', 'Amount', 'Notional Amount', 'Transaction Amount', 'Original Amount']
const DATE_COLS        = ['settlement_date', 'Settlement Date', 'SettlementDate', 'Due Date', 'Maturity', 'Value Date']
const DESC_COLS        = ['description', 'Description', 'Reference', 'Invoice', 'PO Number', 'Memo']

function findCol(row: CsvExposureRow, candidates: string[]): string | undefined {
  for (const col of candidates) {
    if (row[col] !== undefined && row[col] !== '') return row[col]
  }
  return undefined
}

function parseDirection(raw: string): 'receivable' | 'payable' | null {
  const v = raw.toLowerCase().trim()
  if (['receivable', 'ar', 'inflow', 'receive', 'receipt', 'asset'].some(k => v.includes(k))) return 'receivable'
  if (['payable', 'ap', 'outflow', 'pay', 'payment', 'liability'].some(k => v.includes(k))) return 'payable'
  return null
}

function parseDate(raw: string): string | null {
  if (!raw) return null
  // Try various date formats
  const cleaned = raw.trim()
  // ISO format already
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned
  // MM/DD/YYYY or M/D/YYYY
  const mdy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`
  // DD/MM/YYYY (European)
  const dmy = cleaned.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  // Try native Date parse
  const d = new Date(cleaned)
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  return null
}

function parseNotional(raw: string): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/[()]/g, '-')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : Math.abs(n)
}

export async function parseWorkdayCsv(file: File): Promise<CsvParseResult> {
  return new Promise((resolve) => {
    Papa.parse<CsvExposureRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const errors: string[] = []
        const warnings: string[] = []
        const rows: ParsedExposure[] = []

        if (results.errors.length > 0) {
          results.errors.slice(0, 3).forEach(e => {
            warnings.push(`CSV parse warning row ${e.row}: ${e.message}`)
          })
        }

        results.data.forEach((rawRow, i) => {
          const rowNum = i + 2 // 1-indexed + header

          const entityRaw    = findCol(rawRow, ENTITY_COLS)
          const pairRaw      = findCol(rawRow, PAIR_COLS)
          const directionRaw = findCol(rawRow, DIRECTION_COLS)
          const notionalRaw  = findCol(rawRow, NOTIONAL_COLS)
          const dateRaw      = findCol(rawRow, DATE_COLS)
          const descRaw      = findCol(rawRow, DESC_COLS)

          // Validate required fields
          if (!entityRaw) { errors.push(`Row ${rowNum}: missing entity/company`); return }
          if (!pairRaw)   { errors.push(`Row ${rowNum}: missing currency pair`); return }
          if (!directionRaw) { errors.push(`Row ${rowNum}: missing direction (receivable/payable)`); return }
          if (!notionalRaw)  { errors.push(`Row ${rowNum}: missing notional amount`); return }
          if (!dateRaw)      { errors.push(`Row ${rowNum}: missing settlement date`); return }

          const pair = parseCurrencyPair(pairRaw)
          if (!pair) { errors.push(`Row ${rowNum}: invalid currency pair "${pairRaw}"`); return }

          const direction = parseDirection(directionRaw)
          if (!direction) { errors.push(`Row ${rowNum}: unrecognised direction "${directionRaw}" — use "receivable" or "payable"`); return }

          const notional = parseNotional(notionalRaw)
          if (!notional || notional <= 0) { errors.push(`Row ${rowNum}: invalid notional "${notionalRaw}"`); return }

          const date = parseDate(dateRaw)
          if (!date) { errors.push(`Row ${rowNum}: invalid date "${dateRaw}"`); return }

          // Warn on past dates
          if (new Date(date) < new Date()) {
            warnings.push(`Row ${rowNum}: settlement date ${date} is in the past`)
          }

          rows.push({
            entity: entityRaw.trim(),
            currency_pair: normalizeCurrencyPair(pairRaw),
            base_currency: pair.base,
            quote_currency: pair.quote,
            direction,
            notional_base: notional,
            settlement_date: date,
            description: descRaw?.trim() ?? '',
          })
        })

        resolve({
          success: errors.length === 0,
          rows,
          errors,
          warnings,
        })
      },
      error: (error) => {
        resolve({
          success: false,
          rows: [],
          errors: [`Failed to read file: ${error.message}`],
          warnings: [],
        })
      },
    })
  })
}

// ── Template download ─────────────────────────────────────

export function downloadCsvTemplate() {
  const headers = [
    'entity', 'currency_pair', 'direction', 'notional',
    'settlement_date', 'description'
  ]
  const example = [
    'Celonis SE', 'EUR/USD', 'receivable', '2500000',
    '2026-06-30', 'Q2 SaaS revenue EUR'
  ]
  const example2 = [
    'Celonis Inc', 'GBP/USD', 'payable', '750000',
    '2026-05-15', 'London office rent'
  ]
  const csv = [headers, example, example2]
    .map(row => row.join(','))
    .join('\n')

  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'quova_exposure_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}
