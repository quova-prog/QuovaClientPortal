import { lazy, Suspense, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { EntityProvider } from '@/context/EntityContext'
import { ModuleProvider } from '@/context/ModuleContext'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { MonitoringBridge } from '@/components/app/MonitoringBridge'
import { AppLayout } from '@/components/layout/AppLayout'
import { IdleTimeout } from '@/components/ui/IdleTimeout'

const LoginPage = lazy(() => import('@/pages/LoginPage').then(m => ({ default: m.LoginPage })))
const SignupPage = lazy(() => import('@/pages/SignupPage').then(m => ({ default: m.SignupPage })))
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })))
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const ExposurePage = lazy(() => import('@/pages/ExposurePage').then(m => ({ default: m.ExposurePage })))
const HedgePage = lazy(() => import('@/pages/HedgePage').then(m => ({ default: m.HedgePage })))
const TradePage = lazy(() => import('@/pages/TradePage').then(m => ({ default: m.TradePage })))
const UploadPage = lazy(() => import('@/pages/UploadPage').then(m => ({ default: m.UploadPage })))
const StrategyPage = lazy(() => import('@/pages/StrategyPage').then(m => ({ default: m.StrategyPage })))
const CounterpartiesPage = lazy(() => import('@/pages/CounterpartiesPage').then(m => ({ default: m.CounterpartiesPage })))
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })))
const BankAccountsPage = lazy(() => import('@/pages/BankAccountsPage').then(m => ({ default: m.BankAccountsPage })))
const IntegrationsPage = lazy(() => import('@/pages/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })))
const ForceMfaSetupPage = lazy(() => import('@/pages/ForceMfaSetupPage').then(m => ({ default: m.ForceMfaSetupPage })))
const InboxPage = lazy(() => import('@/pages/InboxPage').then(m => ({ default: m.InboxPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const AdvisorPage = lazy(() => import('@/pages/AdvisorPage').then(m => ({ default: m.AdvisorPage })))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })))
const AuditLogPage = lazy(() => import('@/pages/AuditLogPage').then(m => ({ default: m.AuditLogPage })))
const OnboardingRouter = lazy(() => import('@/pages/onboarding/OnboardingRouter').then(m => ({ default: m.OnboardingRouter })))

// Commodity Risk Pages
const CommodityDashboardPage = lazy(() => import('@/pages/CommodityDashboardPage').then(m => ({ default: m.CommodityDashboardPage })))
const CommodityExposurePage = lazy(() => import('@/pages/CommodityExposurePage').then(m => ({ default: m.CommodityExposurePage })))
const CommodityHedgePage = lazy(() => import('@/pages/CommodityHedgePage').then(m => ({ default: m.CommodityHedgePage })))
const CommodityAnalyticsPage = lazy(() => import('@/pages/CommodityAnalyticsPage').then(m => ({ default: m.CommodityAnalyticsPage })))

function RouteSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-app)' }}>
      <div className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  )
}

function RouteBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteSpinner />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-app)' }}>
      <div className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return (
    <>
      {children}
      <IdleTimeout />
    </>
  )
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
        <ModuleProvider>
          <EntityProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <MonitoringBridge />
            <Routes>
              {/* Onboarding — protected, standalone shell (no AppLayout) */}
              <Route path="/onboarding/*" element={<ProtectedRoute><RouteBoundary><OnboardingRouter /></RouteBoundary></ProtectedRoute>} />

              {/* Public */}
              <Route path="/login"           element={<PublicRoute><RouteBoundary><LoginPage /></RouteBoundary></PublicRoute>} />
              <Route path="/signup" element={<PublicRoute><RouteBoundary><SignupPage /></RouteBoundary></PublicRoute>} />
              <Route path="/mfa-setup" element={<PublicRoute><RouteBoundary><ForceMfaSetupPage /></RouteBoundary></PublicRoute>} />
              <Route path="/forgot-password" element={<PublicRoute><RouteBoundary><ForgotPasswordPage /></RouteBoundary></PublicRoute>} />
              <Route path="/reset-password"  element={<RouteBoundary><ResetPasswordPage /></RouteBoundary>} />

              {/* Protected */}
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route index element={<SmartRedirect />} />
                
                {/* FX Risk Modules */}
                <Route path="/dashboard"      element={<RouteBoundary><DashboardPage /></RouteBoundary>} />
                <Route path="/exposure"       element={<RouteBoundary><ExposurePage /></RouteBoundary>} />
                <Route path="/hedge"          element={<RouteBoundary><HedgePage /></RouteBoundary>} />
                
                {/* Commodity Risk Modules */}
                <Route path="/commodities/dashboard" element={<RouteBoundary><CommodityDashboardPage /></RouteBoundary>} />
                <Route path="/commodities/exposure"  element={<RouteBoundary><CommodityExposurePage /></RouteBoundary>} />
                <Route path="/commodities/hedge"     element={<RouteBoundary><CommodityHedgePage /></RouteBoundary>} />
                <Route path="/commodities/analytics" element={<RouteBoundary><CommodityAnalyticsPage /></RouteBoundary>} />

                {/* Common / Global Modules */}
                <Route path="/inbox"          element={<RouteBoundary><InboxPage /></RouteBoundary>} />
                <Route path="/upload"         element={<RouteBoundary><UploadPage /></RouteBoundary>} />
                <Route path="/strategy"       element={<RouteBoundary><StrategyPage /></RouteBoundary>} />
                <Route path="/advisor"        element={<RouteBoundary><AdvisorPage /></RouteBoundary>} />
                <Route path="/trade"          element={<RouteBoundary><TradePage /></RouteBoundary>} />
                <Route path="/counterparties" element={<RouteBoundary><CounterpartiesPage /></RouteBoundary>} />
                <Route path="/analytics"      element={<RouteBoundary><AnalyticsPage /></RouteBoundary>} />
                <Route path="/bank-accounts"  element={<RouteBoundary><BankAccountsPage /></RouteBoundary>} />
                <Route path="/integrations"   element={<RouteBoundary><IntegrationsPage /></RouteBoundary>} />
                <Route path="/settings"       element={<RouteBoundary><SettingsPage /></RouteBoundary>} />
                <Route path="/audit-log"     element={<RouteBoundary><AuditLogPage /></RouteBoundary>} />
                {/* Redirects for old routes */}
                <Route path="/hedges"         element={<Navigate to="/hedge" replace />} />
                <Route path="/coverage"       element={<Navigate to="/analytics" replace />} />
                <Route path="/reports"        element={<Navigate to="/analytics" replace />} />
              </Route>
              {/* Catch-all 404 */}
              <Route path="*" element={<RouteBoundary><NotFoundPage /></RouteBoundary>} />
            </Routes>
          </BrowserRouter>
          </EntityProvider>
        </ModuleProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
