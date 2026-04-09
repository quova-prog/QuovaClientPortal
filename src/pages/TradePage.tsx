import { useState, useEffect } from 'react'
import { CheckCircle, Download, Shield, Search, X, AlertTriangle, Clock } from 'lucide-react'
import { useHedgePositions, useFxRates } from '@/hooks/useData'
import { useLiveFxRates } from '@/hooks/useLiveFxRates'
import { useCombinedCoverage } from '@/hooks/useCombinedCoverage'
import { useEntity } from '@/context/EntityContext'
import { formatCurrency, formatDate, daysUntil } from '@/lib/utils'

type TabKey = 'summary' | 'blotter' | 'management'
type SummaryView = 'overview' | 'rfq' | 'executed'
type ActionType = 'roll' | 'amend' | 'close'

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  return [headers.map(csvEscape).join(','), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(','))].join('\n')
}

function triggerDownload(filename: string, content: string) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// toUsd imported from @/lib/fx — do not define locally
// Kept as thin wrapper for call-site compatibility (ratesMap param name)
import { toUsd as _toUsd } from '@/lib/fx'
function toUsd(amount: number, currency: string, ratesMap: Record<string, number>): number {
  return _toUsd(amount, currency, ratesMap)
}

// MTM P&L in quote currency (e.g. USD for EUR/USD)
function getMtmPnl(notional: number, direction: string, contracted: number, spot: number): number {
  return direction === 'buy'
    ? notional * (spot - contracted)
    : notional * (contracted - spot)
}

// Simulate live dealer quotes from current spot + spreads
function getDealerQuotes(pair: string, spot: number) {
  const pip = pair.includes('JPY') ? 0.01 : 0.0001
  const dp = pair.includes('JPY') ? 2 : 4
  const raw = [
    { bank: 'Goldman Sachs',  tier: 'Tier 1', spread: 2.5 },
    { bank: 'JPMorgan Chase', tier: 'Tier 1', spread: 3.2 },
    { bank: 'Citibank',       tier: 'Tier 1', spread: 4.0 },
  ].map(d => ({ ...d, rate: +(spot + d.spread * pip).toFixed(dp), bestRate: false }))
  const minRate = Math.min(...raw.map(q => q.rate))
  raw.forEach(q => { q.bestRate = q.rate === minRate })
  return raw
}

function positionStatusLabel(s: string): { label: string; cls: string } {
  return {
    active:    { label: 'Active',    cls: 'badge-teal'  },
    expired:   { label: 'Settled',   cls: 'badge-green' },
    cancelled: { label: 'Cancelled', cls: 'badge-red'   },
  }[s] ?? { label: s, cls: 'badge-gray' }
}

function instrumentLabel(t: string) {
  return { forward: 'Forward', swap: 'FX Swap', option: 'Option', spot: 'Spot' }[t] ?? t
}

function settlementDaysBadge(valueDate: string) {
  const days = daysUntil(valueDate)
  if (days < 0)   return <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Matured</span>
  if (days === 0) return <span style={{ fontSize: '0.75rem', color: 'var(--amber)', fontWeight: 600 }}>Today</span>
  if (days <= 7)  return <span style={{ fontSize: '0.75rem', color: 'var(--red)',   fontWeight: 600 }}>{days}d</span>
  if (days <= 30) return <span style={{ fontSize: '0.75rem', color: 'var(--amber)', fontWeight: 600 }}>{days}d</span>
  return <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{days}d</span>
}

