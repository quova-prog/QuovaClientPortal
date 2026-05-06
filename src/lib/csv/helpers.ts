/**
 * Shared helpers for CSV upload-table parsers (`src/lib/*Parser.ts`).
 *
 * Every per-table parser used to inline its own copies of these functions
 * — sometimes with subtle differences (e.g. case-sensitive vs case-insensitive
 * column matching). This module is the single source of truth.
 *
 * The consolidated helpers here are designed as a strict superset of the
 * individual parser variants they replaced, so no parser loses any input
 * format it previously accepted.
 */

export { normalizeCurrencyPair, parseCurrencyPair } from '@/lib/utils'

/**
 * Find a header in `headers` that matches one of the given `aliases`.
 * Case-insensitive, whitespace-insensitive. Returns the exact original
 * header string from `headers` (preserving casing) so the caller can
 * use it as a key into the parsed row.
 */
export function findColumn(headers: string[], aliases: string[]): string | null {
  const lowerAliases = aliases.map(a => a.toLowerCase())
  for (const header of headers) {
    if (lowerAliases.includes(header.trim().toLowerCase())) return header
  }
  return null
}

/**
 * Parse a date string in any of the formats commonly seen in customer CSVs:
 *
 *   - ISO 8601:        2026-04-15
 *   - US slash:        04/15/2026   or 4/15/2026
 *   - US hyphen:       04-15-2026   or 4-15-2026
 *   - European dot:    15.04.2026   (DD.MM.YYYY)
 *   - Native Date.parse() fallback (e.g. "Apr 15, 2026")
 *
 * Returns the date as an ISO `YYYY-MM-DD` string, or `null` if unparsable.
 */
export function parseDate(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed + 'T00:00:00')
    if (!isNaN(d.getTime())) return trimmed
  }

  // MM/DD/YYYY or MM-DD-YYYY (US)
  const mdy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (mdy) {
    const [, mm, dd, yyyy] = mdy
    const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
    const d = new Date(iso + 'T00:00:00')
    if (!isNaN(d.getTime())) return iso
  }

  // DD.MM.YYYY (European)
  const dmy = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (dmy) {
    const [, dd, mm, yyyy] = dmy
    const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
    const d = new Date(iso + 'T00:00:00')
    if (!isNaN(d.getTime())) return iso
  }

  // Native fallback (handles "Apr 15, 2026", "2026/04/15", etc.)
  const d = new Date(trimmed)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)

  return null
}

/** Strict ISO currency-pair validator: matches `XXX/YYY` exactly. */
export function isValidCurrencyPair(pair: string): boolean {
  return /^[A-Z]{3}\/[A-Z]{3}$/.test(pair)
}
