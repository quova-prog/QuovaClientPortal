export const WORKOS_REDIRECT_GUARD_PREFIX = 'quova:workos-auth-redirect:'
export const WORKOS_REDIRECT_GUARD_TTL_MS = 15_000

function storageKey(key: string): string {
  return `${WORKOS_REDIRECT_GUARD_PREFIX}${key}`
}

export function beginWorkosAuthRedirect(key: string, now = Date.now()): boolean {
  if (typeof window === 'undefined') return true

  const fullKey = storageKey(key)
  const previous = Number(window.sessionStorage.getItem(fullKey) ?? 0)
  if (previous && now - previous < WORKOS_REDIRECT_GUARD_TTL_MS) {
    return false
  }

  window.sessionStorage.setItem(fullKey, String(now))
  return true
}

export function continueWorkosRedirect(key: string): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(storageKey(key))
}