function BankLogo({ name }: { name: string }) {
  const colors: Record<string, string> = {
    'Goldman Sachs': '#3d6be8', 'JPMorgan Chase': '#00a0dc', 'Citibank': '#ee1c25',
  }
  return (
    <div style={{ width: 32, height: 32, borderRadius: '50%', background: colors[name] ?? '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0 }}>
      {name[0]}
    </div>
  )
}

export function TradePage() {
  const [tab, setTab] = useState<TabKey>('summary')
  const [summaryView, setSummaryView] = useState<SummaryView>('overview')
  const [rfqCoverage, setRfqCoverage] = useState<any | null>(null)
  const [selectedDealer, setSelectedDealer] = useState<string | null>(null)
  const [countdownSecs, setCountdownSecs] = useState(4 * 60 + 32)
  const [blotterSearch, setBlotterSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'expired' | 'cancelled'>('all')
  const [actionModal, setActionModal] = useState<{ type: ActionType; position: any } | null>(null)
  const [closingConfirmed, setClosingConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { positions, loading: positionsLoading, addPosition, refresh: refreshPositions } = useHedgePositions()
  const { currentEntityId } = useEntity()
  const { ratesMap: liveRatesMap } = useLiveFxRates()
  const { combinedCoverage } = useCombinedCoverage()
  const { rates: dbFxRates } = useFxRates()
  // Prefer live rates; fall back to Supabase stored rates
  const fxRates = Object.keys(liveRatesMap).length > 0 ? liveRatesMap : dbFxRates

  // Countdown ticks only while RFQ is active
  useEffect(() => {
    if (summaryView !== 'rfq' || countdownSecs <= 0) return
    const id = setInterval(() => setCountdownSecs(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [summaryView, countdownSecs])

  const countdownDisplay = countdownSecs > 0
    ? `${Math.floor(countdownSecs / 60)}:${String(countdownSecs % 60).padStart(2, '0')}`
    : 'Expired'

  const activePositions = positions.filter(p => p.status === 'active')

  // Enrich active positions with live MTM data
  const positionsWithMtm = activePositions.map(p => {
    const spot = liveRatesMap[p.currency_pair] ?? p.contracted_rate
    const mtmQuote = getMtmPnl(p.notional_base, p.direction, p.contracted_rate, spot)
    // Convert MTM from quote currency to USD
    const quoteCcy = p.currency_pair.split('/')[1] ?? 'USD'
    const mtmUsd = toUsd(Math.abs(mtmQuote), quoteCcy, fxRates) * (mtmQuote >= 0 ? 1 : -1)
    return { ...p, spot, mtmUsd }
  })

  const totalMtmUsd = positionsWithMtm.reduce((s, p) => s + p.mtmUsd, 0)

  // Exposure offset: for a direct 1:1 forward the underlying exposure moves equal and
  // opposite to the instrument. We calculate it per-position using spot_rate_at_trade
  // so the offset is anchored to the same inception point as the hedge MTM.
  const exposureOffsetUsd = positionsWithMtm.reduce((s, p) => {
    const inceptionSpot = (p as any).spot_rate_at_trade ?? p.contracted_rate
    const currentSpot   = p.spot
    const quoteCcy      = p.currency_pair.split('/')[1] ?? 'USD'
    // Exposure moves opposite to instrument: if instrument gained, exposure lost, and vice versa
    const exposureMoveQuote = p.direction === 'buy'
      ? p.notional_base * (inceptionSpot - currentSpot)   // opposite of buy-forward gain
      : p.notional_base * (currentSpot - inceptionSpot)   // opposite of sell-forward gain
    const exposureMoveUsd = toUsd(Math.abs(exposureMoveQuote), quoteCcy, fxRates) * (exposureMoveQuote >= 0 ? 1 : -1)
    return s + exposureMoveUsd
  }, 0)

  // Net economic impact: hedge MTM + offsetting exposure MTM (≈ $0 for a well-hedged portfolio)
  const netEconomicMtmUsd = totalMtmUsd + exposureOffsetUsd

  // Exposures with meaningful unhedged amount
  const unhedgedExposures = combinedCoverage.filter(c => Math.abs(c.net_exposure) > 100)

  const totalUnhedgedUsd = unhedgedExposures.reduce((s, c) => {
    const unhedged = Math.max(Math.abs(c.net_exposure) - c.total_hedged, 0)
    return s + toUsd(unhedged, c.base_currency, fxRates)
  }, 0)

  // RFQ derived values
  const rfqPair = rfqCoverage ? rfqCoverage.currency_pair : ''
  const rfqSpot = rfqPair
    ? (liveRatesMap[rfqPair] || (() => { const rev = rfqPair.split('/').reverse().join('/'); return liveRatesMap[rev] ? 1 / liveRatesMap[rev] : 0 })())
    : 0
  const dealerQuotes = rfqPair && rfqSpot > 0 ? getDealerQuotes(rfqPair, rfqSpot) : []
  const executedQuote = dealerQuotes.find(q => q.bank === selectedDealer)

  function startRfq(coverage: any) {
    setRfqCoverage(coverage)
    setCountdownSecs(4 * 60 + 32)
    setSelectedDealer(null)
    setSaveError(null)
    setSummaryView('rfq')
  }

  async function executeTrade(bank: string, rate: number) {
    if (!rfqCoverage || saving) return
    setSaving(true)
    setSaveError(null)

    const today = new Date()
    const tradeDate = today.toISOString().split('T')[0]
    const settle = new Date(today)
    settle.setDate(settle.getDate() + 90)
    const valueDate = settle.toISOString().split('T')[0]

    const [base, quote] = rfqPair.split('/')
    const notional = Math.abs(rfqCoverage.net_exposure)
    const ref = `ORB-${Date.now().toString(36).toUpperCase().slice(-8)}`

    const { error } = await addPosition({
      instrument_type: 'forward',
      hedge_type: 'cash_flow',
      currency_pair: rfqPair,
      base_currency: base,
      quote_currency: quote,
      direction: rfqCoverage.net_exposure < 0 ? 'buy' : 'sell',
      notional_base: notional,
      notional_usd: toUsd(notional, base, fxRates),
      contracted_rate: rate,
      spot_rate_at_trade: rfqSpot > 0 ? rfqSpot : null,
      trade_date: tradeDate,
      value_date: valueDate,
      counterparty_bank: bank,
      reference_number: ref,
      status: 'active',
      notes: `Executed via RFQ · ${bank}`,
      ...(currentEntityId ? { entity_id: currentEntityId } : {}),
    } as any)

    setSaving(false)

    if (error) {
      setSaveError(error)
      return
    }

    setSelectedDealer(bank)
    setSummaryView('executed')
    await refreshPositions()
  }

  const filteredPositions = positions.filter(p => {
    const matchSearch = !blotterSearch || [
      p.currency_pair,
      p.counterparty_bank ?? '',
      p.reference_number ?? '',
      p.instrument_type,
    ].some(s => s.toLowerCase().includes(blotterSearch.toLowerCase()))
    const matchStatus = statusFilter === 'all' || p.status === statusFilter
    return matchSearch && matchStatus
  })

  const totalNotional = filteredPositions.reduce((s, p) => s + toUsd(p.notional_base, p.base_currency, fxRates), 0)

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'summary',    label: 'Summary'       },
    { key: 'blotter',    label: 'Trade Blotter' },
    { key: 'management', label: 'Management'    },
  ]

  return (
    <>
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Trade</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Monitor position P&L and request new hedge quotes</p>
        </div>
      </div>

      <div style={{ padding: '1.5rem 1.5rem 0' }}>
        <div className="tab-bar">
          {tabs.map(t => (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 1.5rem 1.5rem' }}>

        {/* ── SUMMARY TAB ──────────────────────────────────────────────── */}
        {tab === 'summary' && (
          <>
            {/* ── MTM Context Banner ───────────────────────────────── */}
            <div style={{
              marginBottom: '0.875rem',
              padding: '0.625rem 0.875rem',
              borderRadius: 'var(--r-sm)',
              background: 'rgba(99,102,241,0.07)',
              border: '1px solid rgba(99,102,241,0.18)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
            }}>
              <AlertTriangle size={14} style={{ color: '#6366f1', marginTop: 2, flexShrink: 0 }} />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
                <strong style={{ color: 'var(--text)' }}>Understanding Portfolio MTM: </strong>
                The Hedge Instrument MTM reflects the change in fair value of your forwards and options only.
                A negative number here is <em>expected and normal</em> — it means rates moved in a direction that benefits your underlying exposures.
                The Exposure Offset shows the approximate equal-and-opposite gain on the hedged items.
                Net Economic Impact is the true combined effect.
              </p>
            </div>

            {/* ── KPI tiles ────────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.625rem', marginBottom: '1rem' }}>

              {/* Hedge Instrument MTM */}
              <div className="card" style={{ padding: '0.875rem', gridColumn: 'span 2' }}>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginBottom: '0.25rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Hedge Instrument MTM
                </div>
                <div style={{ fontSize: '1.375rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: totalMtmUsd >= 0 ? 'var(--green)' : 'var(--text-secondary)' }}>
                  {totalMtmUsd >= 0 ? '+' : ''}{formatCurrency(totalMtmUsd, 'USD', true)}
                </div>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  FV change on forwards &amp; options
                </div>
              </div>

              {/* Exposure Offset */}
              <div className="card" style={{ padding: '0.875rem', gridColumn: 'span 2' }}>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginBottom: '0.25rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Exposure Offset (est.)
                </div>
                <div style={{ fontSize: '1.375rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: exposureOffsetUsd >= 0 ? 'var(--green)' : 'var(--text-secondary)' }}>
                  {exposureOffsetUsd >= 0 ? '+' : ''}{formatCurrency(exposureOffsetUsd, 'USD', true)}
                </div>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Offsetting gain/loss on hedged items
                </div>
              </div>

              {/* Net Economic Impact */}
              <div className="card" style={{
                padding: '0.875rem',
                background: 'rgba(20,184,166,0.06)',
                border: `1px solid ${Math.abs(netEconomicMtmUsd) < 10_000 ? 'rgba(20,184,166,0.25)' : 'rgba(239,68,68,0.25)'}`,
              }}>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginBottom: '0.25rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Net Economic Impact
                </div>
                <div style={{ fontSize: '1.375rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: Math.abs(netEconomicMtmUsd) < 50_000 ? 'var(--teal)' : netEconomicMtmUsd >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {netEconomicMtmUsd >= 0 ? '+' : ''}{formatCurrency(netEconomicMtmUsd, 'USD', true)}
                </div>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Combined hedge + exposure
                </div>
              </div>

              {/* Active Positions */}
              <div className="card" style={{ padding: '0.875rem' }}>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginBottom: '0.25rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Active Positions</div>
                <div style={{ fontSize: '1.375rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--teal)' }}>
                  {activePositions.length}
                </div>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>open hedge contracts</div>
              </div>

              {/* Unhedged Exposure */}
              <div className="card" style={{ padding: '0.875rem' }}>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginBottom: '0.25rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Unhedged Exposure</div>
                <div style={{ fontSize: '1.375rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: totalUnhedgedUsd > 0 ? 'var(--amber)' : 'var(--green)' }}>
                  {formatCurrency(totalUnhedgedUsd, 'USD', true)}
                </div>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  {unhedgedExposures.length} pair{unhedgedExposures.length !== 1 ? 's' : ''} unhedged
                </div>
              </div>
            </div>

            {/* OVERVIEW */}
            {summaryView === 'overview' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem' }}>
                {/* Left: MTM table */}
                <div className="card" style={{ padding: 0 }}>
                  <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Position Mark-to-Market</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Live spot vs contracted rate</span>
                  </div>

                  {positionsLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
                      <div className="spinner" style={{ width: 24, height: 24 }} />
                    </div>
                  ) : positionsWithMtm.length === 0 ? (
                    <div className="empty-state" style={{ padding: '3rem' }}>
                      <Shield size={32} />
                      <h3>No active positions</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Request a quote to open your first hedge position.</p>
                    </div>
                  ) : (
                    <>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Position</th>
                            <th className="text-right">Notional</th>
                            <th className="text-right">Contracted</th>
                            <th className="text-right">Live Spot</th>
                            <th className="text-right">MTM P&L</th>
                            <th>Settlement</th>
                          </tr>
                        </thead>
                        <tbody>
                          {positionsWithMtm.map(p => (
                            <tr key={p.id}>
                              <td>
                                <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
                                  {p.currency_pair}
                                </div>
                                <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', marginTop: '0.125rem' }}>
                                  <span className={`badge badge-${p.direction === 'buy' ? 'green' : 'blue'}`} style={{ fontSize: '0.65rem' }}>
                                    {p.direction === 'buy' ? '↑ Buy' : '↓ Sell'}
                                  </span>
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{instrumentLabel(p.instrument_type)}</span>
                                </div>
                              </td>
                              <td className="text-right mono">{formatCurrency(p.notional_base, p.base_currency)}</td>
                              <td className="text-right mono" style={{ fontSize: '0.8125rem' }}>{p.contracted_rate.toFixed(4)}</td>
                              <td className="text-right mono" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                                {p.spot.toFixed(4)}
                              </td>
                              <td className="text-right mono" style={{ fontWeight: 700, color: p.mtmUsd >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                {p.mtmUsd >= 0 ? '+' : ''}{formatCurrency(p.mtmUsd, 'USD', true)}
                              </td>
                              <td>
                                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{formatDate(p.value_date)}</div>
                                <div style={{ marginTop: '0.125rem' }}>{settlementDaysBadge(p.value_date)}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{ padding: '0.625rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                          {positionsWithMtm.length} active position{positionsWithMtm.length !== 1 ? 's' : ''}
                        </span>
                        <span style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: totalMtmUsd >= 0 ? 'var(--green)' : 'var(--text-secondary)' }}>
                          Instrument MTM: {totalMtmUsd >= 0 ? '+' : ''}{formatCurrency(totalMtmUsd, 'USD', true)}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Right: Unhedged exposures */}
                <div className="card" style={{ padding: 0 }}>
                  <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Unhedged Exposures</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Initiate a quote to hedge open positions</div>
                  </div>

                  {unhedgedExposures.length === 0 ? (
                    <div className="empty-state" style={{ padding: '2.5rem' }}>
                      <CheckCircle size={28} color="var(--green)" />
                      <h3 style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>All exposures hedged</h3>
                      <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No open positions require hedging.</p>
                    </div>
                  ) : (
                    <div>
                      {unhedgedExposures.map(c => {
                        const unhedgedAmt = Math.max(Math.abs(c.net_exposure) - c.total_hedged, 0)
                        const unhedgedUsd = toUsd(unhedgedAmt, c.base_currency, fxRates)
                        const spot = liveRatesMap[`${c.base_currency}/USD`]
                          ?? (liveRatesMap[`USD/${c.base_currency}`] ? 1 / liveRatesMap[`USD/${c.base_currency}`] : undefined)
                        const covPct = c.coverage_pct ?? 0
                        return (
                          <div key={c.base_currency} style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                                  <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
                                    {c.base_currency}/USD
                                  </span>
                                  <span className={`badge badge-${covPct < 25 ? 'red' : 'amber'}`} style={{ fontSize: '0.65rem' }}>
                                    {covPct.toFixed(0)}% covered
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {formatCurrency(unhedgedAmt, c.base_currency)} open
                                  {spot ? ` · ${spot.toFixed(4)}` : ''}
                                  {unhedgedUsd > 0 && <span style={{ color: 'var(--text-secondary)' }}> ≈ {formatCurrency(unhedgedUsd, 'USD', true)}</span>}
                                </div>
                                {/* Coverage bar */}
                                <div style={{ marginTop: '0.5rem', height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${Math.min(covPct, 100)}%`, background: covPct < 25 ? 'var(--red)' : 'var(--amber)', borderRadius: 2 }} />
                                </div>
                              </div>
                              <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}
                                onClick={() => startRfq(c)}>
                                Request Quote
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* RFQ */}
            {summaryView === 'rfq' && rfqCoverage && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {/* Left: Exposure detail */}
                <div className="card" style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Exposure to Hedge</span>
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => { setSummaryView('overview'); setRfqCoverage(null) }}>
                      <X size={13} /> Cancel
                    </button>
                  </div>

                  <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', padding: '1rem', marginBottom: '1rem' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                      {rfqPair}
                    </div>
                    {[
                      ['Instrument',       'FX Forward'],
                      ['Net Exposure',     formatCurrency(Math.abs(rfqCoverage.net_exposure), rfqCoverage.base_currency)],
                      ['Currently Hedged', `${(rfqCoverage.coverage_pct ?? 0).toFixed(1)}%`],
                      ['Live Spot',        rfqSpot > 0 ? rfqSpot.toFixed(4) : '—'],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: '0.375rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                        <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{value}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem',
                    background: countdownSecs > 60 ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${countdownSecs > 60 ? '#bbf7d0' : '#fecaca'}`,
                    borderRadius: 'var(--r-md)',
                  }}>
                    <Clock size={14} color={countdownSecs > 60 ? 'var(--green)' : 'var(--red)'} />
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: countdownSecs > 60 ? 'var(--green)' : 'var(--red)' }}>
                      Quote valid for {countdownDisplay}
                    </span>
                  </div>
                </div>

                {/* Right: Dealer quotes */}
                <div className="card" style={{ padding: '1.25rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Dealer Quotes</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                    Rates based on live {rfqPair} spot · Click to accept
                  </div>

                  {dealerQuotes.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                      No live rate available for {rfqPair}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {dealerQuotes.map(q => (
                        <div key={q.bank}
                          style={{
                            border: `2px solid ${q.bestRate ? 'var(--teal)' : 'var(--border)'}`,
                            borderRadius: 'var(--r-md)', padding: '1rem',
                            background: q.bestRate ? 'rgba(20,184,166,0.04)' : 'transparent',
                            cursor: countdownSecs > 0 && !saving ? 'pointer' : 'not-allowed',
                            opacity: countdownSecs > 0 && !saving ? 1 : 0.5,
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                          }}
                          onClick={() => {
                            if (countdownSecs <= 0 || saving) return
                            executeTrade(q.bank, q.rate)
                          }}>
                          <BankLogo name={q.bank} />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.125rem' }}>
                              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{q.bank}</span>
                              {q.bestRate && <span className="badge badge-teal" style={{ fontSize: '0.65rem' }}>Best Rate</span>}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{q.tier}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.125rem' }}>
                              {q.rate.toFixed(rfqPair.includes('JPY') ? 2 : 4)}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>offered rate</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {saveError && (
                    <div style={{ marginTop: '0.75rem', padding: '0.625rem 0.75rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: '0.8125rem', color: '#ef4444' }}>
                      {saveError}
                    </div>
                  )}
                  {saving && (
                    <div style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                      Executing trade…
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* EXECUTED */}
            {summaryView === 'executed' && rfqCoverage && (
              <div style={{ maxWidth: 480, margin: '0 auto' }}>
                <div className="card fade-in" style={{ padding: '2rem', textAlign: 'center' }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: '#f0fdf4', border: '2px solid var(--green)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem',
                  }}>
                    <CheckCircle size={28} color="var(--green)" />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '1.0625rem', marginBottom: '0.25rem' }}>Trade Executed</div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                    Hedge confirmed with {selectedDealer}
                  </div>

                  <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', padding: '1rem', marginBottom: '1.5rem', textAlign: 'left' }}>
                    {[
                      ['Instrument',    'FX Forward'],
                      ['Currency Pair', rfqPair],
                      ['Notional',      formatCurrency(Math.abs(rfqCoverage.net_exposure), rfqCoverage.base_currency)],
                      ['Rate',          executedQuote ? executedQuote.rate.toFixed(rfqPair.includes('JPY') ? 2 : 4) : '—'],
                      ['Counterparty',  selectedDealer ?? '—'],
                      ['Reference',     `ORB-${Date.now().toString(36).toUpperCase().slice(-8)}`],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: '0.375rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                        <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{value}</span>
                      </div>
                    ))}
                  </div>

                  <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => { setSummaryView('overview'); setRfqCoverage(null); setSelectedDealer(null) }}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── BLOTTER TAB ──────────────────────────────────────────────── */}
        {tab === 'blotter' && (
          <div>
            <div className="card" style={{ padding: 0 }}>
              {/* Toolbar */}
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search size={14} style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="input"
                    style={{ paddingLeft: '2rem', fontSize: '0.8125rem' }}
                    placeholder="Search pair, counterparty, reference…"
                    value={blotterSearch}
                    onChange={e => setBlotterSearch(e.target.value)}
                  />
                </div>
                <select className="input" style={{ width: 'auto', fontSize: '0.8125rem' }}
                  value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="expired">Settled</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              {positionsLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
                  <div className="spinner" style={{ width: 24, height: 24 }} />
                </div>
              ) : filteredPositions.length === 0 ? (
                <div className="empty-state" style={{ padding: '3rem' }}>
                  <Shield size={32} />
                  <h3>No positions found</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    {positions.length === 0 ? 'No hedge positions have been recorded yet.' : 'No results match your filters.'}
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Reference</th>
                          <th>Trade Date</th>
                          <th>Pair</th>
                          <th>Instrument</th>
                          <th>Direction</th>
                          <th className="text-right">Notional</th>
                          <th className="text-right">Rate</th>
                          <th>Counterparty</th>
                          <th>Settlement</th>
                          <th>Due In</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPositions.map(p => {
                          const { label, cls } = positionStatusLabel(p.status)
                          return (
                            <tr key={p.id}>
                              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                {p.reference_number || `ORB-${p.id.slice(0, 8).toUpperCase()}`}
                              </td>
                              <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                                {formatDate(p.trade_date)}
                              </td>
                              <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                                {p.currency_pair}
                              </td>
                              <td>
                                <span className="badge badge-gray">{instrumentLabel(p.instrument_type)}</span>
                              </td>
                              <td>
                                <span className={`badge badge-${p.direction === 'buy' ? 'green' : 'blue'}`}>
                                  {p.direction === 'buy' ? '↑ Buy' : '↓ Sell'}
                                </span>
                              </td>
                              <td className="text-right mono" style={{ fontWeight: 600 }}>
                                {formatCurrency(p.notional_base, p.base_currency)}
                              </td>
                              <td className="text-right mono" style={{ fontSize: '0.8125rem' }}>
                                {p.contracted_rate.toFixed(4)}
                              </td>
                              <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                                {p.counterparty_bank ?? '—'}
                              </td>
                              <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                                {formatDate(p.value_date)}
                              </td>
                              <td>{settlementDaysBadge(p.value_date)}</td>
                              <td><span className={`badge ${cls}`}>{label}</span></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8125rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {filteredPositions.length} position{filteredPositions.length !== 1 ? 's' : ''}
                        {(blotterSearch || statusFilter !== 'all') && positions.length !== filteredPositions.length && ` of ${positions.length}`}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        Total notional: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {formatCurrency(totalNotional, 'USD', true)}
                        </span>
                      </span>
                    </div>
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => {
                        const rows = filteredPositions.map(p => ({
                          Reference:    p.reference_number || `ORB-${p.id.slice(0, 8).toUpperCase()}`,
                          'Trade Date': p.trade_date,
                          Pair:         p.currency_pair,
                          Type:         p.instrument_type,
                          Direction:    p.direction,
                          Notional:     p.notional_base.toFixed(2),
                          Currency:     p.base_currency,
                          Rate:         p.contracted_rate.toFixed(6),
                          Counterparty: p.counterparty_bank ?? '',
                          Settlement:   p.value_date,
                          Status:       p.status,
                        }))
                        triggerDownload(`trade_blotter_${new Date().toISOString().split('T')[0]}.csv`, toCsv(rows))
                      }}>
                      <Download size={13} /> Export CSV
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── MANAGEMENT TAB ───────────────────────────────────────────── */}
        {tab === 'management' && (
          <div>
            {/* Summary tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
              {[
                { label: 'Active Positions',  value: positions.filter(p => p.status === 'active').length,                                                    color: 'var(--teal)',        cls: 'badge-teal'  },
                { label: 'Maturing ≤30 days', value: positions.filter(p => { const d = daysUntil(p.value_date); return d >= 0 && d <= 30 }).length,           color: 'var(--amber)',       cls: 'badge-amber' },
                { label: 'Settled / Expired', value: positions.filter(p => daysUntil(p.value_date) < 0).length,                                              color: 'var(--text-muted)', cls: 'badge-gray'  },
              ].map(t => (
                <div key={t.label} className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '2rem', fontFamily: 'var(--font-mono)', color: t.color }}>{t.value}</div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{t.label}</div>
                </div>
              ))}
            </div>

            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Position Lifecycle</span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{positions.length} position{positions.length !== 1 ? 's' : ''}</span>
              </div>

              {positionsLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
                  <div className="spinner" style={{ width: 24, height: 24 }} />
                </div>
              ) : positions.length === 0 ? (
                <div className="empty-state" style={{ padding: '3rem' }}>
                  <Shield size={32} />
                  <h3>No positions to manage</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Add hedge positions to manage their lifecycle.</p>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th className="text-right">Notional</th>
                      <th>Settlement</th>
                      <th>Due In</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(p => {
                      const days = daysUntil(p.value_date)
                      const matured = days < 0
                      return (
                        <tr key={p.id}>
                          <td>
                            <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{p.currency_pair}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {p.instrument_type} · {p.counterparty_bank ?? 'No counterparty'} · {p.reference_number || `ORB-${p.id.slice(0, 8).toUpperCase()}`}
                            </div>
                          </td>
                          <td className="text-right mono" style={{ fontWeight: 500 }}>{formatCurrency(p.notional_base, p.base_currency)}</td>
                          <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>{formatDate(p.value_date)}</td>
                          <td>
                            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: matured ? 'var(--text-muted)' : days <= 7 ? 'var(--red)' : days <= 30 ? 'var(--amber)' : 'var(--teal-dark)' }}>
                              {matured ? 'Matured' : days === 0 ? 'Today' : `${days}d`}
                            </span>
                          </td>
                          <td><span className={`badge ${positionStatusLabel(p.status).cls}`}>{positionStatusLabel(p.status).label}</span></td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.375rem' }}>
                              <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem' }}
                                title="Roll forward to a new settlement date"
                                onClick={() => setActionModal({ type: 'roll', position: p })}>
                                Roll
                              </button>
                              <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem' }}
                                title="Amend notional or rate"
                                onClick={() => setActionModal({ type: 'amend', position: p })}>
                                Amend
                              </button>
                              {!matured && (
                                <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', color: 'var(--red)', borderColor: 'var(--red)' }}
                                  title="Close this position early"
                                  onClick={() => { setClosingConfirmed(false); setActionModal({ type: 'close', position: p }) }}>
                                  Close
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

      </div>
    </div>

    {/* ── Position Action Modal ─────────────────────────────────────────── */}
    {actionModal && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
        <div className="card fade-in" style={{ width: '100%', maxWidth: 440, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>
                {actionModal.type === 'roll' ? '↻ Roll Position' : actionModal.type === 'amend' ? '✏️ Amend Position' : '✕ Close Position Early'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {actionModal.position.currency_pair} · {formatCurrency(actionModal.position.notional_base, actionModal.position.base_currency, true)}
              </div>
            </div>
            <button onClick={() => setActionModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <X size={18} />
            </button>
          </div>

          <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', padding: '0.75rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {[
              ['Reference',   actionModal.position.reference_number || `ORB-${actionModal.position.id.slice(0, 8).toUpperCase()}`],
              ['Counterparty', actionModal.position.counterparty_bank ?? '—'],
              ['Settlement',  formatDate(actionModal.position.value_date)],
              ['Rate',        actionModal.position.contracted_rate.toFixed(4)],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{value}</span>
              </div>
            ))}
          </div>

          {actionModal.type === 'close' && !closingConfirmed ? (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--r-md)', padding: '0.75rem', marginBottom: '1rem' }}>
                <AlertTriangle size={15} color="var(--red)" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: '0.8125rem', color: '#b91c1c', margin: 0 }}>
                  Closing this position early may result in a mark-to-market loss. This action cannot be undone.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setActionModal(null)}>Cancel</button>
                <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center', background: 'var(--red)', color: '#fff', border: 'none' }}
                  onClick={() => setClosingConfirmed(true)}>
                  Confirm Close
                </button>
              </div>
            </>
          ) : actionModal.type === 'close' && closingConfirmed ? (
            <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
              <CheckCircle size={32} color="var(--green)" style={{ marginBottom: '0.5rem' }} />
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Close request submitted</div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>Your close request has been sent to your counterparty for confirmation.</p>
              <button className="btn btn-ghost btn-sm" onClick={() => setActionModal(null)}>Done</button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                {actionModal.type === 'roll'
                  ? 'Rolling will extend this position to a new settlement date at the current forward rate. Contact your counterparty to confirm new terms.'
                  : 'Amending allows you to adjust the notional amount or rate. Changes require counterparty approval before taking effect.'}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setActionModal(null)}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setActionModal(null)}>
                  Submit Request
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </>
  )
}
