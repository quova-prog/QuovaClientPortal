import { useEffect, useRef } from 'react'
import { useAlerts } from './useAlerts'
import { useHedgePositions, useExposures, useDashboardMetrics, useHedgePolicy } from './useData'
import { useCashFlows } from './useCashFlows'
import { useCombinedCoverage } from './useCombinedCoverage'
import { useLiveFxRates } from './useLiveFxRates'
import { toUsd } from '@/lib/fx'

/** Format a USD amount for alert body copy */
function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

/** Sanitise a currency pair for use as an alert_key suffix */
function pairKey(pair: string) {
  return pair.replace(/\//g, '_').toLowerCase()
}

export function useAlertGenerator() {
  const { upsertAlert, resolveAlert, reload, canWrite } = useAlerts()
  const { positions }                                    = useHedgePositions()
  const { exposures }                                    = useExposures()
  const { metrics }                                      = useDashboardMetrics()
  const { policy }                                       = useHedgePolicy()
  const { flows }                                        = useCashFlows()
  const { combinedCoverage }                             = useCombinedCoverage()
  const { ratesMap }                                     = useLiveFxRates()

  // Re-evaluate whenever the coverage fingerprint changes, not just once per session.
  // A fingerprint encodes every pair's coverage_pct and net_exposure rounded to integers
  // so minor floating-point drift doesn't cause unnecessary re-runs.
  const lastFingerprintRef = useRef<string>('')

  useEffect(() => {
    if (!metrics || !positions || !exposures || !canWrite) return
    if (combinedCoverage.length === 0) return

    // Bind to local consts so TypeScript knows they're non-null inside generate()
    const _metrics = metrics
    const _positions = positions

    // Build a stable fingerprint of the current coverage state
    const fingerprint = combinedCoverage
      .slice()
      .sort((a, b) => a.currency_pair.localeCompare(b.currency_pair))
      .map(c => `${c.currency_pair}:${Math.round(c.coverage_pct)}:${Math.round(Math.abs(c.net_exposure))}`)
      .join('|')

    if (lastFingerprintRef.current === fingerprint) return
    lastFingerprintRef.current = fingerprint

    const minNotionalUsd = policy?.min_notional_threshold ?? 100_000
    const minCoveragePct = policy?.min_coverage_pct ?? 85

    async function generate() {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const in7  = new Date(today.getTime() + 7  * 86400000)
      const in30 = new Date(today.getTime() + 30 * 86400000)

      // ── 1. Policy breach: overall under-hedged ──────────────
      if (_metrics.coverage_status === 'under_hedged') {
        await upsertAlert({
          alert_key: 'policy_breach_under',
          type: 'policy_breach',
          severity: 'urgent',
          title: 'Hedge Coverage Below Policy Minimum',
          body: `Overall coverage is ${_metrics.overall_coverage_pct.toFixed(1)}% — below your ${minCoveragePct}% policy minimum. Review open exposures and add hedges.`,
          href: '/hedge',
          metadata: { coverage_pct: _metrics.overall_coverage_pct },
        })
      } else {
        await resolveAlert('policy_breach_under')
      }

      // ── 2. Policy breach: overall over-hedged ───────────────
      if (_metrics.coverage_status === 'over_hedged') {
        await upsertAlert({
          alert_key: 'policy_breach_over',
          type: 'policy_breach',
          severity: 'warning',
          title: 'Hedge Coverage Exceeds Policy Maximum',
          body: `Overall coverage is ${_metrics.overall_coverage_pct.toFixed(1)}% — above your policy maximum. Consider reducing hedge positions.`,
          href: '/hedge',
          metadata: { coverage_pct: _metrics.overall_coverage_pct },
        })
      } else {
        await resolveAlert('policy_breach_over')
      }

      // ── 3. Per-currency unhedged / under-hedged alerts ──────
      // This is the core intelligence gap: fire for every pair that is
      // above the notional threshold and below policy coverage.
      // Covers BOTH real (fx_exposures) AND derived (CSV-uploaded) pairs
      // since combinedCoverage includes both.
      const activePairKeys = new Set<string>()

      for (const c of combinedCoverage) {
        const exposureUsd = toUsd(Math.abs(c.net_exposure), c.base_currency, ratesMap)
        if (exposureUsd < minNotionalUsd) continue   // below materiality threshold — skip

        const unhedgedUsd = toUsd(c.unhedged_amount, c.base_currency, ratesMap)
        const isFullyUnhedged = c.coverage_pct < 1       // 0% (or essentially zero)
        const isBelowPolicy   = c.coverage_pct < minCoveragePct

        if (!isBelowPolicy) {
          // Pair is compliant — resolve any stale alert for it
          await resolveAlert(`unhedged_pair_${pairKey(c.currency_pair)}`)
          continue
        }

        activePairKeys.add(pairKey(c.currency_pair))

        // Severity: urgent for fully unhedged large exposures, warning otherwise
        const severity: 'urgent' | 'warning' =
          isFullyUnhedged && exposureUsd >= 1_000_000 ? 'urgent' : 'warning'

        const coverageStr = c.coverage_pct.toFixed(1) + '%'
        const title = isFullyUnhedged
          ? `${c.currency_pair} Exposure Completely Unhedged`
          : `${c.currency_pair} Coverage Below Policy Minimum`

        const body = isFullyUnhedged
          ? `${fmtUsd(exposureUsd)} in ${c.currency_pair} exposure has ${coverageStr} hedge coverage. ` +
            `Policy requires ${minCoveragePct}%. Go to Hedge Advisor to generate a trade recommendation.`
          : `${c.currency_pair} hedge coverage is ${coverageStr} — below the ${minCoveragePct}% policy minimum. ` +
            `${fmtUsd(unhedgedUsd)} remains unhedged.`

        await upsertAlert({
          alert_key: `unhedged_pair_${pairKey(c.currency_pair)}`,
          type: 'unhedged_exposure',
          severity,
          title,
          body,
          href: '/advisor',
          metadata: {
            currency_pair:  c.currency_pair,
            exposure_usd:   exposureUsd,
            unhedged_usd:   unhedgedUsd,
            coverage_pct:   c.coverage_pct,
            policy_min_pct: minCoveragePct,
          },
        })
      }

      // Resolve per-pair alerts for pairs now back in compliance
      // (We iterate all existing combinedCoverage pairs to clean up stale keys)
      for (const c of combinedCoverage) {
        if (!activePairKeys.has(pairKey(c.currency_pair))) {
          await resolveAlert(`unhedged_pair_${pairKey(c.currency_pair)}`)
        }
      }

      // ── 4. Maturing positions (within 7 days) — urgent ──────
      const maturing = _positions.filter(p => {
        if (!p.value_date || p.status !== 'active') return false
        const mat = new Date(p.value_date)
        return mat >= today && mat <= in7
      })
      for (const p of maturing) {
        const daysLeft = Math.ceil((new Date(p.value_date).getTime() - today.getTime()) / 86400000)
        await upsertAlert({
          alert_key: `maturing_${p.id}`,
          type: 'maturing_position',
          severity: 'urgent',
          title: `Hedge Maturing in ${daysLeft} Day${daysLeft !== 1 ? 's' : ''}`,
          body: `${p.instrument_type} ${p.currency_pair} for ${p.notional_base?.toLocaleString() ?? '—'} matures on ${p.value_date}. Review and roll if needed.`,
          href: '/hedges',
          metadata: { position_id: p.id, value_date: p.value_date },
        })
      }

      const maturingIds = new Set(maturing.map(p => p.id))
      for (const p of _positions.filter(p => p.status === 'active')) {
        if (!maturingIds.has(p.id)) await resolveAlert(`maturing_${p.id}`)
      }

      // ── 5. Maturing positions (within 30 days) — warning ────
      const maturingSoon = _positions.filter(p => {
        if (!p.value_date || p.status !== 'active') return false
        const mat = new Date(p.value_date)
        return mat > in7 && mat <= in30
      })
      for (const p of maturingSoon) {
        await upsertAlert({
          alert_key: `maturing_soon_${p.id}`,
          type: 'maturing_position',
          severity: 'warning',
          title: 'Hedge Maturing Within 30 Days',
          body: `${p.instrument_type} ${p.currency_pair} for ${p.notional_base?.toLocaleString() ?? '—'} matures on ${p.value_date}.`,
          href: '/hedges',
          metadata: { position_id: p.id, value_date: p.value_date },
        })
      }

      // ── 6. Large cash flows due within 7 days ───────────────
      const urgentFlows = flows.filter(f => {
        const d = new Date(f.flow_date)
        return d >= today && d <= in7 && Math.abs(f.amount) >= 500_000
      })
      for (const f of urgentFlows) {
        await upsertAlert({
          alert_key: `cashflow_due_${f.id}`,
          type: 'cash_flow_due',
          severity: 'warning',
          title: `Large Cash ${f.flow_type === 'inflow' ? 'Inflow' : 'Outflow'} Due This Week`,
          body: `${f.currency} ${Math.abs(f.amount).toLocaleString()} ${f.flow_type} on ${f.flow_date}${f.counterparty ? ` — ${f.counterparty}` : ''}.`,
          href: '/upload',
          metadata: { flow_id: f.id, amount: f.amount, currency: f.currency },
        })
      }

      await reload()
    }

    generate()
  // Re-run whenever coverage data, positions, or rates change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, positions, exposures, flows, combinedCoverage, ratesMap, canWrite, policy])
}
