import { useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useOnboarding } from '@/hooks/useOnboarding'
import { OnboardingLayout } from './OnboardingLayout'
import { SetupWizard }      from './SetupWizard'
import { ConnectERP }       from './ConnectERP'
import { DiscoveryFeed }    from './DiscoveryFeed'
import { ValidateMappings } from './ValidateMappings'
import { GoLive }           from './GoLive'
import type { OnboardingStatus } from '@/types'

const STATUS_PATH: Record<string, string> = {
  setup:    '/onboarding/setup',
  connect:  '/onboarding/connect',
  discover: '/onboarding/discover',
  validate: '/onboarding/validate',
  live:     '/onboarding/live',
  error:    '/onboarding/setup',
}

const PATH_TO_STATUS: Record<string, OnboardingStatus> = {
  '/onboarding/setup':    'setup',
  '/onboarding/connect':  'connect',
  '/onboarding/discover': 'discover',
  '/onboarding/validate': 'validate',
  '/onboarding/live':     'live',
}

export function OnboardingRouter(): React.ReactElement {
  const { session, loading } = useOnboarding()
  const navigate             = useNavigate()
  const location             = useLocation()

  // Only redirect when landing on the bare /onboarding root
  useEffect(() => {
    if (!session || loading) return
    const here = location.pathname
    if (here === '/onboarding' || here === '/onboarding/') {
      navigate(STATUS_PATH[session.status] ?? '/onboarding/setup', { replace: true })
    }
  }, [session?.status, loading, navigate, location.pathname])

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-app)',
      }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    )
  }

  // Use the URL to determine which step to highlight (allows going back)
  const visibleStatus = PATH_TO_STATUS[location.pathname] ?? session?.status ?? 'setup'

  return (
    <Routes>
      <Route element={<OnboardingLayout status={visibleStatus} />}>
        <Route path="setup"    element={<SetupWizard />} />
        <Route path="connect"  element={<ConnectERP />} />
        <Route path="discover" element={<DiscoveryFeed />} />
        <Route path="validate" element={<ValidateMappings />} />
        <Route path="live"     element={<GoLive />} />
        <Route index           element={<Navigate to="setup" replace />} />
      </Route>
    </Routes>
  )
}
