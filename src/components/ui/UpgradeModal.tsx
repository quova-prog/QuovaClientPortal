// ============================================================
// ORBIT — Upgrade Modal
// Shown when an Exposure-tier user clicks a Pro/Enterprise feature.
// ============================================================

import { X, CheckCircle, ArrowUpRight } from 'lucide-react'
import { TIER_DISPLAY, getUpgradeTier, getUpgradeFeatures } from '@/lib/tierService'
import type { TierPlan } from '@/types'

interface UpgradeModalProps {
  currentTier: TierPlan
  featureName: string
  onClose: () => void
}

export function UpgradeModal({ currentTier, featureName, onClose }: UpgradeModalProps) {
  const nextTier = getUpgradeTier(currentTier)
  if (!nextTier) return null

  const nextDisplay = TIER_DISPLAY[nextTier]
  const features = getUpgradeFeatures(currentTier)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(10,15,30,0.5)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 'var(--r-lg)',
          width: '100%', maxWidth: 460, padding: 0,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border)',
        }}>
          <h3 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 600, color: '#0A0F1E' }}>
            Upgrade to {nextDisplay.name}
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem' }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
            <strong>{featureName}</strong> is available on {nextDisplay.name}.
          </p>

          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.75rem', fontWeight: 500 }}>
            Upgrade to unlock:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {features.map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle size={14} color="#00C2A8" />
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{f}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <a
              href="mailto:sales@orbitfx.com?subject=Upgrade%20to%20Pro"
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                padding: '0.625rem 1rem',
                background: '#00C2A8', color: '#fff', border: 'none', borderRadius: 'var(--r-md)',
                fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', cursor: 'pointer',
              }}
            >
              Contact Sales <ArrowUpRight size={14} />
            </a>
            <button
              onClick={onClose}
              style={{
                padding: '0.625rem 1rem',
                background: 'transparent', color: '#00C2A8',
                border: '1px solid #00C2A8', borderRadius: 'var(--r-md)',
                fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer',
              }}
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
