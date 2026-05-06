// CSV export helpers.
//
// Important: quoting alone does not prevent spreadsheet formula injection.
// Excel / Google Sheets can still evaluate quoted cells that start with
// =, +, -, @, tab, or carriage return. Prefix those values with a single
// quote before normal CSV escaping.

const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/
const CSV_NEEDS_QUOTING = /[",\n\r]/

export function neutralizeCsvFormula(value: string): string {
  return CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value
}

export function csvEscape(value: unknown): string {
  const safe = neutralizeCsvFormula(String(value ?? ''))
  return CSV_NEEDS_QUOTING.test(safe)
    ? `"${safe.replace(/"/g, '""')}"`
    : safe
}

export function toCsvRows(rows: unknown[][]): string {
  return rows.map(row => row.map(csvEscape).join(',')).join('\n')
}

export function toCsvObjects(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  return toCsvRows([
    headers,
    ...rows.map(row => headers.map(header => row[header])),
  ])
}
