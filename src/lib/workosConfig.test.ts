import { describe, expect, it } from 'vitest'
import { loadWorkosAuthConfig } from './workosConfig'

describe('WorkOS auth config', () => {
  it('defaults to the existing Supabase auth provider', () => {
    expect(loadWorkosAuthConfig({}).provider).toBe('supabase')
  })

  it('rejects unknown auth providers', () => {
    expect(() => loadWorkosAuthConfig({ VITE_AUTH_PROVIDER: 'workosss' })).toThrow(/VITE_AUTH_PROVIDER/)
  })

  it('requires a WorkOS client id when WorkOS auth is enabled', () => {
    expect(() => loadWorkosAuthConfig({ VITE_AUTH_PROVIDER: 'workos' })).toThrow(/VITE_WORKOS_CLIENT_ID/)
  })

  it('rejects AuthKit dev mode in production', () => {
    expect(() =>
      loadWorkosAuthConfig(
        {
          VITE_AUTH_PROVIDER: 'workos',
          VITE_WORKOS_CLIENT_ID: 'client_123',
          VITE_WORKOS_API_HOSTNAME: 'api.workos.com',
          VITE_WORKOS_DEV_MODE: 'true',
        },
        { mode: 'production' },
      ),
    ).toThrow(/dev mode/i)
  })

  it('allows localhost redirects for local development', () => {
    expect(
      loadWorkosAuthConfig(
        {
          VITE_AUTH_PROVIDER: 'workos',
          VITE_WORKOS_CLIENT_ID: 'client_123',
          VITE_WORKOS_REDIRECT_URI: 'http://localhost:5175/callback',
        },
        { mode: 'development' },
      ).workos.redirectUri,
    ).toBe('http://localhost:5175/callback')
  })

  it('requires a custom AuthKit API hostname in production WorkOS mode', () => {
    expect(() =>
      loadWorkosAuthConfig(
        {
          VITE_AUTH_PROVIDER: 'workos',
          VITE_WORKOS_CLIENT_ID: 'client_123',
        },
        { mode: 'production' },
      ),
    ).toThrow(/VITE_WORKOS_API_HOSTNAME/)
  })

  it('loads the custom AuthKit API hostname when provided', () => {
    expect(
      loadWorkosAuthConfig(
        {
          VITE_AUTH_PROVIDER: 'workos',
          VITE_WORKOS_CLIENT_ID: 'client_123',
          VITE_WORKOS_API_HOSTNAME: 'api.workos.com',
        },
        { mode: 'production' },
      ).workos.apiHostname,
    ).toBe('api.workos.com')
  })

  it('loads the WorkOS hosted password reset URL when provided', () => {
    expect(
      loadWorkosAuthConfig(
        {
          VITE_AUTH_PROVIDER: 'workos',
          VITE_WORKOS_CLIENT_ID: 'client_123',
          VITE_WORKOS_API_HOSTNAME: 'api.workos.com',
          VITE_WORKOS_PASSWORD_RESET_URL: 'https://fiery-root-58.authkit.app/reset-password',
        },
        { mode: 'production' },
      ).workos.passwordResetUrl,
    ).toBe('https://fiery-root-58.authkit.app/reset-password')
  })

  it('requires HTTPS redirects outside localhost', () => {
    expect(() =>
      loadWorkosAuthConfig(
        {
          VITE_AUTH_PROVIDER: 'workos',
          VITE_WORKOS_CLIENT_ID: 'client_123',
          VITE_WORKOS_API_HOSTNAME: 'api.workos.com',
          VITE_WORKOS_REDIRECT_URI: 'http://app.quovaos.com/callback',
        },
        { mode: 'production' },
      ),
    ).toThrow(/HTTPS/)
  })

  it('requires HTTPS password reset URLs outside localhost', () => {
    expect(() =>
      loadWorkosAuthConfig(
        {
          VITE_AUTH_PROVIDER: 'workos',
          VITE_WORKOS_CLIENT_ID: 'client_123',
          VITE_WORKOS_API_HOSTNAME: 'api.workos.com',
          VITE_WORKOS_PASSWORD_RESET_URL: 'http://fiery-root-58.authkit.app/reset-password',
        },
        { mode: 'production' },
      ),
    ).toThrow(/HTTPS/)
  })
})
