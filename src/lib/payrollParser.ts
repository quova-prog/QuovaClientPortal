import Papa from 'papaparse'
import type { PayrollEntry } from '@/hooks/usePayroll'

// ── Column aliases (case-insensitive lookup) ──────────────────

const ALIASES: Record<string, string[]> = {
  pay_date:       ['pay_date', 'date', 'payment_date', 'payroll_date'],
  currency:       ['currency', 'ccy', 'pay_currency'],
  gross_amount:   ['gross_amount', 'gross', 'total_gross', 'gross_pay'],
  net_amount:     ['net_amount', 'net', 'total_net', 'net_pay'],
  employee_count: ['employee_count', 'employees', 'headcount', 'count'],
  entity:         ['entity', 'legal_entity', 'company', 'subsidiary'],
  department:     ['department', 'dept', 'cost_centre', 'division'],
  pay_period:     ['pay_period', 'period', 'payroll_period'],
  description:    ['description', 'notes', 'memo'],
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
    if (!isNaN(d.getTime())) {
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
    }
  }
  const d = new Date(trimmed)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

// ── Parser ────────────────────────────────────────────────────

export function parsePayrollCsv(
  file: File
): Promise<{ data: Omit<PayrollEntry, 'id' | 'uploaded_at'>[]; errors: string[] }> {
  return new Promise((resolve) => {
    const errors: string[] = []
    const data: Omit<PayrollEntry, 'id' | 'uploaded_at'>[] = []

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

        const colPayDate       = findColumn(headers, ALIASES.pay_date)
        const colCurrency      = findColumn(headers, ALIASES.currency)
        const colGrossAmount   = findColumn(headers, ALIASES.gross_amount)
        const colNetAmount     = findColumn(headers, ALIASES.net_amount)
        const colEmpCount      = findColumn(headers, ALIASES.employee_count)
        const colEntity        = findColumn(headers, ALIASES.entity)
        const colDepartment    = findColumn(headers, ALIASES.department)
        const colPayPeriod     = findColumn(headers, ALIASES.pay_period)
        const colDescription   = findColumn(headers, ALIASES.description)

        if (!colPayDate) {
          errors.push('Missing required column: pay_date (or date, payment_date, payroll_date)')
          resolve({ data, errors }); return
        }
        if (!colCurrency) {
          errors.push('Missing required column: currency (or ccy, pay_currency)')
          resolve({ data, errors }); return
        }
        if (!colGrossAmount) {
          errors.push('Missing required column: gross_amount (or gross, total_gross, gross_pay)')
          resolve({ data, errors }); return
        }

        rawData.forEach((row, idx) => {
          const lineNum = idx + 2

          const allEmpty = Object.values(row).every(v => !v || !v.trim())
          if (allEmpty) return

          const rawDate = (row[colPayDate!] ?? '').trim()
          if (!rawDate) { errors.push(`Row ${lineNum}: Missing pay_date.`); return }
          const pay_date = parseDate(rawDate)
          if (!pay_date) {
            errors.push(`Row ${lineNum}: Invalid pay_date "${rawDate}" — use YYYY-MM-DD format.`)
            return
          }

          const rawCurrency = (row[colCurrency!] ?? '').trim().toUpperCase()
          if (!rawCurrency) { errors.push(`Row ${lineNum}: Missing currency.`); return }
          if (!isValidCurrency(rawCurrency)) {
            errors.push(`Row ${lineNum}: Invalid currency code "${rawCurrency}" — must be a 3-letter ISO code.`)
            return
          }

          const rawGross = (row[colGrossAmount!] ?? '').trim().replace(/,/g, '')
          const gross_amount = parseFloat(rawGross)
          if (isNaN(gross_amount)) {
            errors.push(`Row ${lineNum}: Invalid gross_amount "${rawGross}".`)
            return
          }

          let net_amount = gross_amount
          if (colNetAmount) {
            const rawNet = (row[colNetAmount] ?? '').trim().replace(/,/g, '')
            if (rawNet) {
              const n = parseFloat(rawNet)
              if (!isNaN(n)) net_amount = n
            }
          }

          let employee_count = 0
          if (colEmpCount) {
            const rawCount = (row[colEmpCount] ?? '').trim().replace(/,/g, '')
            if (rawCount) {
              const c = parseInt(rawCount, 10)
              if (!isNaN(c)) employee_count = c
            }
          }

          const entity      = colEntity     ? (row[colEntity] ?? '').trim()      : ''
          const department  = colDepartment ? (row[colDepartment] ?? '').trim()  : ''
          const pay_period  = colPayPeriod  ? (row[colPayPeriod] ?? '').trim()   : ''
          const description = colDescription ? (row[colDescription] ?? '').trim() : ''

          data.push({ pay_date, currency: rawCurrency, gross_amount, net_amount, employee_count, entity, department, pay_period, description })
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

export function downloadPayrollTemplate(): void {
  const header = 'pay_date,currency,gross_amount,net_amount,employee_count,entity,department,pay_period,description'
  const rows = [
    '2025-03-31,USD,2450000,1960000,125,Acme Corp USA,Engineering,2025-Q1,Q1 2025 US payroll run',
    '2025-03-31,EUR,1800000,1350000,98,Acme Corp GmbH,Operations,2025-03,March 2025 — Germany payroll',
    '2025-03-28,GBP,950000,712500,42,Acme Corp Ltd,Sales,Mar 2025,March payroll — UK entity',
    '2025-03-31,CAD,620000,465000,31,Acme Corp Canada,Finance,2025-Q1,Q1 Canadian payroll',
  ]
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'payroll_template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
