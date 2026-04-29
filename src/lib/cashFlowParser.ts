import Papa from 'papaparse'
import type { CashFlowEntry } from '@/hooks/useCashFlows'

// ── Column aliases (case-insensitive lookup) ──────────────────

const ALIASES: Record<string, string[]> = {
  flow_date:    ['flow_date', 'date', 'value_date', 'cash_date', 'settlement_date', 'payment_date'],
  currency:     ['currency', 'ccy', 'currency_code'],
  amount:       ['amount', 'value', 'cash_amount', 'flow_amount'],
  flow_type:    ['flow_type', 'type', 'direction', 'cash_type'],
  category:     ['category', 'cash_category', 'flow_category'],
  entity:       ['entity', 'legal_entity', 'subsidiary', 'company'],
  account:      ['account', 'bank_account', 'account_ref', 'cost_centre'],
  counterparty: ['counterparty', 'counter_party', 'cp', 'party'],
  description:  ['description', 'notes', 'memo'],
  confidence:   ['confidence', 'certainty', 'forecast_type', 'status'],
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

const VALID_FLOW_TYPES = ['inflow', 'outflow', 'net'] as const

function normalizeFlowType(raw: string, amount: number): 'inflow' | 'outflow' | 'net' {
  const lower = raw.trim().toLowerCase()
  if ((VALID_FLOW_TYPES as readonly string[]).includes(lower)) {
    return lower as 'inflow' | 'outflow' | 'net'
  }
  // Derive from sign
  if (amount >= 0) return 'inflow'
  return 'outflow'
}

const VALID_CONFIDENCE = ['confirmed', 'forecast', 'indicative'] as const

function normalizeConfidence(raw: string): 'confirmed' | 'forecast' | 'indicative' {
  const lower = raw.trim().toLowerCase()
  if ((VALID_CONFIDENCE as readonly string[]).includes(lower)) {
    return lower as 'confirmed' | 'forecast' | 'indicative'
  }
  return 'forecast'
}

/**
 * Parses a date string to YYYY-MM-DD format.
 * Accepts: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY (ambiguous), MM-DD-YYYY
 */
function parseDate(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed + 'T00:00:00')
    if (!isNaN(d.getTime())) return trimmed
  }

  // MM/DD/YYYY or MM-DD-YYYY
  const mdy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (mdy) {
    const [, mm, dd, yyyy] = mdy
    const d = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00`)
    if (!isNaN(d.getTime())) {
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
    }
  }

  // Try native parse as fallback
  const d = new Date(trimmed)
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }

  return null
}

// ── Parser ────────────────────────────────────────────────────

export function parseCashFlowCsv(
  file: File
): Promise<{ data: Omit<CashFlowEntry, 'id' | 'uploaded_at'>[]; errors: string[] }> {
  return new Promise((resolve) => {
    const errors: string[] = []
    const data: Omit<CashFlowEntry, 'id' | 'uploaded_at'>[] = []

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

        const colFlowDate    = findColumn(headers, ALIASES.flow_date)
        const colCurrency    = findColumn(headers, ALIASES.currency)
        const colAmount      = findColumn(headers, ALIASES.amount)
        const colFlowType    = findColumn(headers, ALIASES.flow_type)
        const colCategory    = findColumn(headers, ALIASES.category)
        const colEntity      = findColumn(headers, ALIASES.entity)
        const colAccount     = findColumn(headers, ALIASES.account)
        const colCounterparty = findColumn(headers, ALIASES.counterparty)
        const colDescription = findColumn(headers, ALIASES.description)
        const colConfidence  = findColumn(headers, ALIASES.confidence)

        if (!colFlowDate) {
          errors.push('Missing required column: flow_date (or date, value_date, cash_date, settlement_date, payment_date)')
          resolve({ data, errors })
          return
        }
        if (!colCurrency) {
          errors.push('Missing required column: currency (or ccy, currency_code)')
          resolve({ data, errors })
          return
        }
        if (!colAmount) {
          errors.push('Missing required column: amount (or value, cash_amount, flow_amount)')
          resolve({ data, errors })
          return
        }

        rawData.forEach((row, idx) => {
          const lineNum = idx + 2 // 1-indexed + header row

          // Skip blank rows
          const allEmpty = Object.values(row).every(v => !v || !v.trim())
          if (allEmpty) return

          // Flow date (required)
          const rawFlowDate = (row[colFlowDate!] ?? '').trim()
          if (!rawFlowDate) {
            errors.push(`Row ${lineNum}: Missing flow_date.`)
            return
          }
          const flow_date = parseDate(rawFlowDate)
          if (!flow_date) {
            errors.push(`Row ${lineNum}: Invalid flow_date "${rawFlowDate}" — use YYYY-MM-DD format.`)
            return
          }

          // Currency (required)
          const rawCurrency = (row[colCurrency!] ?? '').trim().toUpperCase()
          if (!rawCurrency) {
            errors.push(`Row ${lineNum}: Missing currency.`)
            return
          }
          if (!isValidCurrency(rawCurrency)) {
            errors.push(`Row ${lineNum}: Invalid currency code "${rawCurrency}" — must be a 3-letter ISO code (e.g. EUR, GBP, USD).`)
            return
          }

          // Amount (required)
          const rawAmount = (row[colAmount!] ?? '').trim().replace(/,/g, '')
          const amount = parseFloat(rawAmount)
          if (isNaN(amount)) {
            errors.push(`Row ${lineNum}: Invalid amount "${rawAmount}" — must be a number.`)
            return
          }

          // Flow type (optional — derive from sign if missing/invalid)
          let flow_type: 'inflow' | 'outflow' | 'net'
          if (colFlowType) {
            const rawType = (row[colFlowType] ?? '').trim()
            flow_type = normalizeFlowType(rawType, amount)
          } else {
            flow_type = amount >= 0 ? 'inflow' : 'outflow'
          }

          // Confidence (optional — default "forecast")
          let confidence: 'confirmed' | 'forecast' | 'indicative' = 'forecast'
          if (colConfidence) {
            const rawConf = (row[colConfidence] ?? '').trim()
            if (rawConf) {
              confidence = normalizeConfidence(rawConf)
            }
          }

          // Optional string fields
          const category     = colCategory     ? (row[colCategory] ?? '').trim()     : ''
          const entity       = colEntity       ? (row[colEntity] ?? '').trim()       : ''
          const account      = colAccount      ? (row[colAccount] ?? '').trim()      : ''
          const counterparty = colCounterparty ? (row[colCounterparty] ?? '').trim() : ''
          const description  = colDescription  ? (row[colDescription] ?? '').trim()  : ''

          data.push({
            flow_date,
            currency: rawCurrency,
            amount,
            flow_type,
            category,
            entity,
            account,
            counterparty,
            description,
            confidence,
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

export function downloadCashFlowTemplate(): void {
  const header = 'flow_date,currency,amount,flow_type,category,entity,account,counterparty,description,confidence'
  const rows = [
    '2026-04-15,USD,500000,inflow,Operations,HQ Corp,USD-MAIN-001,Acme Distributors,Q2 receivable collection,confirmed',
    '2026-04-20,EUR,-250000,outflow,Debt Service,EU Subsidiary,EUR-DEBT-002,Deutsche Bank AG,Quarterly loan repayment,confirmed',
    '2026-05-01,GBP,125000,inflow,FX Settlement,UK Branch,GBP-OPS-003,Barclays PLC,FX forward settlement,forecast',
    '2026-06-30,JPY,-45000000,outflow,Investing,APAC Holdings,JPY-CAP-004,Toyota Financial,Capital equipment purchase,indicative',
  ]
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'cash_flow_template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
