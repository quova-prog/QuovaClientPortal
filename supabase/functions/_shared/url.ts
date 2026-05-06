// ============================================================
// URL + HTML attribute helpers for Edge Function email output.
// ============================================================

const DEFAULT_APP_BASE_URL = 'https://app.quovaos.com'

export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function safeAppPath(path: string | null | undefined, fallback = '/'): string {
  const value = (path ?? '').trim()
  const fallbackValue = fallback.startsWith('/') && !fallback.startsWith('//') ? fallback : '/'

  // App CTAs must be origin-relative paths only. Reject schemes,
  // protocol-relative URLs, backslash tricks, and control chars.
  if (!value.startsWith('/') || value.startsWith('//')) return fallbackValue
  if ([...value].some(char => {
    const code = char.charCodeAt(0)
    return char === '\\' || code <= 31 || code === 127
  })) return fallbackValue

  try {
    const parsed = new URL(value, DEFAULT_APP_BASE_URL)
    if (parsed.origin !== DEFAULT_APP_BASE_URL) return fallbackValue
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallbackValue
  }
}

export function safeHttpUrl(url: string | null | undefined, fallback: string): string {
  const value = (url ?? '').trim()
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return fallback
    return parsed.toString()
  } catch {
    return fallback
  }
}

export function joinAppUrl(baseUrl: string | null | undefined, path: string | null | undefined, fallbackPath = '/'): string {
  const safeBase = safeHttpUrl(baseUrl, DEFAULT_APP_BASE_URL)
  const safePath = safeAppPath(path, fallbackPath)
  return new URL(safePath, safeBase).toString()
}
