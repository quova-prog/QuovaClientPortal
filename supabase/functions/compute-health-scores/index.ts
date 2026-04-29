// ============================================================
// QUOVA Edge Function: compute-health-scores
// Evaluates gap detection rules per org and computes health
// dimension scores. Upserts results to customer_health_scores.
// Triggered by pg_cron or manual invocation (service role only).
// ============================================================

import { createAdminClient, authenticateRequest, jsonResponse, corsHeaders } from '../_shared/auth.ts'

// ── Types ────────────────────────────────────────────────────

interface Gap {
  type: string
  severity: 'critical' | 'warning' | 'low'
  message: string
}

interface HealthDimensions {
  data_completeness: number
  data_freshness: number
  coverage_health: number
  onboarding_progress: number
  position_risk: number
}

type HealthStatus = 'healthy' | 'needs_attention' | 'at_risk'

const DIMENSION_WEIGHTS: Record<keyof HealthDimensions, number> = {
  data_completeness: 0.30,
  data_freshness: 0.25,
  coverage_health: 0.20,
  onboarding_progress: 0.15,
  position_risk: 0.10,
}

const ONBOARDING_STATUS_SCORES: Record<string, number> = {
  setup: 20,
  connect: 40,
  discover: 60,
  validate: 80,
  live: 100,
  error: 10,
}

