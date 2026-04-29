import Papa from 'papaparse'
import type { IntercompanyTransfer } from '@/hooks/useIntercompanyTransfers'

const ALIASES: Record<string, string[]> = {
  transfer_date: ['transfer_date', 'date', 'value_date', 'settlement_date'],
  from_entity:   ['from_entity', 'from', 'sender', 'paying_entity', 'source'],
  to_entity:     ['to_entity', 'to', 'receiver', 'receiving_entity', 'destination'],
  currency:      ['currency', 'ccy'],
  amount:        ['amount', 'transfer_amount', 'value'],
  transfer_type: ['transfer_type', 'type', 'category'],
  status:        ['status', 'transfer_status', 'state'],
  reference:     ['reference', 'ref', 'reference_number', 'id'],
  description:   ['description', 'notes', 'memo'],
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

const VALID_TYPES   = ['dividend', 'loan', 'service', 'goods', 'other'] as const
const VALID_STATUSES = ['scheduled', 'completed', 'pending', 'cancelled'] as const

function normalizeType(raw: string): IntercompanyTransfer['transfer_type'] {
  const lower = raw.trim().toLowerCase()
  if ((VALID_TYPES as readonly string[]).includes(lower)) return lower as IntercompanyTransfer['transfer_type']
  return 'other'
}

function normalizeStatus(raw: string): IntercompanyTransfer['status'] {
  const lower = raw.trim().toLowerCase()
  if ((VALID_STATUSES as readonly string[]).includes(lower)) return lower as IntercompanyTransfer['status']
  return 'scheduled'
}

function parseDate(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed + 'T00:00:00')
    if (!isNaN(d.getTime())) return trimmed
  }
  const mdy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (mdy) {
    const [, mm, dd, yyyy] = mdy
    const d = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00`)
    if (!isNaN(d.getTime())) return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  }
  const d = new Date(trimmed)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

export function parseIntercompanyCsv(
  file: File
): Promise<{ data: Omit<IntercompanyTransfer, 'id' | 'uploaded_at'>[]; errors: string[] }> {
  return new Promise((resolve) => {
    const errors: string[] = []
    const data: Omit<IntercompanyTransfer, 'id' | 'uploaded_at'>[] = []

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const rawData = results.data as Record<string, string>[]
        if (rawData.length === 0) { errors.push('No data rows found in file.'); resolve({ data, errors }); return }

        const headers = Object.keys(rawData[0])
        const colDate      = findColumn(headers, ALIASES.transfer_date)
        const colFrom      = findColumn(headers, ALIASES.from_entity)
        const colTo        = findColumn(headers, ALIASES.to_entity)
        const colCurrency  = findColumn(headers, ALIASES.currency)
        const colAmount    = findColumn(headers, ALIASES.amount)
        const colType      = findColumn(headers, ALIASES.transfer_type)
        const colStatus    = findColumn(headers, ALIASES.status)
        const colRef       = findColumn(headers, ALIASES.reference)
        const colDesc      = findColumn(headers, ALIASES.description)

        if (!colDate)     { errors.push('Missing required column: transfer_date (or date, value_date, settlement_date)'); resolve({ data, errors }); return }
        if (!colFrom)     { errors.push('Missing required column: from_entity (or from, sender, paying_entity, source)'); resolve({ data, errors }); return }
        if (!colTo)       { errors.push('Missing required column: to_entity (or to, receiver, receiving_entity, destination)'); resolve({ data, errors }); return }
        if (!colCurrency) { errors.push('Missing required column: currency (or ccy)'); resolve({ data, errors }); return }
        if (!colAmount)   { errors.push('Missing required column: amount (or transfer_amount, value)'); resolve({ data, errors }); return }

        rawData.forEach((row, idx) => {
          const lineNum = idx + 2
          const allEmpty = Object.values(row).every(v => !v || !v.trim())
          if (allEmpty) return

          const rawDate = (row[colDate!] ?? '').trim()
          if (!rawDate) { errors.push(`Row ${lineNum}: Missing transfer_date.`); return }
          const transfer_date = parseDate(rawDate)
          if (!transfer_date) { errors.push(`Row ${lineNum}: Invalid transfer_date "${rawDate}".`); return }

          const from_entity = (row[colFrom!] ?? '').trim()
          if (!from_entity) { errors.push(`Row ${lineNum}: Missing from_entity.`); return }

          const to_entity = (row[colTo!] ?? '').trim()
          if (!to_entity) { errors.push(`Row ${lineNum}: Missing to_entity.`); return }

          const rawCurrency = (row[colCurrency!] ?? '').trim().toUpperCase()
          if (!rawCurrency) { errors.push(`Row ${lineNum}: Missing currency.`); return }
          if (!isValidCurrency(rawCurrency)) { errors.push(`Row ${lineNum}: Invalid currency code "${rawCurrency}".`); return }

          const rawAmt = (row[colAmount!] ?? '').trim().replace(/,/g, '')
          const amount = parseFloat(rawAmt)
          if (isNaN(amount)) { errors.push(`Row ${lineNum}: Invalid amount "${rawAmt}".`); return }

          const transfer_type = colType   ? normalizeType(row[colType] ?? '')     : 'other'
          const status        = colStatus ? normalizeStatus(row[colStatus] ?? '') : 'scheduled'
          const reference     = colRef    ? (row[colRef] ?? '').trim()            : ''
          const description   = colDesc   ? (row[colDesc] ?? '').trim()           : ''

          data.push({ transfer_date, from_entity, to_entity, currency: rawCurrency, amount, transfer_type, status, reference, description })
        })

        resolve({ data, errors })
      },
      error(err) { errors.push(`CSV parse error: ${err.message}`); resolve({ data, errors }) },
    })
  })
}

export function downloadIntercompanyTemplate(): void {
  const header = 'transfer_date,from_entity,to_entity,currency,amount,transfer_type,status,reference,description'
  const rows = [
    '2025-07-01,Acme Corp USA,Acme Corp GmbH,USD,5000000,dividend,scheduled,ICT-2025-001,Q2 dividend upstream to parent',
    '2025-08-15,Acme Corp Ltd,Acme Corp USA,GBP,1200000,loan,pending,ICT-2025-002,Interco loan repayment — UK to US',
    '2025-09-01,Acme Corp GmbH,Acme Corp Asia,EUR,850000,service,completed,ICT-2025-003,Management fee Q3 — Germany to Asia',
    '2025-10-01,Acme Corp Asia,Acme Corp Ltd,USD,320000,goods,scheduled,ICT-2025-004,Inventory transfer — Asia to UK',
  ]
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'intercompany_transfers_template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
