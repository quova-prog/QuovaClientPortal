import Papa from 'papaparse'
import type { LoanSchedule } from '@/hooks/useLoanSchedules'

// ── Column aliases (case-insensitive lookup) ──────────────────

const ALIASES: Record<string, string[]> = {
  loan_id:             ['loan_id', 'id', 'loan_number', 'reference'],
  lender:              ['lender', 'bank', 'creditor', 'institution'],
  currency:            ['currency', 'ccy'],
  principal:           ['principal', 'original_principal', 'principal_amount', 'face_value'],
  outstanding_balance: ['outstanding_balance', 'balance', 'outstanding', 'remaining_balance'],
  interest_rate:       ['interest_rate', 'rate', 'coupon_rate', 'coupon'],
  payment_date:        ['payment_date', 'next_payment', 'due_date', 'next_due'],
  maturity_date:       ['maturity_date', 'maturity', 'end_date', 'expiry'],
  payment_type:        ['payment_type', 'type', 'payment_category'],
  payment_amount:      ['payment_amount', 'amount', 'instalment', 'installment'],
  loan_type:           ['loan_type', 'facility_type', 'instrument_type'],
  description:         ['description', 'notes', 'memo'],
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

const VALID_PAYMENT_TYPES = ['principal', 'interest', 'both'] as const
const VALID_LOAN_TYPES = ['term', 'revolver', 'bond', 'other'] as const

function normalizePaymentType(raw: string): LoanSchedule['payment_type'] {
  const lower = raw.trim().toLowerCase()
  if ((VALID_PAYMENT_TYPES as readonly string[]).includes(lower)) {
    return lower as LoanSchedule['payment_type']
  }
  return 'both'
}

function normalizeLoanType(raw: string): LoanSchedule['loan_type'] {
  const lower = raw.trim().toLowerCase()
  if ((VALID_LOAN_TYPES as readonly string[]).includes(lower)) {
    return lower as LoanSchedule['loan_type']
  }
  return 'other'
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

export function parseLoanScheduleCsv(
  file: File
): Promise<{ data: Omit<LoanSchedule, 'id' | 'uploaded_at'>[]; errors: string[] }> {
  return new Promise((resolve) => {
    const errors: string[] = []
    const data: Omit<LoanSchedule, 'id' | 'uploaded_at'>[] = []

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

        const colLoanId            = findColumn(headers, ALIASES.loan_id)
        const colLender            = findColumn(headers, ALIASES.lender)
        const colCurrency          = findColumn(headers, ALIASES.currency)
        const colPrincipal         = findColumn(headers, ALIASES.principal)
        const colOutstandingBalance = findColumn(headers, ALIASES.outstanding_balance)
        const colInterestRate      = findColumn(headers, ALIASES.interest_rate)
        const colPaymentDate       = findColumn(headers, ALIASES.payment_date)
        const colMaturityDate      = findColumn(headers, ALIASES.maturity_date)
        const colPaymentType       = findColumn(headers, ALIASES.payment_type)
        const colPaymentAmount     = findColumn(headers, ALIASES.payment_amount)
        const colLoanType          = findColumn(headers, ALIASES.loan_type)
        const colDescription       = findColumn(headers, ALIASES.description)

        if (!colLoanId) {
          errors.push('Missing required column: loan_id (or id, loan_number, reference)')
          resolve({ data, errors })
          return
        }
        if (!colLender) {
          errors.push('Missing required column: lender (or bank, creditor, institution)')
          resolve({ data, errors })
          return
        }
        if (!colCurrency) {
          errors.push('Missing required column: currency (or ccy)')
          resolve({ data, errors })
          return
        }
        if (!colOutstandingBalance) {
          errors.push('Missing required column: outstanding_balance (or balance, outstanding, remaining_balance)')
          resolve({ data, errors })
          return
        }
        if (!colPaymentDate) {
          errors.push('Missing required column: payment_date (or next_payment, due_date, next_due)')
          resolve({ data, errors })
          return
        }
        if (!colMaturityDate) {
          errors.push('Missing required column: maturity_date (or maturity, end_date, expiry)')
          resolve({ data, errors })
          return
        }

        rawData.forEach((row, idx) => {
          const lineNum = idx + 2

          const allEmpty = Object.values(row).every(v => !v || !v.trim())
          if (allEmpty) return

          const loan_id = (row[colLoanId!] ?? '').trim()
          if (!loan_id) { errors.push(`Row ${lineNum}: Missing loan_id.`); return }

          const lender = (row[colLender!] ?? '').trim()
          if (!lender) { errors.push(`Row ${lineNum}: Missing lender.`); return }

          const rawCurrency = (row[colCurrency!] ?? '').trim().toUpperCase()
          if (!rawCurrency) { errors.push(`Row ${lineNum}: Missing currency.`); return }
          if (!isValidCurrency(rawCurrency)) {
            errors.push(`Row ${lineNum}: Invalid currency code "${rawCurrency}" — must be a 3-letter ISO code.`)
            return
          }

          const rawBalance = (row[colOutstandingBalance!] ?? '').trim().replace(/,/g, '')
          const outstanding_balance = parseFloat(rawBalance)
          if (isNaN(outstanding_balance)) {
            errors.push(`Row ${lineNum}: Invalid outstanding_balance "${rawBalance}".`)
            return
          }

          const rawPaymentDate = (row[colPaymentDate!] ?? '').trim()
          if (!rawPaymentDate) { errors.push(`Row ${lineNum}: Missing payment_date.`); return }
          const payment_date = parseDate(rawPaymentDate)
          if (!payment_date) {
            errors.push(`Row ${lineNum}: Invalid payment_date "${rawPaymentDate}" — use YYYY-MM-DD format.`)
            return
          }

          const rawMaturityDate = (row[colMaturityDate!] ?? '').trim()
          if (!rawMaturityDate) { errors.push(`Row ${lineNum}: Missing maturity_date.`); return }
          const maturity_date = parseDate(rawMaturityDate)
          if (!maturity_date) {
            errors.push(`Row ${lineNum}: Invalid maturity_date "${rawMaturityDate}" — use YYYY-MM-DD format.`)
            return
          }

          let principal = 0
          if (colPrincipal) {
            const rawPrincipal = (row[colPrincipal] ?? '').trim().replace(/,/g, '')
            if (rawPrincipal) {
              const p = parseFloat(rawPrincipal)
              if (!isNaN(p)) principal = p
            }
          }

          let interest_rate = 0
          if (colInterestRate) {
            const rawRate = (row[colInterestRate] ?? '').trim().replace(/,/g, '').replace(/%/g, '')
            if (rawRate) {
              const r = parseFloat(rawRate)
              if (!isNaN(r)) interest_rate = r
            }
          }

          let payment_amount = 0
          if (colPaymentAmount) {
            const rawAmt = (row[colPaymentAmount] ?? '').trim().replace(/,/g, '')
            if (rawAmt) {
              const a = parseFloat(rawAmt)
              if (!isNaN(a)) payment_amount = a
            }
          }

          const payment_type = colPaymentType ? normalizePaymentType(row[colPaymentType] ?? '') : 'both'
          const loan_type    = colLoanType    ? normalizeLoanType(row[colLoanType] ?? '')       : 'other'
          const description  = colDescription ? (row[colDescription] ?? '').trim()              : ''

          data.push({
            loan_id,
            lender,
            currency: rawCurrency,
            principal,
            outstanding_balance,
            interest_rate,
            payment_date,
            maturity_date,
            payment_type,
            payment_amount,
            loan_type,
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

export function downloadLoanScheduleTemplate(): void {
  const header = 'loan_id,lender,currency,principal,outstanding_balance,interest_rate,payment_date,maturity_date,payment_type,payment_amount,loan_type,description'
  const rows = [
    'LOAN-001,First National Bank,USD,5000000,4200000,4.5,2025-07-01,2028-12-31,both,125000,term,5-year term loan for equipment financing',
    'LOAN-002,Deutsche Bank,EUR,10000000,9500000,3.25,2025-08-15,2030-06-30,interest,25625,revolver,Revolving credit facility — EUR tranche',
    'LOAN-003,Barclays Capital,GBP,20000000,20000000,5.0,2025-09-30,2032-09-30,interest,83333,bond,Senior unsecured bond issuance',
    'LOAN-004,RBC Capital Markets,CAD,3000000,2100000,6.75,2025-10-01,2026-09-30,both,105000,other,Bridge facility — CAD working capital',
  ]
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'loan_schedules_template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
