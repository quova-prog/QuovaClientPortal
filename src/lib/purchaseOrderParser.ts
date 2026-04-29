import Papa from 'papaparse'
import type { PurchaseOrder } from '@/hooks/usePurchaseOrders'

// ── Column aliases (case-insensitive lookup) ──────────────────

const ALIASES: Record<string, string[]> = {
  po_number:   ['po_number', 'po_no', 'po_ref', 'purchase_order', 'order_number', 'po'],
  supplier:    ['supplier', 'vendor', 'vendor_name', 'supplier_name'],
  currency:    ['currency', 'ccy', 'currency_code'],
  amount:      ['amount', 'value', 'po_amount', 'order_amount', 'total'],
  due_date:    ['due_date', 'payment_due', 'due', 'maturity_date', 'settlement_date'],
  issue_date:  ['issue_date', 'date', 'po_date', 'order_date'],
  category:    ['category', 'type', 'expense_type', 'cost_category'],
  status:      ['status', 'state'],
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

const VALID_STATUSES = ['open', 'approved', 'pending', 'paid'] as const

function normalizeStatus(raw: string): 'open' | 'approved' | 'pending' | 'paid' {
  const lower = raw.trim().toLowerCase()
  if ((VALID_STATUSES as readonly string[]).includes(lower)) {
    return lower as 'open' | 'approved' | 'pending' | 'paid'
  }
  return 'open'
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

export function parsePurchaseOrderCsv(
  file: File
): Promise<{ data: Omit<PurchaseOrder, 'id' | 'uploaded_at'>[]; errors: string[] }> {
  return new Promise((resolve) => {
    const errors: string[] = []
    const data: Omit<PurchaseOrder, 'id' | 'uploaded_at'>[] = []

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

        const colPoNumber    = findColumn(headers, ALIASES.po_number)
        const colSupplier    = findColumn(headers, ALIASES.supplier)
        const colCurrency    = findColumn(headers, ALIASES.currency)
        const colAmount      = findColumn(headers, ALIASES.amount)
        const colDueDate     = findColumn(headers, ALIASES.due_date)
        const colIssueDate   = findColumn(headers, ALIASES.issue_date)
        const colCategory    = findColumn(headers, ALIASES.category)
        const colStatus      = findColumn(headers, ALIASES.status)
        const colDescription = findColumn(headers, ALIASES.description)

        if (!colPoNumber) {
          errors.push('Missing required column: po_number (or po_no, po_ref, purchase_order, order_number, po)')
          resolve({ data, errors })
          return
        }
        if (!colSupplier) {
          errors.push('Missing required column: supplier (or vendor, vendor_name, supplier_name)')
          resolve({ data, errors })
          return
        }
        if (!colCurrency) {
          errors.push('Missing required column: currency (or ccy, currency_code)')
          resolve({ data, errors })
          return
        }
        if (!colAmount) {
          errors.push('Missing required column: amount (or value, po_amount, order_amount, total)')
          resolve({ data, errors })
          return
        }
        if (!colDueDate) {
          errors.push('Missing required column: due_date (or payment_due, due, maturity_date, settlement_date)')
          resolve({ data, errors })
          return
        }

        rawData.forEach((row, idx) => {
          const lineNum = idx + 2 // 1-indexed + header row

          // Skip blank rows
          const allEmpty = Object.values(row).every(v => !v || !v.trim())
          if (allEmpty) return

          // PO Number
          const po_number = (row[colPoNumber!] ?? '').trim()
          if (!po_number) {
            errors.push(`Row ${lineNum}: Missing po_number.`)
            return
          }

          // Supplier
          const supplier = (row[colSupplier!] ?? '').trim()
          if (!supplier) {
            errors.push(`Row ${lineNum}: Missing supplier/vendor name.`)
            return
          }

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

          // Due date (required)
          const rawDueDate = (row[colDueDate!] ?? '').trim()
          if (!rawDueDate) {
            errors.push(`Row ${lineNum}: Missing due_date.`)
            return
          }
          const due_date = parseDate(rawDueDate)
          if (!due_date) {
            errors.push(`Row ${lineNum}: Invalid due_date "${rawDueDate}" — use YYYY-MM-DD format.`)
            return
          }

          // Issue date (optional)
          let issue_date = ''
          if (colIssueDate) {
            const rawIssue = (row[colIssueDate] ?? '').trim()
            if (rawIssue) {
              const parsed = parseDate(rawIssue)
              if (parsed) {
                issue_date = parsed
              } else {
                errors.push(`Row ${lineNum}: Invalid issue_date "${rawIssue}" — use YYYY-MM-DD format. Row will be imported without issue date.`)
              }
            }
          }

          // Optional fields
          const category    = colCategory    ? (row[colCategory] ?? '').trim()    : ''
          const status      = colStatus      ? normalizeStatus(row[colStatus] ?? '') : 'open'
          const description = colDescription ? (row[colDescription] ?? '').trim() : ''

          data.push({
            po_number,
            supplier,
            currency: rawCurrency,
            amount,
            due_date,
            issue_date,
            category,
            status,
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

export function downloadPurchaseOrderTemplate(): void {
  const header = 'po_number,supplier,currency,amount,due_date,issue_date,category,status,description'
  const rows = [
    'PO-2025-001,Acme Corp,EUR,125000,2025-06-30,2025-03-15,Raw Materials,open,Steel components for Q2 production',
    'PO-2025-002,TechSoft Ltd,USD,48500,2025-07-15,2025-04-01,Software,approved,Annual SaaS license renewal',
    'PO-2025-003,Global Freight,GBP,22000,2025-08-01,2025-04-10,Services,pending,Logistics and shipping services Q3',
  ]
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'purchase_orders_template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
