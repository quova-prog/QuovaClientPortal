// ============================================================
// ORBIT — Tier Feature Gating Service
// Source of truth for what each tier can access.
// ============================================================

import type { TierPlan, TierFeature } from '@/types'

/** Normalize legacy plan values to the new tier system */
export function normalizePlan(plan: string | null | undefined): TierPlan {
  if (plan === 'exposure' || plan === 'pro' || plan === 'enterprise') return plan
  // Legacy mappings (pre-migration data)
  if (plan === 'full') return 'pro'
  return 'exposure' // trial, demo, limited, null, undefined → exposure
}

/** Static feature matrix — no DB call needed for basic checks */
const TIER_FEATURES: Record<TierPlan, Set<TierFeature>> = {
  exposure: new Set([
    'exposure_dashboard',
  ]),
  pro: new Set([
    'exposure_dashboard',
    'hedge_tracking',
    'coverage_analysis',
    'policy_compliance',
    'approval_workflows',
    'audit_trail',
    'board_reporting',
    'ai_recommendations',
  ]),
  enterprise: new Set([
    'exposure_dashboard',
    'hedge_tracking',
    'coverage_analysis',
    'policy_compliance',
    'approval_workflows',
    'audit_trail',
    'board_reporting',
    'ai_recommendations',
    'api_access',
    'sso',
    'custom_integrations',
  ]),
}

/** Display metadata for each tier */
export const TIER_DISPLAY: Record<TierPlan, { name: string; badge: string; badgeStyle: 'outline' | 'solid-teal' | 'solid-navy' }> = {
  exposure:   { name: 'Orbit Exposure',    badge: 'EXPOSURE',   badgeStyle: 'outline' },
  pro:        { name: 'Orbit Pro',         badge: 'PRO',        badgeStyle: 'solid-teal' },
  enterprise: { name: 'Orbit Enterprise',  badge: 'ENTERPRISE', badgeStyle: 'solid-navy' },
}

/** The minimum tier required for each feature */
export const FEATURE_MIN_TIER: Record<TierFeature, TierPlan> = {
  exposure_dashboard:   'exposure',
  hedge_tracking:       'pro',
  coverage_analysis:    'pro',
  policy_compliance:    'pro',
  approval_workflows:   'pro',
  audit_trail:          'pro',
  board_reporting:      'pro',
  ai_recommendations:   'pro',
  trade_execution:      'enterprise',
  multi_bank_rfq:       'enterprise',
  api_access:           'enterprise',
  sso:                  'enterprise',
  custom_integrations:  'enterprise',
}

/** Features that Pro unlocks (used in upgrade modal) */
export const PRO_FEATURES = [
  'Hedge position tracking',
  'Coverage analysis with target ratios',
  'Policy compliance monitoring',
  'Approval workflows and audit trail',
  'Board-ready reporting',
  'AI hedge recommendations',
]

/** Features that Enterprise adds on top of Pro */
export const ENTERPRISE_FEATURES = [
  'API access (read/write)',
  'SSO (SAML)',
  'Custom integrations',
  'Dedicated support',
]

/** Check if a tier can access a given feature */
export function canAccess(plan: TierPlan, feature: TierFeature): boolean {
  return TIER_FEATURES[plan]?.has(feature) ?? false
}

/** Get the next upgrade tier (or null if already top) */
export function getUpgradeTier(plan: TierPlan): TierPlan | null {
  if (plan === 'exposure') return 'pro'
  if (plan === 'pro') return 'enterprise'
  return null
}

/** Get features the next tier would unlock */
export function getUpgradeFeatures(plan: TierPlan): string[] {
  if (plan === 'exposure') return PRO_FEATURES
  if (plan === 'pro') return ENTERPRISE_FEATURES
  return []
}
