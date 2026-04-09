// ============================================================
// PII Stripping — removes/pseudonymizes sensitive data before
// sending sample rows to the AI discovery service.
// No React dependencies — pure TypeScript utility.
// ============================================================

const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g
const SSN_RE   = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g
const CC_RE    = /\b(?:\d{4}[\s-]?){3}\d{4}\b/g

export function stripPIIString(value: string): string {
  return value
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(SSN_RE,   '[SSN]')
    .replace(CC_RE,    '[CC]')
    .replace(PHONE_RE, '[PHONE]')
}

export function stripPII(value: unknown): unknown {
  if (typeof value === 'string') return stripPIIString(value)
  if (Array.isArray(value)) return value.map(stripPII)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripPII(v)])
    )
  }
  return value
}

/** Pseudonymize counterparty names consistently within a batch (Vendor_A, Vendor_B, …) */
export function pseudonymizeNames(
  rows: Record<string, unknown>[],
  field: string,
): Record<string, unknown>[] {
  const nameMap = new Map<string, string>()
  let counter = 0
  return rows.map(row => {
    const val = row[field]
    if (typeof val !== 'string' || !val) return row
    if (!nameMap.has(val)) {
      // A → Z, then AA, AB …
      const idx = counter++
      const letter = idx < 26
        ? String.fromCharCode(65 + idx)
        : String.fromCharCode(65 + Math.floor(idx / 26) - 1) + String.fromCharCode(65 + (idx % 26))
      nameMap.set(val, `Vendor_${letter}`)
    }
    return { ...row, [field]: nameMap.get(val) }
  })
}

/** Strip PII from up to maxRows rows before sending to AI */
export function prepareForAI(
  rows: Record<string, unknown>[],
  maxRows = 100,
): Record<string, unknown>[] {
  return rows.slice(0, maxRows).map(row => stripPII(row) as Record<string, unknown>)
}
