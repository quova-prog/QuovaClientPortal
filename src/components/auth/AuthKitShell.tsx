import React from 'react'
import { AuthKitProvider } from '@workos-inc/authkit-react'
import { loadRuntimeWorkosAuthConfig, type WorkosAuthConfig } from '@/lib/workosConfig'

export type AuthKitProviderRuntimeProps = {
  clientId: string
  apiHostname?: string
  redirectUri?: string
  devMode?: boolean
}

export function buildAuthKitProviderProps(config: WorkosAuthConfig): AuthKitProviderRuntimeProps | null {
  if (config.provider !== 'workos') return null
  if (!config.workos.clientId) {
    throw new Error('WorkOS AuthKit requires VITE_WORKOS_CLIENT_ID')
  }

  return {
    clientId: config.workos.clientId,
    ...(config.workos.apiHostname ? { apiHostname: config.workos.apiHostname } : {}),
    ...(config.workos.redirectUri ? { redirectUri: config.workos.redirectUri } : {}),
    ...(config.workos.devMode ? { devMode: true } : { devMode: false }),
  }
}

export function AuthKitShell({
  children,
  config = loadRuntimeWorkosAuthConfig(),
}: {
  children: React.ReactNode
  config?: WorkosAuthConfig
}) {
  const providerProps = buildAuthKitProviderProps(config)
  if (!providerProps) return <>{children}</>

  return (
    <AuthKitProvider {...providerProps}>
      {children}
    </AuthKitProvider>
  )
}
