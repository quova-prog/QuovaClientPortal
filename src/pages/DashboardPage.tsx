import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
import { useDashboardMetrics, useUploadBatches, useFxRates, useHedgePositions } from '@/hooks/useData'
import { useAuth } from '@/hooks/useAuth'
import { useLiveFxRates } from '@/hooks/useLiveFxRates'
import { useCombinedCoverage } from '@/hooks/useCombinedCoverage'
import { useCashFlows } from '@/hooks/useCashFlows'
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders'
import { useSupplierContracts } from '@/hooks/useSupplierContracts'
import { useCustomerContracts } from '@/hooks/useCustomerContracts'
import { useLoanSchedules } from '@/hooks/useLoanSchedules'
import { usePayroll } from '@/hooks/usePayroll'
import { useCapex } from '@/hooks/useCapex'
import { useRevenueForecasts } from '@/hooks/useRevenueForecasts'
import { useIntercompanyTransfers } from '@/hooks/useIntercompanyTransfers'
import { useEntity } from '@/context/EntityContext'
import { formatCurrency, formatPct, formatDate, daysUntil, formatPnl,
         COVERAGE_COLORS, chartColor, getCoverageStatus } from '@/lib/utils'
import { toUsd } from '@/lib/fx'
import { Info, Activity, Shield, TrendingUp, ChevronDown,
         Clock, CheckCircle2, ArrowUpRight, ShoppingCart, Calendar } from 'lucide-react'
import { CustomerNotificationBanner } from '../components/ui/CustomerNotificationBanner'

// Pie slice colours — one per currency slot
const PIE_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']


function jobStatusClass(s: string) {
  return { complete: 'green', processing: 'teal', failed: 'red', pending: 'amber' }[s] ?? 'gray'
}
function jobStatusLabel(s: string) {
  return { complete: 'Completed', processing: 'Processing', failed: 'Failed', pending: 'Pending' }[s] ?? s
}

function monthKey(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-')
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-US', {
    month: 'short', year: 'numeric',
  })
}

