import Papa from 'papaparse'
import type { SupplierContract } from '@/hooks/useSupplierContracts'

const ALIASES: Record<string, string[]> = {
  supplier_name:     ['supplier_name', 'supplier', 'vendor', 'vendor_name', 'counterparty'],
  currency:          ['currency', 'ccy', 'contract_currency'],
  contract_value:    ['contract_value', 'value', 'total_value', 'contract_amount'],
  start_date:        ['start_date', 'commencement_date', 'effective_date', 'from'],
  end_date:          ['end_date', 'expiry_date', 'expiration', 'to', 'termination_date'],
  payment_frequency: ['payment_frequency', 'frequency', 'billing_frequency', 'payment_schedule'],
  next_payment_date: ['next_payment_date', 'next_payment', 'next_due', 'next_billing'],
  payment_amount:    ['payment_amount', 'amount', 'periodic_amount', 'instalment'],
  category:          ['category', 'contract_type', 'service_type', 'supplier_category'],
  status:            ['status', 'contract_status', 'active'],
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

function normalizeFrequency(raw: string): SupplierContract['payment_frequency'] {
  const lower = raw.trim().toLowerCase()
  if ((VALID_FREQUENCIES as readonly string[]).includes(lower)) return lower as SupplierContract['payment_frequency']
  if (lower === 'yearly' || lower === 'annually') return 'annual'
  if (lower === 'one time' || lower === 'onetime' || lower === 'once') return 'one-time'
  return 'monthly'
}

function normalizeStatus(raw: string): SupplierContract['status'] {
  const lower = raw.trim().toLowerCase()
  if ((VALID_STATUSES as readonly string[]).includes(lower)) return lower as SupplierContract['status']
  if (lower === 'true' || lower === '1' || lower === 'yes') return 'active'
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

export function parseSupplierContractCsv(
  file: File
): Promise<{ data: Omit<SupplierContract, 'id' | 'uploaded_at'>[]; errors: string[] }> {
  return new Promise((resolve) => {
    const errors: string[] = []
    const data: Omit<SupplierContract, 'id' | 'uploaded_at'>[] = []

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const rawData = results.data as Record<string, string>[]
        if (rawData.length === 0) { errors.push('No data rows found in file.'); resolve({ data, errors }); return }

        const headers = Object.keys(rawData[0])
        const colSupplier   = findColumn(headers, ALIASES.supplier_name)
        const colCurrency   = findColumn(headers, ALIASES.currency)
        const colValue      = findColumn(headers, ALIASES.contract_value)
        const colStartDate  = findColumn(headers, ALIASES.start_date)
        const colEndDate    = findColumn(headers, ALIASES.end_date)
        const colFreq       = findColumn(headers, ALIASES.payment_frequency)
        const colNextPay    = findColumn(headers, ALIASES.next_payment_date)
        const colPayAmt     = findColumn(headers, ALIASES.payment_amount)
        const colCategory   = findColumn(headers, ALIASES.category)
        const colStatus     = findColumn(headers, ALIASES.status)
        const colDesc       = findColumn(headers, ALIASES.description)

        if (!colSupplier)  { errors.push('Missing required column: supplier_name (or supplier, vendor, vendor_name)'); resolve({ data, errors }); return }
        if (!colCurrency)  { errors.push('Missing required column: currency (or ccy)'); resolve({ data, errors }); return }
        if (!colValue)     { errors.push('Missing required column: contract_value (or value, total_value)'); resolve({ data, errors }); return }
        if (!colEndDate)   { errors.push('Missing required column: end_date (or expiry_date, expiration, to)'); resolve({ data, errors }); return }

        rawData.forEach((row, idx) => {
          const lineNum = idx + 2
          const allEmpty = Object.values(row).every(v => !v || !v.trim())
          if (allEmpty) return

          const supplier_name = (row[colSupplier!] ?? '').trim()
          if (!supplier_name) { errors.push(`Row ${lineNum}: Missing supplier_name.`); return }

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
          if (colStartDate) {
            const raw = (row[colStartDate] ?? '').trim()
            if (raw) { const d = parseDate(raw); if (d) start_date = d }
          }

          let next_payment_date = ''
          if (colNextPay) {
            const raw = (row[colNextPay] ?? '').trim()
            if (raw) { const d = parseDate(raw); if (d) next_payment_date = d }
          }

          let payment_amount = 0
          if (colPayAmt) {
            const raw = (row[colPayAmt] ?? '').trim().replace(/,/g, '')
            if (raw) { const a = parseFloat(raw); if (!isNaN(a)) payment_amount = a }
          }

          const payment_frequency = colFreq     ? normalizeFrequency(row[colFreq] ?? '')  : 'monthly'
          const category          = colCategory  ? (row[colCategory] ?? '').trim()         : ''
          const status            = colStatus    ? normalizeStatus(row[colStatus] ?? '')    : 'active'
          const description       = colDesc      ? (row[colDesc] ?? '').trim()             : ''

          data.push({ supplier_name, currency: rawCurrency, contract_value, start_date, end_date, payment_frequency, next_payment_date, payment_amount, category, status, description })
        })

        resolve({ data, errors })
      },
      error(err) { errors.push(`CSV parse error: ${err.message}`); resolve({ data, errors }) },
    })
  })
}

export function downloadSupplierContractTemplate(): void {
  const header = 'supplier_name,currency,contract_value,start_date,end_date,payment_frequency,next_payment_date,payment_amount,category,status,description'
  const rows = [
    'AWS Inc,USD,240000,2025-01-01,2025-12-31,monthly,2025-08-01,20000,Cloud Services,active,Annual cloud infrastructure contract',
    'Siemens AG,EUR,1800000,2024-07-01,2027-06-30,quarterly,2025-09-30,150000,Manufacturing Equipment,active,Multi-year equipment maintenance agreement',
    'Clifford Chance LLP,GBP,450000,2025-04-01,2026-03-31,monthly,2025-08-31,37500,Legal Services,active,Retained legal counsel — UK operations',
    'Accenture Canada,CAD,320000,2025-01-01,2025-06-30,one-time,2025-06-30,320000,Consulting,pending,ERP implementation project — one-time fee',
  ]
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'supplier_contracts_template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
