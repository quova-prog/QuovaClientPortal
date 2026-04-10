// ============================================================
// PII Stripping — removes/pseudonymizes sensitive data before
// sending sample rows to the AI discovery service.
// No React dependencies — pure TypeScript utility.
// ============================================================

const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g
const SSN_RE   = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g
const CC_RE    = /\b(?:\d{4}[\s-]?){3}\d{4}\b/g
const IBAN_RE  = /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g
const BIC_RE   = /\b[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?\b/g

export function stripPIIString(value: string): string {
  return value
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(SSN_RE,   '[SSN]')
    .replace(CC_RE,    '[CC]')
    .replace(PHONE_RE, '[PHONE]')
    .replace(IBAN_RE,  '[IBAN]')
    .replace(BIC_RE,   '[BIC]')
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

const NAME_COL_RE = /vendor|customer|counterparty|company|supplier|name|partner/i

/** Strip PII from ALL rows and pseudonymize name-like columns before sending to AI */
export function prepareForAI(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (rows.length === 0) return []

  // Detect name-like columns from headers
  const headers = Object.keys(rows[0])
  const nameColumns = headers.filter(h => NAME_COL_RE.test(h))

  // Build pseudonym map across all name-like columns
  const nameMap = new Map<string, string>()
  let counter = 0
  function pseudonymize(val: string): string {
    if (!nameMap.has(val)) {
      const idx = counter++
      const letter = idx < 26
        ? String.fromCharCode(65 + idx)
        : String.fromCharCode(65 + Math.floor(idx / 26) - 1) + String.fromCharCode(65 + (idx % 26))
      nameMap.set(val, `Entity_${letter}`)
    }
    return nameMap.get(val)!
  }

  return rows.map(row => {
    const stripped = stripPII(row) as Record<string, unknown>
    for (const col of nameColumns) {
      const val = stripped[col]
      if (typeof val === 'string' && val.length > 0) {
        stripped[col] = pseudonymize(val)
      }
    }
    return stripped
  })
}