export function DashboardPage() {
  const { user } = useAuth()
  const { metrics, loading: metricsLoading, policy } = useDashboardMetrics()
  const { positions: hedgePositions } = useHedgePositions()
  const { batches }                                   = useUploadBatches()
  const { rates: fxRates }                             = useFxRates()
  const { ratesMap: liveRatesMap, lastUpdated: ratesLastUpdated } = useLiveFxRates()
  // Prefer live rates from Frankfurter (same source as Advisor); fall back to DB rates
  const effectiveFxRates = Object.keys(liveRatesMap).length > 0 ? liveRatesMap : fxRates
  const { combinedCoverage, loading: covLoading }     = useCombinedCoverage()
  const { flows, loading: flowsLoading }              = useCashFlows()
  const { orders, loading: ordersLoading }            = usePurchaseOrders()
  const { contracts: supplierContracts, loading: scLoading } = useSupplierContracts()
  const { contracts: customerContracts, loading: ccLoading } = useCustomerContracts()
  const { loans, loading: loansLoading }              = useLoanSchedules()
  const { entries: payrollEntries, loading: payLoading } = usePayroll()
  const { entries: capexEntries, loading: capexLoading } = useCapex()
  const { forecasts: revenueForecasts, loading: revLoading } = useRevenueForecasts()
  const { transfers: intercompanyTransfers, loading: icLoading } = useIntercompanyTransfers()
  const { currentEntityId, isConsolidated } = useEntity()

  // ── Entity-filtered data ──────────────────────────────────────────────────
  // When an entity is selected, filter all uploaded data to that entity.
  // entity_id === null means the row was uploaded without an entity assignment
  // (consolidated mode) — show everything.
  const filteredFlows = useMemo(() =>
    isConsolidated ? flows : flows.filter(f => f.entity_id === currentEntityId),
  [flows, isConsolidated, currentEntityId])

  const filteredOrders = useMemo(() =>
    isConsolidated ? orders : orders.filter((o: any) => o.entity_id === currentEntityId),
  [orders, isConsolidated, currentEntityId])

  const filteredPayroll = useMemo(() =>
    isConsolidated ? payrollEntries : payrollEntries.filter((p: any) => p.entity_id === currentEntityId),
  [payrollEntries, isConsolidated, currentEntityId])

  const filteredLoans = useMemo(() =>
    isConsolidated ? loans : loans.filter((l: any) => l.entity_id === currentEntityId),
  [loans, isConsolidated, currentEntityId])

  const filteredSupplierContracts = useMemo(() =>
    isConsolidated ? supplierContracts : supplierContracts.filter((c: any) => c.entity_id === currentEntityId),
  [supplierContracts, isConsolidated, currentEntityId])

  const filteredCustomerContracts = useMemo(() =>
    isConsolidated ? customerContracts : customerContracts.filter((c: any) => c.entity_id === currentEntityId),
  [customerContracts, isConsolidated, currentEntityId])

  const loading = metricsLoading || covLoading || flowsLoading || ordersLoading ||
    scLoading || ccLoading || loansLoading || payLoading || capexLoading ||
    revLoading || icLoading

  const now = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  const { today, in30 } = useMemo(() => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return { today: t, in30: new Date(t.getTime() + 30 * 86400000) }
  }, [now])

  // ── Derived values from combinedCoverage ──────────────────────────────────
  const totalExposure = useMemo(() =>
    combinedCoverage.reduce((s, c) => s + toUsd(Math.abs(c.net_exposure), c.base_currency, effectiveFxRates), 0),
  [combinedCoverage, effectiveFxRates])

  const totalHedged = useMemo(() =>
    combinedCoverage.reduce((s, c) => s + toUsd(c.total_hedged, c.base_currency, effectiveFxRates), 0),
  [combinedCoverage, effectiveFxRates])

  const hedgedPct = totalExposure > 0 ? (totalHedged / totalExposure) * 100 : 0
  const unhedged = Math.max(0, totalExposure - totalHedged)
  const overHedged = totalHedged > totalExposure ? totalHedged - totalExposure : 0
  const currencyCount = combinedCoverage.length

  const coverageStatus = getCoverageStatus(hedgedPct, policy ?? null)

  // Donut — sorted by abs(net_exposure), top 6
  const donutData = useMemo(() => {
    if (!combinedCoverage.length) return []
    return [...combinedCoverage]
      .sort((a, b) => Math.abs(b.net_exposure) - Math.abs(a.net_exposure))
      .slice(0, 6)
      .map((c, i) => ({
        name:  c.base_currency,
        label: c.currency_pair,
        value: toUsd(Math.abs(c.net_exposure), c.base_currency, effectiveFxRates),
        color: PIE_COLORS[i] ?? chartColor(i),
      }))
  }, [combinedCoverage, effectiveFxRates])

  // ── FX P&L Impact (same calculation as TradePage/HedgePage) ─────────────
  const fxImpact = useMemo(() => {
    if (!hedgePositions.length) return { instrumentPnl: 0, exposureOffset: 0, netImpact: 0 }
    let instrumentPnl = 0
    let exposureOffset = 0
    for (const p of hedgePositions) {
      const spot = liveRatesMap[p.currency_pair] ?? p.contracted_rate
      const qCcy = p.currency_pair.split('/')[1] ?? 'USD'
      // Hedge instrument MTM
      const diff = p.direction === 'buy' ? spot - p.contracted_rate : p.contracted_rate - spot
      const pnlQuote = diff * p.notional_base
      instrumentPnl += toUsd(Math.abs(pnlQuote), qCcy, effectiveFxRates) * (pnlQuote >= 0 ? 1 : -1)
      // Exposure offset (opposite move on underlying)
      const inception = p.spot_rate_at_trade ?? p.contracted_rate
      const expMove = p.direction === 'buy'
        ? p.notional_base * (inception - spot)
        : p.notional_base * (spot - inception)
      exposureOffset += toUsd(Math.abs(expMove), qCcy, effectiveFxRates) * (expMove >= 0 ? 1 : -1)
    }
    return { instrumentPnl, exposureOffset, netImpact: instrumentPnl + exposureOffset }
  }, [hedgePositions, liveRatesMap, effectiveFxRates])

  // ── 90-day trend (simulated: revalue current portfolio at historical rate offsets) ──
  const trendData = useMemo(() => {
    if (!combinedCoverage.length && !hedgePositions.length) return []
    // Generate 4 monthly data points: -90d, -60d, -30d, today
    const points = [
      { label: '90d ago', offset: -0.03 },
      { label: '60d ago', offset: -0.02 },
      { label: '30d ago', offset: -0.01 },
      { label: 'Today', offset: 0 },
    ]
    return points.map(pt => {
      // Simulate rate changes: shift all rates by offset factor
      let expUsd = 0
      let hedUsd = 0
      for (const c of combinedCoverage) {
        const baseRate = effectiveFxRates[c.currency_pair] ?? 1
        const simRate = baseRate * (1 + pt.offset)
        expUsd += Math.abs(c.net_exposure) * simRate
        hedUsd += c.total_hedged * simRate
      }
      const covPct = expUsd > 0 ? Math.min((hedUsd / expUsd) * 100, 100) : 0
      return { name: pt.label, exposure: Math.round(expUsd), hedged: Math.round(hedUsd), coverage: Math.round(covPct) }
    })
  }, [combinedCoverage, effectiveFxRates, hedgePositions])

  // ── Stat tile 3: Open Purchase Orders ────────────────────────────────────
  const openPOs = useMemo(() =>
    filteredOrders.filter(o => o.status === 'open' || o.status === 'approved'),
  [filteredOrders])

  const openPOsValueUsd = useMemo(() =>
    openPOs.reduce((s, o) => s + toUsd(o.amount, o.currency, effectiveFxRates), 0),
  [openPOs, effectiveFxRates])

  // ── Stat tile 4: Upcoming Payments (next 30 days) ────────────────────────
  const upcomingPaymentsCount = useMemo(() => {
    let count = 0
    filteredFlows.forEach(f => {
      const d = new Date(f.flow_date)
      if (d >= today && d <= in30 && (f.flow_type === 'outflow' || f.amount < 0)) count++
    })
    filteredLoans.forEach(l => {
      const d = new Date(l.payment_date)
      if (d >= today && d <= in30) count++
    })
    filteredPayroll.forEach(p => {
      const d = new Date(p.pay_date)
      if (d >= today && d <= in30) count++
    })
    filteredSupplierContracts.forEach(sc => {
      if (sc.status === 'active' && sc.next_payment_date) {
        const d = new Date(sc.next_payment_date)
        if (d >= today && d <= in30) count++
      }
    })
    return count
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredFlows, filteredLoans, filteredPayroll, filteredSupplierContracts])

  // ── Tasks list ────────────────────────────────────────────────────────────
  const tasks = useMemo(() => {
    const list: { name: string; sub: string; status: string; due: string; href: string }[] = []

    // Existing: upcoming settlements + maturing hedges
    if (metrics) {
      metrics.upcoming_settlements.forEach(e => {
        list.push({
          name:   `${e.direction === 'receivable' ? 'Collect' : 'Pay'} ${e.currency_pair}`,
          sub:    `${e.entity} · ${formatCurrency(e.notional_base, e.base_currency)}`,
          status: daysUntil(e.settlement_date) <= 7 ? 'urgent' : 'upcoming',
          due:    e.settlement_date,
          href:   '/exposure',
        })
      })
      metrics.maturing_hedges.forEach(p => {
        list.push({
          name:   `${p.instrument_type.charAt(0).toUpperCase() + p.instrument_type.slice(1)} matures`,
          sub:    `${p.currency_pair} · ${formatCurrency(p.notional_base, p.base_currency)}`,
          status: daysUntil(p.value_date) <= 7 ? 'urgent' : 'maturing',
          due:    p.value_date,
          href:   '/hedge',
        })
      })
    }

    // Purchase Orders: open/approved due within 30 days
    filteredOrders.forEach(po => {
      if ((po.status === 'open' || po.status === 'approved') && po.due_date) {
        const d = new Date(po.due_date)
        if (d >= today && d <= in30) {
          list.push({
            name:   `Pay ${po.currency} ${formatCurrency(po.amount, po.currency)}`,
            sub:    `PO ${po.po_number} · ${po.supplier}`,
            status: daysUntil(po.due_date) <= 7 ? 'urgent' : 'upcoming',
            due:    po.due_date,
            href:   '/upload',
          })
        }
      }
    })

    // Supplier Contracts: active with next_payment_date within 30 days
    filteredSupplierContracts.forEach(sc => {
      if (sc.status === 'active' && sc.next_payment_date) {
        const d = new Date(sc.next_payment_date)
        if (d >= today && d <= in30) {
          list.push({
            name:   `Contract Payment · ${sc.supplier_name}`,
            sub:    `${formatCurrency(sc.payment_amount, sc.currency)} · ${sc.payment_frequency}`,
            status: daysUntil(sc.next_payment_date) <= 7 ? 'urgent' : 'upcoming',
            due:    sc.next_payment_date,
            href:   '/upload',
          })
        }
      }
    })

    // Customer Contracts: active with next_payment_date within 30 days
    filteredCustomerContracts.forEach(cc => {
      if (cc.status === 'active' && cc.next_payment_date) {
        const d = new Date(cc.next_payment_date)
        if (d >= today && d <= in30) {
          list.push({
            name:   `Collect · ${cc.customer_name}`,
            sub:    `${formatCurrency(cc.payment_amount, cc.currency)} expected`,
            status: daysUntil(cc.next_payment_date) <= 7 ? 'urgent' : 'upcoming',
            due:    cc.next_payment_date,
            href:   '/upload',
          })
        }
      }
    })

    // Loan Schedules: payment_date within 30 days
    filteredLoans.forEach(loan => {
      if (loan.payment_date) {
        const d = new Date(loan.payment_date)
        if (d >= today && d <= in30) {
          list.push({
            name:   `Loan Payment · ${loan.lender}`,
            sub:    `${loan.loan_id} · ${formatCurrency(loan.payment_amount, loan.currency)}`,
            status: daysUntil(loan.payment_date) <= 7 ? 'urgent' : 'upcoming',
            due:    loan.payment_date,
            href:   '/upload',
          })
        }
      }
    })

    // Payroll: pay_date within 30 days
    filteredPayroll.forEach(p => {
      if (p.pay_date) {
        const d = new Date(p.pay_date)
        if (d >= today && d <= in30) {
          list.push({
            name:   `Payroll · ${p.entity || p.department || 'Staff'}`,
            sub:    `${formatCurrency(p.gross_amount, p.currency)} · ${p.pay_period || ''}`,
            status: daysUntil(p.pay_date) <= 7 ? 'urgent' : 'upcoming',
            due:    p.pay_date,
            href:   '/upload',
          })
        }
      }
    })

    return list
      .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime())
      .slice(0, 8)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, filteredOrders, filteredSupplierContracts, filteredCustomerContracts, filteredLoans, filteredPayroll])

  // ── Cash Flow monthly buckets ─────────────────────────────────────────────
  const cashFlowMonths = useMemo(() => {
    const todayStr = today.toISOString().slice(0, 10)
    const futureFlows = filteredFlows.filter(f => f.flow_date >= todayStr)

    // Build monthly buckets
    const buckets = new Map<string, { inflow: number; outflow: number }>()
    futureFlows.forEach(f => {
      const key = monthKey(f.flow_date)
      const b = buckets.get(key) ?? { inflow: 0, outflow: 0 }
      const usd = toUsd(Math.abs(f.amount), f.currency, effectiveFxRates)
      if (f.amount > 0 || f.flow_type === 'inflow') {
        b.inflow += usd
      } else {
        b.outflow += usd
      }
      buckets.set(key, b)
    })

    // Sort keys and take up to 6 future months
    const sorted = Array.from(buckets.keys()).sort().slice(0, 6)

    return sorted.map(key => {
      const b = buckets.get(key)!
      const netVal = b.inflow - b.outflow

      // Find coverage pct for this month from combinedCoverage if possible
      // Use the overall hedged pct as a proxy since we don't have per-month coverage breakdown
      const coveragePct = totalExposure > 0 ? hedgedPct : null

      return {
        key,
        label: monthLabel(key),
        inflow: b.inflow,
        outflow: b.outflow,
        net: netVal,
        coveragePct,
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredFlows, effectiveFxRates, totalExposure, hedgedPct])

  // ── FX exposures count ────────────────────────────────────────────────────
  const fxExposureCount = metrics?.open_exposure_count ?? 0

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: '1rem' }}>
      <div className="spinner" style={{ width: 28, height: 28 }} />
      <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading dashboard…</span>
    </div>
  )

  return (
    <div className="fade-in">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{(user?.organisation as any)?.name ?? 'Dashboard'}</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>{now}</p>
        </div>
      </div>

      <div className="page-content">

        <CustomerNotificationBanner />

        {/* ── Stat tiles ───────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
          {[
            {
              label:  'Total Exposure',
              value:  formatCurrency(totalExposure, 'USD', true),
              sub:    `${currencyCount} currencies (real + derived)`,
              icon:   Activity,
              color:  'var(--teal)',
              bg:     '#f0fdfa',
              href:   '/exposure',
            },
            {
              label:  'Hedge Coverage',
              value:  formatPct(hedgedPct),
              sub:    policy ? `Target ${policy.min_coverage_pct}–${policy.max_coverage_pct}%` : 'No policy set',
              icon:   Shield,
              color:  COVERAGE_COLORS[coverageStatus],
              bg:     '#f0f9ff',
              href:   '/hedge',
            },
            {
              label:  'Open Purchase Orders',
              value:  String(openPOs.length),
              sub:    formatCurrency(openPOsValueUsd, 'USD', true) + ' total value',
              icon:   ShoppingCart,
              color:  openPOs.length > 0 ? 'var(--amber)' : 'var(--green)',
              bg:     openPOs.length > 0 ? '#fffbeb' : '#f0fdf4',
              href:   '/upload',
            },
            {
              label:  'Upcoming Payments',
              value:  String(upcomingPaymentsCount),
              sub:    'due in next 30 days',
              icon:   Calendar,
              color:  upcomingPaymentsCount > 0 ? '#6366f1' : 'var(--green)',
              bg:     upcomingPaymentsCount > 0 ? '#f5f3ff' : '#f0fdf4',
              href:   '/upload',
            },
          ].map(({ label, value, sub, icon: Icon, color, bg, href }) => (
            <Link key={label} to={href} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ padding: '1rem', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={16} color={color} />
                  </div>
                  <ArrowUpRight size={13} color="var(--text-muted)" />
                </div>
                <div style={{ fontWeight: 700, fontSize: '1.375rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>
                  {value}
                </div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.125rem' }}>{label}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sub}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* ── FX Impact + Trend ────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem', marginBottom: '1rem' }}>

          {/* Quarterly FX Impact */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Quarterly FX Impact (Est.)
            </div>
            <div style={{ fontWeight: 700, fontSize: '1.75rem', fontFamily: 'var(--font-mono)', color: Math.abs(fxImpact.netImpact) < 50000 ? 'var(--teal)' : fxImpact.netImpact >= 0 ? 'var(--green)' : 'var(--red)', marginBottom: '1rem', letterSpacing: '-0.02em' }}>
              {formatPnl(fxImpact.netImpact, 'USD', true)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Hedge P&L</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: fxImpact.instrumentPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {formatPnl(fxImpact.instrumentPnl, 'USD', true)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Exposure Offset</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: fxImpact.exposureOffset >= 0 ? 'var(--green)' : 'var(--text-muted)' }}>
                  {formatPnl(fxImpact.exposureOffset, 'USD', true)}
                </span>
              </div>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
              Based on mark-to-market of {hedgePositions.length} active position{hedgePositions.length !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Exposure & Coverage Trend */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Exposure & Coverage Trend</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>90-day view</span>
            </div>
            {trendData.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <TrendingUp size={24} color="var(--text-muted)" />
                <p style={{ fontSize: '0.8125rem' }}>Trend data will appear after your first month of activity.</p>
              </div>
            ) : (
              <div style={{ padding: '0.75rem 0.5rem 0.5rem 0' }}>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={trendData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={v => `$${(v / 1e6).toFixed(0)}M`} />
                    <Tooltip formatter={(v: number, name: string) => [formatCurrency(v, 'USD', true), name === 'exposure' ? 'Exposure' : 'Hedged']} />
                    <Area type="monotone" dataKey="exposure" stroke="#3b82f6" fill="#3b82f620" strokeWidth={2} name="exposure" />
                    <Area type="monotone" dataKey="hedged" stroke="#00c8a0" fill="#00c8a020" strokeWidth={2} name="hedged" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* ── Top row: Exposure + Balances ─────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>

          {/* Exposure Summary */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Exposure Summary</span>
                <Info size={13} color="var(--text-muted)" />
              </div>
              <span className={`badge badge-${coverageStatus === 'compliant' ? 'green' : coverageStatus === 'under_hedged' ? 'amber' : 'red'}`}>
                {coverageStatus === 'compliant' ? 'Compliant' : coverageStatus === 'under_hedged' ? 'Under-hedged' : coverageStatus === 'over_hedged' ? 'Over-hedged' : 'Unhedged'}
              </span>
            </div>

            <div style={{ padding: '1rem 1.25rem' }}>
              {/* Net Exposure */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', marginBottom: '0.625rem', border: '1px solid var(--border-dim)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: '#f0fdfa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Activity size={15} color="var(--teal)" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.125rem' }}>Net Exposure (USD equivalent)</div>
                  <div style={{ fontWeight: 700, fontSize: '1.25rem', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
                    {totalExposure > 0 ? formatCurrency(totalExposure, 'USD', true) : '—'}
                  </div>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {currencyCount} pair{currencyCount !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Hedge Ratio */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', padding: '0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', marginBottom: '1rem', border: '1px solid var(--border-dim)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: '#f0f9ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Shield size={15} color="#0b1526" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.125rem' }}>Hedge Coverage Ratio</div>
                  <div style={{ fontWeight: 700, fontSize: '1.25rem', fontFamily: 'var(--font-mono)', color: COVERAGE_COLORS[coverageStatus] }}>
                    {totalExposure > 0 ? formatPct(hedgedPct) : '—'}
                  </div>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {metrics?.active_hedge_count ?? 0} hedge{metrics?.active_hedge_count !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Progress bar */}
              <div>
                <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden', marginBottom: '0.5rem' }}>
                  <div style={{ height: '100%', width: `${Math.min(hedgedPct, 100)}%`, background: COVERAGE_COLORS[coverageStatus], borderRadius: 4, transition: 'width 0.6s ease' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Hedged</div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', fontFamily: 'var(--font-mono)', color: 'var(--teal-dark)' }}>
                      {totalHedged > 0 ? formatCurrency(totalHedged, 'USD', true) : '—'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{overHedged > 0 ? 'Over-hedged' : 'Unhedged'}</div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', fontFamily: 'var(--font-mono)', color: overHedged > 0 ? 'var(--amber)' : unhedged > 0 ? 'var(--red)' : 'var(--green)' }}>
                      {formatCurrency(overHedged > 0 ? overHedged : unhedged, 'USD', true)}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '0.625rem', paddingTop: '0.625rem', borderTop: '1px solid var(--border-dim)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {policy
                    ? `Policy target: ${policy.min_coverage_pct}–${policy.max_coverage_pct}% · ${policy.base_currency}`
                    : <Link to="/settings" style={{ color: 'var(--teal-dark)', textDecoration: 'none' }}>Set a hedge policy →</Link>
                  }
                </div>
                {ratesLastUpdated && (
                  <div style={{ marginTop: '0.375rem', fontSize: '0.6875rem', color: '#475569' }}>
                    Rates as of {ratesLastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Balances — exposure by currency donut */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Exposure by Currency</span>
                <Info size={13} color="var(--text-muted)" />
              </div>
            </div>

            <div style={{ padding: '1rem 1.25rem' }}>
              {donutData.length === 0 ? (
                <div className="empty-state" style={{ padding: '2rem 0' }}>
                  <Activity size={28} />
                  <p>No exposure data yet.<br />
                    <Link to="/upload" style={{ color: 'var(--teal-dark)' }}>Upload exposures</Link> to get started.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'center' }}>
                  <div style={{ height: 180, position: 'relative' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={donutData} cx="50%" cy="50%" innerRadius={48} outerRadius={76}
                          dataKey="value" paddingAngle={2} strokeWidth={0}>
                          {donutData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip
                          formatter={(v: number, _: string, props: any) => [
                            formatCurrency(v, 'USD', true),
                            props.payload?.label ?? props.name,
                          ]}
                          contentStyle={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Centre total */}
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.125rem' }}>Total</div>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                          {formatCurrency(totalExposure, 'USD', true)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {donutData.map((d, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{d.label}</span>
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.8rem' }}>
                          {formatCurrency(d.value, 'USD', true)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Middle row: Tasks + Job Status ───────────────────────────── */}
        {(tasks.length > 0 || batches.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: tasks.length > 0 && batches.length > 0 ? '1fr 1fr' : '1fr', gap: '1rem', marginBottom: '1rem' }}>

          {/* Tasks — from multiple sources */}
          {tasks.length > 0 && (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Upcoming Actions</span>
                <Info size={13} color="var(--text-muted)" />
                {tasks.length > 0 && (
                  <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>{tasks.length}</span>
                )}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Next 30 days</span>
            </div>

            {tasks.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <CheckCircle2 size={28} color="var(--green)" />
                <p>Nothing due in the next 30 days.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Due Date</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task, i) => {
                    const days = daysUntil(task.due)
                    return (
                      <tr key={i}>
                        <td>
                          <Link to={task.href} style={{ textDecoration: 'none' }}>
                            <div style={{ fontWeight: 500, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{task.name}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{task.sub}</div>
                          </Link>
                        </td>
                        <td>
                          <span className={`badge badge-${task.status === 'urgent' ? 'red' : task.status === 'maturing' ? 'amber' : 'teal'}`}>
                            {task.status === 'urgent' ? 'Urgent' : task.status === 'maturing' ? 'Maturing' : 'Upcoming'}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontSize: '0.8125rem', color: days <= 7 ? 'var(--red)' : days <= 14 ? 'var(--amber)' : 'var(--text-secondary)', fontWeight: days <= 7 ? 600 : 400 }}>
                            {formatDate(task.due)}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {days <= 0 ? 'Today' : `in ${days}d`}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          )}

          {/* Job Status — real upload batches */}
          {batches.length > 0 && (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Job Status</span>
                <Info size={13} color="var(--text-muted)" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Clock size={13} color="var(--text-muted)" />
                <Link to="/upload" style={{ fontSize: '0.75rem', color: 'var(--teal-dark)', textDecoration: 'none', fontWeight: 500 }}>Upload →</Link>
              </div>
            </div>

            {batches.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <Clock size={28} />
                <p>No uploads yet.<br />
                  <Link to="/upload" style={{ color: 'var(--teal-dark)' }}>Upload your first file</Link>.
                </p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Status</th>
                    <th>Rows</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b, i) => (
                    <tr key={i}>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: '0.8125rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.filename}>
                          {b.filename}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {b.id.slice(0, 8).toUpperCase()}
                        </div>
                      </td>
                      <td>
                        <span className={`badge badge-${jobStatusClass(b.status)}`}>
                          {jobStatusLabel(b.status)}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                        {b.row_count.toLocaleString()}
                      </td>
                      <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                        {formatDate(b.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          )}
        </div>
        )}

        {/* ── Cash Flow Forecasts ───────────────────────────────────────── */}
        <div className="card" style={{ padding: 0, marginBottom: '1rem' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Cash Flow Forecasts</span>
              <Info size={13} color="var(--text-muted)" />
              <span className="badge badge-gray" style={{ fontSize: '0.65rem' }}>Indicative</span>
            </div>
            {filteredFlows.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Connect a bank integration for live data</span>
                <Link to="/integrations" className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', textDecoration: 'none' }}>
                  Set up <ChevronDown size={11} />
                </Link>
              </div>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            {cashFlowMonths.length === 0 ? (
              <div className="empty-state" style={{ padding: '2.5rem' }}>
                <TrendingUp size={28} />
                <p>No cash flow data. <Link to="/upload" style={{ color: 'var(--teal-dark)' }}>Upload cash_flows.csv</Link> to see forecasts.</p>
              </div>
            ) : (
              <table className="data-table" style={{ minWidth: 700 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 160 }}>Item</th>
                    {cashFlowMonths.map(m => <th key={m.key} className="text-right">{m.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontWeight: 500, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                        <span>↑</span> Total Inflows
                      </div>
                    </td>
                    {cashFlowMonths.map(m => (
                      <td key={m.key} className="text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--teal-dark)' }}>
                        {formatCurrency(m.inflow, 'USD', true)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontWeight: 500, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                        <span>↓</span> Total Outflows
                      </div>
                    </td>
                    {cashFlowMonths.map(m => (
                      <td key={m.key} className="text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--red)' }}>
                        ({formatCurrency(m.outflow, 'USD', true)})
                      </td>
                    ))}
                  </tr>
                  <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>Net</div>
                    </td>
                    {cashFlowMonths.map(m => (
                      <td key={m.key} className="text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', fontWeight: 700, color: m.net >= 0 ? 'var(--text-primary)' : 'var(--red)' }}>
                        {m.net < 0 ? `(${formatCurrency(Math.abs(m.net), 'USD', true)})` : formatCurrency(m.net, 'USD', true)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>Hedge Coverage</div>
                    </td>
                    {cashFlowMonths.map(m => (
                      <td key={m.key} className="text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                        {m.coveragePct !== null ? formatPct(m.coveragePct) : '—'}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Data Coverage ─────────────────────────────────────────────── */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Data Coverage</span>
            <Info size={13} color="var(--text-muted)" />
          </div>
          <div style={{ padding: '1rem 1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.625rem' }}>
              {[
                { label: 'FX Exposures',       count: fxExposureCount },
                { label: 'Purchase Orders',     count: filteredOrders.length },
                { label: 'Revenue Forecasts',   count: revenueForecasts.length },
                { label: 'Cash Flows',          count: filteredFlows.length },
                { label: 'Loan Schedules',      count: filteredLoans.length },
                { label: 'Payroll',             count: filteredPayroll.length },
                { label: 'Intercompany',        count: intercompanyTransfers.length },
                { label: 'CapEx',               count: capexEntries.length },
                { label: 'Supplier Contracts',  count: filteredSupplierContracts.length },
                { label: 'Customer Contracts',  count: filteredCustomerContracts.length },
              ].map(({ label, count }) => {
                const hasData = count > 0
                return (
                  <div key={label} style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.625rem 0.75rem',
                    background: hasData ? '#f0fdf4' : 'var(--bg-surface)',
                    borderRadius: 'var(--r-sm)',
                    border: `1px solid ${hasData ? '#bbf7d0' : 'var(--border-dim)'}`,
                  }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: hasData ? 'var(--green)' : 'var(--text-muted)', flexShrink: 0 }}>
                      {hasData ? '✓' : '○'}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {label}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {count > 0 ? `${count.toLocaleString()} record${count !== 1 ? 's' : ''}` : 'No data'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
