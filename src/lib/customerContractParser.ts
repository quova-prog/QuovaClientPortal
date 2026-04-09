import Papa from 'papaparse'
import type { CustomerContract } from '@/hooks/useCustomerContracts'

const ALIASES: Record<string, string[]> = {
  customer_name:     ['customer_name', 'customer', 'client', 'client_name', 'account'],
  currency:          ['currency', 'ccy', 'contract_currency'],
  contract_value:    ['contract_value', 'value', 'arr', 'tcv', 'contract_amount'],
  start_date:        ['start_date', 'commencement_date', 'effective_date', 'from'],
  end_date:          ['end_date', 'expiry_date', 'renewal_date', 'to'],
  payment_frequency: ['payment_frequency', 'frequency', 'billing_frequency'],
  next_payment_date: ['next_payment_date', 'next_payment', 'next_billing', 'next_invoice'],
  payment_amount:    ['payment_amount', 'amount', 'mrr', 'periodic_amount'],
  segment:           ['segment', 'customer_segment', 'tier', 'account_type'],
  region:            ['region', 'geography', 'market', 'country'],
  status:            ['status', 'contract_status'],
  description:       ['description', 'notes', 'memo'],
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

const VALID_FREQUENCIES = ['monthly', 'quarterly', 'annual', 'one-time'] as const
const VALID_STATUSES    = ['active', 'expired', 'pending'] as const

function normalizeFrequency(raw: string): CustomerContract['payment_frequency'] {
  const lower = raw.trim().toLowerCase()
  if ((VALID_FREQUENCIES as readonly string[]).includes(lower)) return lower as CustomerContract['payment_frequency']
  if (lower === 'yearly' || lower === 'annually') return 'annual'
  if (lower === 'one time' || lower === 'onetime' || lower === 'once') return 'one-time'
  return 'monthly'
}

function normalizeStatus(raw: string): CustomerContract['status'] {
  const lower = raw.trim().toLowerCase()
  if ((VALID_STATUSES as readonly string[]).includes(lower)) return lower as CustomerContract['status']
  return 'active'
}

function parseDate(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed + 'T00:00:00')
    if (!isNaN(d.getTime())) return trimmed
  }
  const mdy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (mdy) {
    const [, mm, dd, yyyy] = mdy
    const d = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00`)
    if (!isNaN(d.getTime())) return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  }
  const d = new Date(trimmed)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

export function parseCustomerContractCsv(
  file: File
): Promise<{ data: Omit<CustomerContract, 'id' | 'uploaded_at'>[]; errors: string[] }> {
  return new Promise((resolve) => {
    const errors: string[] = []
    const data: Omit<CustomerContract, 'id' | 'uploaded_at'>[] = []

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const rawData = results.data as Record<string, string>[]
        if (rawData.length === 0) { errors.push('No data rows found in file.'); resolve({ data, errors }); return }

        const headers = Object.keys(rawData[0])
        const colCustomer  = findColumn(headers, ALIASES.customer_name)
        const colCurrency  = findColumn(headers, ALIASES.currency)
        const colValue     = findColumn(headers, ALIASES.contract_value)
        const colStartDate = findColumn(headers, ALIASES.start_date)
        const colEndDate   = findColumn(headers, ALIASES.end_date)
        const colFreq      = findColumn(headers, ALIASES.payment_frequency)
        const colNextPay   = findColumn(headers, ALIASES.next_payment_date)
        const colPayAmt    = findColumn(headers, ALIASES.payment_amount)
        const colSegment   = findColumn(headers, ALIASES.segment)
        const colRegion    = findColumn(headers, ALIASES.region)
        const colStatus    = findColumn(headers, ALIASES.status)
        const colDesc      = findColumn(headers, ALIASES.description)

        if (!colCustomer) { errors.push('Missing required column: customer_name (or customer, client, client_name, account)'); resolve({ data, errors }); return }
        if (!colCurrency) { errors.push('Missing required column: currency (or ccy)'); resolve({ data, errors }); return }
        if (!colValue)    { errors.push('Missing required column: contract_value (or value, arr, tcv)'); resolve({ data, errors }); return }
        if (!colEndDate)  { errors.push('Missing required column: end_date (or expiry_date, renewal_date)'); resolve({ data, errors }); return }

        rawData.forEach((row, idx) => {
          const lineNum = idx + 2
          const allEmpty = Object.values(row).every(v => !v || !v.trim())
          if (allEmpty) return

          const customer_name = (row[colCustomer!] ?? '').trim()
          if (!customer_name) { errors.push(`Row ${lineNum}: Missing customer_name.`); return }

          const rawCurrency = (row[colCurrency!] ?? '').trim().toUpperCase()
          if (!rawCurrency) { errors.push(`Row ${lineNum}: Missing currency.`); return }
          if (!isValidCurrency(rawCurrency)) { errors.push(`Row ${lineNum}: Invalid currency code "${rawCurrency}".`); return }

          const rawValue = (row[colValue!] ?? '').trim().replace(/,/g, '')
          const contract_value = parseFloat(rawValue)
          if (isNaN(contract_value)) { errors.push(`Row ${lineNum}: Invalid contract_value "${rawValue}".`); return }

          const rawEnd = (row[colEndDate!] ?? '').trim()
          if (!rawEnd) { errors.push(`Row ${lineNum}: Missing end_date.`); return }
          const end_date = parseDate(rawEnd)
          if (!end_date) { errors.push(`Row ${lineNum}: Invalid end_date "${rawEnd}".`); return }

          let start_date = ''
          if (colStartDate) { const raw = (row[colStartDate] ?? '').trim(); if (raw) { const d = parseDate(raw); if (d) start_date = d } }

          let next_payment_date = ''
          if (colNextPay) { const raw = (row[colNextPay] ?? '').trim(); if (raw) { const d = parseDate(raw); if (d) next_payment_date = d } }

          let payment_amount = 0
          if (colPayAmt) { const raw = (row[colPayAmt] ?? '').trim().replace(/,/g, ''); if (raw) { const a = parseFloat(raw); if (!isNaN(a)) payment_amount = a } }

          const payment_frequency = colFreq    ? normalizeFrequency(row[colFreq] ?? '')  : 'monthly'
          const segment           = colSegment ? (row[colSegment] ?? '').trim()          : ''
          const region            = colRegion  ? (row[colRegion] ?? '').trim()           : ''
          const status            = colStatus  ? normalizeStatus(row[colStatus] ?? '')   : 'active'
          const description       = colDesc    ? (row[colDesc] ?? '').trim()             : ''

          data.push({ customer_name, currency: rawCurrency, contract_value, start_date, end_date, payment_frequency, next_payment_date, payment_amount, segment, region, status, description })
        })

        resolve({ data, errors })
      },
      error(err) { errors.push(`CSV parse error: ${err.message}`); resolve({ data, errors }) },
    })
  })
}

export function downloadCustomerContractTemplate(): void {
  const header = 'customer_name,currency,contract_value,start_date,end_date,payment_frequency,next_payment_date,payment_amount,segment,region,status,description'
  const rows = [
    'Globex Corp,USD,480000,2025-01-01,2025-12-31,monthly,2025-08-01,40000,Enterprise,North America,active,Annual enterprise SaaS subscription',
    'Initech GmbH,EUR,360000,2024-07-01,2026-06-30,quarterly,2025-09-30,30000,Mid-Market,EMEA,active,3-year platform contract — Germany',
    'Umbrella Ltd,GBP,120000,2025-04-01,2026-03-31,monthly,2025-08-31,10000,SMB,UK,active,SMB recurring subscription — annual renewal',
    'Vandelay Industries,USD,250000,2025-06-01,2025-11-30,one-time,2025-11-30,250000,Enterprise,North America,pending,Professional services engagement',
  ]
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'customer_contracts_template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
