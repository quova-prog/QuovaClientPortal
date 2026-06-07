import { describe, expect, it } from 'vitest'
import { buildAuthKitProviderProps } from './AuthKitShell'

describe('AuthKit shell', () => {
  it('does not wrap the app while Supabase auth remains the active provider', () => {
    expect(buildAuthKitProviderProps({
      provider: 'supabase',
      workos: {
        clientId: null,
        redirectUri: null,
        apiHostname: null,
        passwordResetUrl: null,
        devMode: false,
      },
    })).toBeNull()
  })

  it('maps WorkOS runtime config into AuthKit provider props', () => {
    expect(buildAuthKitProviderProps({
      provider: 'workos',
      workos: {
        clientId: 'client_123',
        redirectUri: 'https://app.quovaos.com/callback',
        apiHostname: 'api.workos.com',
        passwordResetUrl: null,
        devMode: false,
      },
    })).toEqual({
      clientId: 'client_123',
      redirectUri: 'https://app.quovaos.com/callback',
      apiHostname: 'api.workos.com',
      devMode: false,
    })
  })

  it('omits optional AuthKit props when they are unset', () => {
    expect(buildAuthKitProviderProps({
      provider: 'workos',
      workos: {
        clientId: 'client_123',
        redirectUri: null,
        apiHostname: null,
        passwordResetUrl: null,
        devMode: true,
      },
    })).toEqual({
      clientId: 'client_123',
      devMode: true,
    })
  })
})
