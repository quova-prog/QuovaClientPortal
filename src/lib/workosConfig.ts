export type AuthProvider = 'supabase' | 'workos'

export type EnvLike = Record<string, string | boolean | undefined>

export type WorkosAuthConfig = {
  provider: AuthProvider
  workos: {
    clientId: string | null
    redirectUri: string | null
    apiHostname: string | null
    passwordResetUrl: string | null
    devMode: boolean
  }
}

export type WorkosAuthConfigOptions = {
  mode?: string
}

function envString(env: EnvLike, key: string): string | undefined {
  const value = env[key]
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value?.trim() || undefined
}

function envBoolean(env: EnvLike, key: string): boolean {
  const value = envString(env, key)
  return value === 'true' || value === '1'
}

function isLocalhostUrl(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
}

function validateAppUrl(value: string, envName: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${envName} must be a valid URL`)
  }

  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhostUrl(parsed))) {
    throw new Error(`${envName} must use HTTPS outside localhost development`)
  }

  return parsed.toString()
}

function validateRedirectUri(value: string): string {
  return validateAppUrl(value, 'VITE_WORKOS_REDIRECT_URI')
}

function validateApiHostname(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    throw new Error('VITE_WORKOS_API_HOSTNAME must be a hostname without a protocol')
  }

  try {
    const parsed = new URL(`https://${value}`)
    if (parsed.hostname !== value || parsed.pathname !== '/') {
      throw new Error('invalid hostname')
    }
  } catch {
    throw new Error('VITE_WORKOS_API_HOSTNAME must be a valid hostname')
  }

  return value
}

export function loadWorkosAuthConfig(env: EnvLike, options: WorkosAuthConfigOptions = {}): WorkosAuthConfig {
  const provider = envString(env, 'VITE_AUTH_PROVIDER') ?? 'supabase'
  if (provider !== 'supabase' && provider !== 'workos') {
    throw new Error('VITE_AUTH_PROVIDER must be either "supabase" or "workos"')
  }

  const devMode = envBoolean(env, 'VITE_WORKOS_DEV_MODE')
  if (provider === 'workos' && options.mode === 'production' && devMode) {
    throw new Error('WorkOS AuthKit dev mode cannot be enabled in production')
  }

  const rawRedirectUri = envString(env, 'VITE_WORKOS_REDIRECT_URI')
  const redirectUri = rawRedirectUri ? validateRedirectUri(rawRedirectUri) : null
  const rawApiHostname = envString(env, 'VITE_WORKOS_API_HOSTNAME')
  const apiHostname = rawApiHostname ? validateApiHostname(rawApiHostname) : null
  const rawPasswordResetUrl = envString(env, 'VITE_WORKOS_PASSWORD_RESET_URL')
  const passwordResetUrl = rawPasswordResetUrl ? validateAppUrl(rawPasswordResetUrl, 'VITE_WORKOS_PASSWORD_RESET_URL') : null
  const clientId = envString(env, 'VITE_WORKOS_CLIENT_ID') ?? null

  if (provider === 'workos' && !clientId) {
    throw new Error('VITE_WORKOS_CLIENT_ID is required when VITE_AUTH_PROVIDER=workos')
  }

  if (provider === 'workos' && options.mode === 'production' && !apiHostname) {
    throw new Error('VITE_WORKOS_API_HOSTNAME is required in production WorkOS mode')
  }

  return {
    provider,
    workos: {
      clientId,
      redirectUri,
      apiHostname,
      passwordResetUrl,
      devMode,
    },
  }
}

export function loadRuntimeWorkosAuthConfig(): WorkosAuthConfig {
  return loadWorkosAuthConfig(import.meta.env, { mode: import.meta.env.MODE })
}
