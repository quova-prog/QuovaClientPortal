import { Outlet } from 'react-router-dom'
import { OnboardingProgressBar } from '@/components/onboarding/OnboardingProgressBar'
import type { OnboardingStatus } from '@/types'

export function OnboardingLayout({ status }: { status: OnboardingStatus }): React.ReactElement {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div style={{
        background: 'var(--sidebar-bg)',
        padding: '0.75rem 1.5rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--sidebar-border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--teal)' }} />
          <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.02em' }}>
            Orbit
          </span>
          <span style={{ color: 'var(--sidebar-text)', fontSize: '0.8rem' }}>/ Setup</span>
        </div>
        <a
          href="/dashboard"
          style={{ fontSize: '0.78rem', color: 'var(--sidebar-text)' }}
        >
          Skip for now →
        </a>
      </div>

      {/* Progress */}
      <OnboardingProgressBar status={status} />

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Outlet />
      </div>
    </div>
  )
}
