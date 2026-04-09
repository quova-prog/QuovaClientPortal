import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { EntityProvider } from '@/context/EntityContext'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { MonitoringBridge } from '@/components/app/MonitoringBridge'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { SignupPage } from '@/pages/SignupPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { ExposurePage } from '@/pages/ExposurePage'
import { HedgePage } from '@/pages/HedgePage'
import { TradePage } from '@/pages/TradePage'
import { UploadPage } from '@/pages/UploadPage'
import { StrategyPage } from '@/pages/StrategyPage'
import { CounterpartiesPage } from '@/pages/CounterpartiesPage'
import { AnalyticsPage } from '@/pages/AnalyticsPage'
import { BankAccountsPage } from '@/pages/BankAccountsPage'
import { IntegrationsPage } from '@/pages/IntegrationsPage'
import { InboxPage } from '@/pages/InboxPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { AdvisorPage } from '@/pages/AdvisorPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { AuditLogPage }      from '@/pages/AuditLogPage'
import { OnboardingRouter } from '@/pages/onboarding/OnboardingRouter'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-app)' }}>
      <div className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) return null
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

function SmartRedirect() {
  const { user, loading } = useAuth()
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    // Wait for auth to finish loading before deciding redirect target
    if (loading) return

    const orgId = user?.organisation?.id
    if (!orgId) { setTarget('/dashboard'); return }
    let cancelled = false
    void (async () => {
      try {
        const { data } = await supabase
          .from('onboarding_sessions')
          .select('status')
          .eq('org_id', orgId)
          .maybeSingle()
        if (cancelled) return
        // No session OR session not yet 'live' → send to onboarding
        if (!data || data.status !== 'live') {
          setTarget('/onboarding')
        } else {
          setTarget('/dashboard')
        }
      } catch {
        if (!cancelled) setTarget('/dashboard')
      }
    })()
    return () => { cancelled = true }
  }, [user, loading])

  if (!target) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-app)' }}>
      <div className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  )
  return <Navigate to={target} replace />
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <EntityProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <MonitoringBridge />
          <Routes>
            {/* Onboarding — protected, standalone shell (no AppLayout) */}
            <Route path="/onboarding/*" element={<ProtectedRoute><OnboardingRouter /></ProtectedRoute>} />

            {/* Public */}
            <Route path="/login"           element={<PublicRoute><LoginPage /></PublicRoute>} />
            <Route path="/signup"          element={<PublicRoute><SignupPage /></PublicRoute>} />
            <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
            <Route path="/reset-password"  element={<ResetPasswordPage />} />

            {/* Protected */}
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<SmartRedirect />} />
              <Route path="/dashboard"      element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
              <Route path="/inbox"          element={<ErrorBoundary><InboxPage /></ErrorBoundary>} />
              <Route path="/upload"         element={<ErrorBoundary><UploadPage /></ErrorBoundary>} />
              <Route path="/exposure"       element={<ErrorBoundary><ExposurePage /></ErrorBoundary>} />
              <Route path="/strategy"       element={<ErrorBoundary><StrategyPage /></ErrorBoundary>} />
              <Route path="/advisor"        element={<ErrorBoundary><AdvisorPage /></ErrorBoundary>} />
              <Route path="/hedge"          element={<ErrorBoundary><HedgePage /></ErrorBoundary>} />
              <Route path="/trade"          element={<ErrorBoundary><TradePage /></ErrorBoundary>} />
              <Route path="/counterparties" element={<ErrorBoundary><CounterpartiesPage /></ErrorBoundary>} />
              <Route path="/analytics"      element={<ErrorBoundary><AnalyticsPage /></ErrorBoundary>} />
              <Route path="/bank-accounts"  element={<ErrorBoundary><BankAccountsPage /></ErrorBoundary>} />
              <Route path="/integrations"   element={<ErrorBoundary><IntegrationsPage /></ErrorBoundary>} />
              <Route path="/settings"       element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
              <Route path="/audit-log"     element={<ErrorBoundary><AuditLogPage /></ErrorBoundary>} />
              {/* Redirects for old routes */}
              <Route path="/hedges"         element={<Navigate to="/hedge" replace />} />
              <Route path="/coverage"       element={<Navigate to="/analytics" replace />} />
              <Route path="/reports"        element={<Navigate to="/analytics" replace />} />
            </Route>
            {/* Catch-all 404 */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
        </EntityProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
