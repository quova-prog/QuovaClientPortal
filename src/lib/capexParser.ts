import Papa from 'papaparse'
import type { CapexEntry } from '@/hooks/useCapex'

const ALIASES: Record<string, string[]> = {
  project_name:     ['project_name', 'project', 'name', 'description', 'capex_name'],
  currency:         ['currency', 'ccy'],
  budget_amount:    ['budget_amount', 'budget', 'planned_amount', 'capex_budget'],
  committed_amount: ['committed_amount', 'committed', 'actual_amount', 'approved_amount'],
  payment_date:     ['payment_date', 'date', 'expected_date', 'payment_due'],
  category:         ['category', 'capex_category', 'asset_type', 'type'],
  entity:           ['entity', 'legal_entity', 'subsidiary', 'company'],
  status:           ['status', 'approval_status', 'project_status'],
  description:      ['description', 'notes', 'memo'],
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

const VALID_CATEGORIES = ['equipment', 'property', 'technology', 'infrastructure', 'other'] as const
const VALID_STATUSES   = ['planned', 'approved', 'committed', 'completed'] as const

function normalizeCategory(raw: string): CapexEntry['category'] {
  const lower = raw.trim().toLowerCase()
  if ((VALID_CATEGORIES as readonly string[]).includes(lower)) return lower as CapexEntry['category']
  return 'other'
}

function normalizeStatus(raw: string): CapexEntry['status'] {
  const lower = raw.trim().toLowerCase()
  if ((VALID_STATUSES as readonly string[]).includes(lower)) return lower as CapexEntry['status']
  return 'planned'
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

export function parseCapexCsv(
  file: File
): Promise<{ data: Omit<CapexEntry, 'id' | 'uploaded_at'>[]; errors: string[] }> {
  return new Promise((resolve) => {
    const errors: string[] = []
    const data: Omit<CapexEntry, 'id' | 'uploaded_at'>[] = []

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const rawData = results.data as Record<string, string>[]
        if (rawData.length === 0) { errors.push('No data rows found in file.'); resolve({ data, errors }); return }

        const headers = Object.keys(rawData[0])
        const colProject    = findColumn(headers, ALIASES.project_name)
        const colCurrency   = findColumn(headers, ALIASES.currency)
        const colBudget     = findColumn(headers, ALIASES.budget_amount)
        const colCommitted  = findColumn(headers, ALIASES.committed_amount)
        const colDate       = findColumn(headers, ALIASES.payment_date)
        const colCategory   = findColumn(headers, ALIASES.category)
        const colEntity     = findColumn(headers, ALIASES.entity)
        const colStatus     = findColumn(headers, ALIASES.status)
        const colDesc       = findColumn(headers, ALIASES.description)

        if (!colProject)  { errors.push('Missing required column: project_name (or project, name, capex_name)'); resolve({ data, errors }); return }
        if (!colCurrency) { errors.push('Missing required column: currency (or ccy)'); resolve({ data, errors }); return }
        if (!colBudget)   { errors.push('Missing required column: budget_amount (or budget, planned_amount, capex_budget)'); resolve({ data, errors }); return }
        if (!colDate)     { errors.push('Missing required column: payment_date (or date, expected_date, payment_due)'); resolve({ data, errors }); return }

        rawData.forEach((row, idx) => {
          const lineNum = idx + 2
          const allEmpty = Object.values(row).every(v => !v || !v.trim())
          if (allEmpty) return

          const project_name = (row[colProject!] ?? '').trim()
          if (!project_name) { errors.push(`Row ${lineNum}: Missing project_name.`); return }

          const rawCurrency = (row[colCurrency!] ?? '').trim().toUpperCase()
          if (!rawCurrency) { errors.push(`Row ${lineNum}: Missing currency.`); return }
          if (!isValidCurrency(rawCurrency)) { errors.push(`Row ${lineNum}: Invalid currency code "${rawCurrency}".`); return }

          const rawBudget = (row[colBudget!] ?? '').trim().replace(/,/g, '')
          const budget_amount = parseFloat(rawBudget)
          if (isNaN(budget_amount)) { errors.push(`Row ${lineNum}: Invalid budget_amount "${rawBudget}".`); return }

          const rawDate = (row[colDate!] ?? '').trim()
          if (!rawDate) { errors.push(`Row ${lineNum}: Missing payment_date.`); return }
          const payment_date = parseDate(rawDate)
          if (!payment_date) { errors.push(`Row ${lineNum}: Invalid payment_date "${rawDate}".`); return }

          let committed_amount = 0
          if (colCommitted) {
            const rawC = (row[colCommitted] ?? '').trim().replace(/,/g, '')
            if (rawC) { const c = parseFloat(rawC); if (!isNaN(c)) committed_amount = c }
          }

          const category    = colCategory ? normalizeCategory(row[colCategory] ?? '') : 'other'
          const entity      = colEntity   ? (row[colEntity] ?? '').trim()             : ''
          const status      = colStatus   ? normalizeStatus(row[colStatus] ?? '')     : 'planned'
          const description = colDesc     ? (row[colDesc] ?? '').trim()               : ''

          data.push({ project_name, currency: rawCurrency, budget_amount, committed_amount, payment_date, category, entity, status, description })
        })

        resolve({ data, errors })
      },
      error(err) { errors.push(`CSV parse error: ${err.message}`); resolve({ data, errors }) },
    })
  })
}

export function downloadCapexTemplate(): void {
  const header = 'project_name,currency,budget_amount,committed_amount,payment_date,category,entity,status,description'
  const rows = [
    'CNC Machining Centre Upgrade,USD,850000,720000,2025-09-30,equipment,Manufacturing Corp,committed,High-precision machining equipment replacement',
    'Distribution Centre Expansion,EUR,4500000,1200000,2026-06-30,property,Logistics GmbH,approved,New 30000sqm distribution facility — Munich',
    'ERP System Implementation,GBP,1250000,0,2025-12-31,technology,Acme Corp Ltd,planned,Full SAP S/4HANA rollout — UK entity',
    'Data Centre Power Upgrade,CAD,620000,620000,2025-08-15,infrastructure,Acme Corp Canada,completed,UPS and cooling system upgrade — Toronto DC',
  ]
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'capex_template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