// ── Main handler ─────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const auth = await authenticateRequest(req)
  if (!auth.authenticated) {
    return jsonResponse({ error: auth.error ?? 'Unauthorized' }, 401)
  }

  if (!auth.isServiceRole) {
    return jsonResponse({ error: 'Forbidden: Service Role required' }, 403)
  }

  // Optional: target a specific org
  let targetOrgId: string | null = null
  try {
    const body = await req.json()
    targetOrgId = body.org_id ?? null
  } catch {
    // No body = process all orgs
  }

  const admin = createAdminClient()

  // Fetch orgs
  let orgQuery = admin.from('organisations').select('id, name, plan')
  if (targetOrgId) orgQuery = orgQuery.eq('id', targetOrgId)
  const { data: orgs, error: orgError } = await orgQuery

  if (orgError) {
    return jsonResponse({ error: `Failed to fetch organisations: ${orgError.message}` }, 500)
  }
  if (!orgs || orgs.length === 0) {
    return jsonResponse({ message: 'No organisations found', processed: 0 }, 200)
  }

  // Pre-fetch all auth users once (expensive call, do it once)
  const allAuthUsers: Map<string, { last_sign_in_at: string | null }> = new Map()
  try {
    const { data: authData } = await admin.auth.admin.listUsers()
    for (const u of authData?.users ?? []) {
      allAuthUsers.set(u.id, { last_sign_in_at: u.last_sign_in_at ?? null })
    }
  } catch (err) {
    console.error('Failed to list auth users:', err)
    // Continue without login data
  }

  // Check if counterparties table exists (may not be in schema yet)
  let counterpartiesTableExists = true
  try {
    await admin.from('counterparties').select('id', { count: 'exact', head: true }).limit(0)
  } catch {
    counterpartiesTableExists = false
  }
  // Also check if the query returns an error (Supabase client doesn't always throw)
  const counterpartiesProbe = await admin.from('counterparties').select('id', { count: 'exact', head: true }).limit(0)
  if (counterpartiesProbe.error) {
    counterpartiesTableExists = false
  }

  const now = new Date()
  let processed = 0
  const errors: Array<{ org_id: string; error: string }> = []

  for (const org of orgs) {
    try {
      const result = await computeOrgHealth(admin, org.id, now, allAuthUsers, counterpartiesTableExists)

      const { error: upsertError } = await admin.from('customer_health_scores').upsert({
        org_id: org.id,
        overall_score: result.overallScore,
        status: result.status,
        dimensions: result.dimensions,
        gaps: result.gaps,
        computed_at: now.toISOString(),
      }, { onConflict: 'org_id' })

      if (upsertError) {
        errors.push({ org_id: org.id, error: upsertError.message })
      } else {
        processed++
      }
    } catch (err) {
      errors.push({ org_id: org.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return jsonResponse({
    message: 'Health scores computed',
    processed,
    total: orgs.length,
    errors: errors.length > 0 ? errors : undefined,
  }, 200)
})

// ── Per-org health computation ───────────────────────────────

type AdminClient = ReturnType<typeof createAdminClient>

async function computeOrgHealth(
  admin: AdminClient,
  orgId: string,
  now: Date,
  allAuthUsers: Map<string, { last_sign_in_at: string | null }>,
  counterpartiesTableExists: boolean,
): Promise<{ overallScore: number; status: HealthStatus; dimensions: HealthDimensions; gaps: Gap[] }> {

  const gaps: Gap[] = []

  // ── Fetch all data in parallel ──────────────────────────────

  const [
    policyResult,
    exposureCountResult,
    latestExposureResult,
    entityCountResult,
    bankAccountCountResult,
    hedgeCountResult,
    onboardingResult,
    coverageResult,
    expiringHedgesResult,
    profilesResult,
    counterpartyCountResult,
  ] = await Promise.all([
    // Hedge policy
    admin.from('hedge_policies').select('min_coverage_pct').eq('org_id', orgId).eq('active', true).maybeSingle(),

    // Exposure count
    admin.from('fx_exposures').select('id', { count: 'exact', head: true }).eq('org_id', orgId),

    // Latest exposure created_at
    admin.from('fx_exposures').select('created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle(),

    // Entity count
    admin.from('entities').select('id', { count: 'exact', head: true }).eq('org_id', orgId),

    // Bank account count
    admin.from('bank_accounts').select('id', { count: 'exact', head: true }).eq('org_id', orgId),

    // Hedge position count (active)
    admin.from('hedge_positions').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'active'),

    // Onboarding session
    admin.from('onboarding_sessions').select('status, updated_at').eq('org_id', orgId).order('updated_at', { ascending: false }).limit(1).maybeSingle(),

    // Coverage data
    admin.from('v_hedge_coverage').select('currency_pair, coverage_pct').eq('org_id', orgId),

    // Expiring hedges (active, value_date within 14 days, not rolled)
    admin.from('hedge_positions')
      .select('id, value_date, rolled_from_id')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .lte('value_date', new Date(now.getTime() + 14 * 86400000).toISOString().split('T')[0])
      .gte('value_date', now.toISOString().split('T')[0]),

    // Profiles for login check
    admin.from('profiles').select('id').eq('org_id', orgId),

    // Counterparties (may not exist)
    counterpartiesTableExists
      ? admin.from('counterparties').select('id', { count: 'exact', head: true }).eq('org_id', orgId)
      : Promise.resolve({ count: null, error: null }),
  ])

  const exposureCount = exposureCountResult.count ?? 0
  const entityCount = entityCountResult.count ?? 0
  const bankAccountCount = bankAccountCountResult.count ?? 0
  const hedgeCount = hedgeCountResult.count ?? 0
  const counterpartyCount = counterpartyCountResult.count ?? 0
  const hasPolicy = !!policyResult.data
  const policy = policyResult.data
  const coverageData = coverageResult.data ?? []
  const expiringHedges = expiringHedgesResult.data ?? []
  const onboarding = onboardingResult.data
  const profiles = profilesResult.data ?? []

  // ── Gap detection ───────────────────────────────────────────

  // Critical gaps
  if (!hasPolicy) {
    gaps.push({ type: 'no_hedge_policy', severity: 'critical', message: 'No active hedge policy configured' })
  }
  if (exposureCount === 0) {
    gaps.push({ type: 'no_exposures', severity: 'critical', message: 'No FX exposures recorded' })
  }
  if (entityCount === 0) {
    gaps.push({ type: 'no_entities', severity: 'critical', message: 'No legal entities configured' })
  }

  // Warning gaps
  let staleExposureDays = 0
  if (latestExposureResult.data?.created_at) {
    const lastCreated = new Date(latestExposureResult.data.created_at)
    staleExposureDays = Math.floor((now.getTime() - lastCreated.getTime()) / 86400000)
    if (staleExposureDays > 14) {
      gaps.push({ type: 'stale_exposures', severity: 'warning', message: `Last exposure created ${staleExposureDays} days ago` })
    }
  }

  if (hedgeCount === 0 && exposureCount > 0) {
    gaps.push({ type: 'no_hedges', severity: 'warning', message: 'Exposures exist but no active hedges' })
  }

  if (onboarding && onboarding.status !== 'live') {
    const updatedAt = new Date(onboarding.updated_at)
    const stalledDays = Math.floor((now.getTime() - updatedAt.getTime()) / 86400000)
    if (stalledDays > 7) {
      gaps.push({ type: 'onboarding_stalled', severity: 'warning', message: `Onboarding stalled at "${onboarding.status}" for ${stalledDays} days` })
    }
  }

  // Coverage below policy
  if (hasPolicy && policy?.min_coverage_pct && coverageData.length > 0) {
    const underCoveredPairs = coverageData.filter(c => (c.coverage_pct ?? 0) < policy.min_coverage_pct)
    if (underCoveredPairs.length > 0) {
      const pairList = underCoveredPairs.map(c => c.currency_pair).join(', ')
      gaps.push({ type: 'coverage_below_policy', severity: 'warning', message: `Pairs below policy minimum: ${pairList}` })
    }
  }

  // Expiring hedges (no roll booked = rolled_from_id is null on THIS position, meaning it hasn't been rolled into a new one)
  // We need positions expiring soon that have NOT been rolled forward.
  // A position that has been rolled will have status='rolled', so since we filter status='active', these are un-rolled.
  const expiringCount = expiringHedges.length
  if (expiringCount > 0) {
    gaps.push({ type: 'hedges_expiring_soon', severity: 'warning', message: `${expiringCount} active position(s) expiring within 14 days` })
  }

  // Low gaps
  if (bankAccountCount === 0) {
    gaps.push({ type: 'no_bank_accounts', severity: 'low', message: 'No bank accounts configured' })
  }
  if (counterpartiesTableExists && counterpartyCount === 0) {
    gaps.push({ type: 'no_counterparties', severity: 'low', message: 'No counterparties configured' })
  }

  // No recent login
  let mostRecentLoginDaysAgo: number | null = null
  if (profiles.length > 0) {
    let latestLogin: Date | null = null
    for (const profile of profiles) {
      const authUser = allAuthUsers.get(profile.id)
      if (authUser?.last_sign_in_at) {
        const loginDate = new Date(authUser.last_sign_in_at)
        if (!latestLogin || loginDate > latestLogin) {
          latestLogin = loginDate
        }
      }
    }
    if (latestLogin) {
      mostRecentLoginDaysAgo = Math.floor((now.getTime() - latestLogin.getTime()) / 86400000)
      if (mostRecentLoginDaysAgo > 21) {
        gaps.push({ type: 'no_recent_login', severity: 'low', message: `Last login ${mostRecentLoginDaysAgo} days ago` })
      }
    } else {
      // No login data at all
      mostRecentLoginDaysAgo = null
    }
  }

  // ── Dimension scoring ───────────────────────────────────────

  // data_completeness: starts at 100
  let dataCompleteness = 100
  if (!hasPolicy) dataCompleteness -= 30
  if (exposureCount === 0) dataCompleteness -= 30
  if (entityCount === 0) dataCompleteness -= 20
  if (bankAccountCount === 0) dataCompleteness -= 10
  if (counterpartiesTableExists && counterpartyCount === 0) dataCompleteness -= 10
  dataCompleteness = Math.max(0, dataCompleteness)

  // data_freshness: starts at 100
  let dataFreshness = 100
  if (exposureCount === 0) {
    dataFreshness -= 40
  } else if (staleExposureDays > 14) {
    dataFreshness -= Math.min(50, staleExposureDays * 2)
  }
  if (hedgeCount === 0 && exposureCount > 0) {
    dataFreshness -= 30
  }
  if (mostRecentLoginDaysAgo === null && profiles.length > 0) {
    // No login data available
    dataFreshness -= 30
  } else if (mostRecentLoginDaysAgo !== null && mostRecentLoginDaysAgo > 21) {
    dataFreshness -= Math.min(30, mostRecentLoginDaysAgo)
  }
  dataFreshness = Math.max(0, dataFreshness)

  // coverage_health: starts at 100
  let coverageHealth = 100
  if (exposureCount > 0 && coverageData.length === 0) {
    coverageHealth = 0
  } else if (hasPolicy && policy?.min_coverage_pct && coverageData.length > 0) {
    const deficits = coverageData
      .map(c => Math.max(0, policy.min_coverage_pct - (c.coverage_pct ?? 0)))
      .filter(d => d > 0)
    if (deficits.length > 0) {
      const avgDeficit = deficits.reduce((sum, d) => sum + d, 0) / deficits.length
      coverageHealth -= Math.min(100, avgDeficit * 2)
    }
  }
  coverageHealth = Math.max(0, coverageHealth)

  // onboarding_progress
  let onboardingProgress: number
  if (!onboarding) {
    onboardingProgress = 0
  } else {
    onboardingProgress = ONBOARDING_STATUS_SCORES[onboarding.status] ?? 0
    // Additional penalty for stalled onboarding
    if (onboarding.status !== 'live') {
      const updatedAt = new Date(onboarding.updated_at)
      const stalledDays = Math.floor((now.getTime() - updatedAt.getTime()) / 86400000)
      if (stalledDays > 7) {
        onboardingProgress = Math.max(0, onboardingProgress - Math.min(20, stalledDays - 7))
      }
    }
  }
  onboardingProgress = Math.max(0, onboardingProgress)

  // position_risk: starts at 100
  let positionRisk = 100
  if (expiringCount > 0) {
    positionRisk -= Math.min(100, expiringCount * 25)
  }
  positionRisk = Math.max(0, positionRisk)

  // ── Overall score ───────────────────────────────────────────

  const dimensions: HealthDimensions = {
    data_completeness: dataCompleteness,
    data_freshness: dataFreshness,
    coverage_health: coverageHealth,
    onboarding_progress: onboardingProgress,
    position_risk: positionRisk,
  }

  const overallScore = Math.round(
    dimensions.data_completeness * DIMENSION_WEIGHTS.data_completeness +
    dimensions.data_freshness * DIMENSION_WEIGHTS.data_freshness +
    dimensions.coverage_health * DIMENSION_WEIGHTS.coverage_health +
    dimensions.onboarding_progress * DIMENSION_WEIGHTS.onboarding_progress +
    dimensions.position_risk * DIMENSION_WEIGHTS.position_risk
  )

  let status: HealthStatus
  if (overallScore >= 80) status = 'healthy'
  else if (overallScore >= 50) status = 'needs_attention'
  else status = 'at_risk'

  return { overallScore, status, dimensions, gaps }
}
