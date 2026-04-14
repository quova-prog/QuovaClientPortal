type MonitoringSeverity = 'info' | 'warning' | 'error' | 'critical'
type MonitoringCategory = 'application' | 'auth' | 'security' | 'audit' | 'data' | 'network'

interface MonitoringContext {
  userId?: string | null
  orgId?: string | null
  route?: string | null
}

interface MonitoringEvent {
  category: MonitoringCategory
  severity: MonitoringSeverity
  message: string
  errorName?: string
  stack?: string
  metadata?: Record<string, unknown>
}

const context: MonitoringContext = {}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (value == null) return value
  if (typeof value === 'string') return redactString(value).slice(0, 2000)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 25).map(item => sanitize(item, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[key] = isSensitiveKey(key) ? '[redacted]' : sanitize(entry, depth + 1)
    }
    return out
  }
  return String(value)
}

function isSensitiveKey(key: string): boolean {
  return /(password|token|secret|authorization|cookie|session|refresh|access|code)/i.test(key)
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/(token|secret|password|code)=([^&\s]+)/gi, '$1=[redacted]')
}

// Origins that are already permitted by connect-src in vercel.json.
// If VITE_MONITORING_ENDPOINT points to anything outside this list the browser
// will block the request in production without throwing an error.
const CSP_ALLOWED_ORIGINS = [
  import.meta.env.VITE_SUPABASE_URL ?? '',   // *.supabase.co (covers Edge Functions)
]

function getEndpoint(): string | null {
  const raw = import.meta.env.VITE_MONITORING_ENDPOINT
  if (!raw) return null
  const endpoint = raw.trim()

  if (import.meta.env.DEV) {
    try {
      const { origin } = new URL(endpoint)
      const allowed = CSP_ALLOWED_ORIGINS.some(allowed => {
        if (!allowed) return false
        try { return new URL(allowed).origin === origin } catch { return false }
      })
      if (!allowed) {
        console.warn(
          '[monitoring] VITE_MONITORING_ENDPOINT origin is not in the CSP connect-src ' +
          'allowlist (vercel.json). Telemetry will be silently blocked in production.\n' +
          'Use a Supabase Edge Function URL or add the host to connect-src.\n' +
          `Endpoint: ${endpoint}`
        )
      }
    } catch {
      console.warn('[monitoring] VITE_MONITORING_ENDPOINT is not a valid URL:', endpoint)
    }
  }

  return endpoint
}

function getSanitizedUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    // Supabase password reset / magic links put sensitive auth parameters in the hash.
    if (/(access_token|refresh_token|provider_token)=/.test(url.hash)) {
      url.hash = '#[redacted_auth_payload]'
    }
    return redactString(url.href)
  } catch {
    return redactString(window.location.href)
  }
}

function buildPayload(event: MonitoringEvent) {
  return {
    source: 'orbit-web',
    timestamp: new Date().toISOString(),
    category: event.category,
    severity: event.severity,
    message: event.message,
    error_name: event.errorName ?? null,
    stack: event.stack ? event.stack.slice(0, 8000) : null,
    context: {
      ...context,
      url: getSanitizedUrl(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    },
    metadata: sanitize(event.metadata ?? {}),
  }
}

async function dispatchPayload(payload: ReturnType<typeof buildPayload>): Promise<void> {
  const endpoint = getEndpoint()
  if (!endpoint) {
    if (import.meta.env.DEV) console.warn('[monitoring] missing VITE_MONITORING_ENDPOINT', payload)
    return
  }

  const body = JSON.stringify(payload)

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const ok = navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))
    if (ok) return
  }

  await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  })
}

export function setMonitoringContext(next: MonitoringContext): void {
  if ('userId' in next) context.userId = next.userId ?? null
  if ('orgId' in next) context.orgId = next.orgId ?? null
  if ('route' in next) context.route = next.route ?? null
}

export async function reportMonitoringEvent(event: MonitoringEvent): Promise<void> {
  try {
    await dispatchPayload(buildPayload(event))
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[monitoring] delivery failed', error)
  }
}

export async function reportException(
  error: unknown,
  details: Omit<MonitoringEvent, 'severity' | 'message' | 'errorName' | 'stack'> & { message?: string; severity?: MonitoringSeverity } = {
    category: 'application',
  },
): Promise<void> {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error')

  await reportMonitoringEvent({
    category: details.category,
    severity: details.severity ?? 'error',
    message: details.message ?? err.message,
    errorName: err.name,
    stack: err.stack,
    metadata: details.metadata,
  })
}
