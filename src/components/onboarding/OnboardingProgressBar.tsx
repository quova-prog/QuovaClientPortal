import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import type { OnboardingStatus } from '@/types'

interface Step { key: OnboardingStatus; label: string; path: string }

const STEPS: Step[] = [
  { key: 'setup',    label: 'Company Setup', path: '/onboarding/setup'    },
  { key: 'connect',  label: 'Connect Data',  path: '/onboarding/connect'  },
  { key: 'discover', label: 'AI Discovery',  path: '/onboarding/discover' },
  { key: 'validate', label: 'Validate',      path: '/onboarding/validate' },
  { key: 'live',     label: 'Go Live',       path: '/onboarding/live'     },
]

const ORDER: OnboardingStatus[] = ['setup', 'connect', 'discover', 'validate', 'live']

export function OnboardingProgressBar({ status }: { status: OnboardingStatus }) {
  const navigate   = useNavigate()
  const currentIdx = ORDER.indexOf(status === 'error' ? 'setup' : status)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.25rem 2rem', background: 'var(--bg-card)',
      borderBottom: '1px solid var(--border)',
    }}>
      {STEPS.map((step, i) => {
        const done      = i < currentIdx
        const active    = i === currentIdx
        const clickable = done  // can click any completed step to go back

        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center' }}>
            {/* Circle + label */}
            <div
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => navigate(step.path) : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === 'Enter') navigate(step.path) } : undefined}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                cursor: clickable ? 'pointer' : 'default',
              }}
            >
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? 'var(--teal)' : active ? 'var(--teal-dim)' : 'var(--bg-surface)',
                border:     `2px solid ${done || active ? 'var(--teal)' : 'var(--border)'}`,
                color:      done ? '#fff' : active ? 'var(--teal)' : 'var(--text-muted)',
                fontWeight: 600, fontSize: '0.78rem',
                transition: 'all 0.2s',
                flexShrink: 0,
              }}>
                {done ? <Check size={13} /> : i + 1}
              </div>
              <span style={{
                fontSize: '0.68rem', fontWeight: active ? 600 : 400,
                color: done || active ? 'var(--text-primary)' : 'var(--text-muted)',
                whiteSpace: 'nowrap', lineHeight: 1,
                textDecoration: clickable ? 'none' : 'none',
              }}>
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div style={{
                width: 72, height: 2, margin: '0 4px', marginBottom: 18,
                background: done ? 'var(--teal)' : 'var(--border)',
                transition: 'background 0.3s',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}
