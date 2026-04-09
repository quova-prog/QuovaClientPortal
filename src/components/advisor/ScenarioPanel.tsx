import { useState, useCallback } from 'react'
import {
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Play,
  RefreshCw,
  X,
  Plus,
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import {
  PREDEFINED_SCENARIOS,
  runScenario,
  type Scenario,
  type ScenarioShock,
  type ScenarioRunResult,
  type PairScenarioResult,
} from '@/lib/scenarioEngine'
import type { CombinedCoverage } from '@/hooks/useCombinedCoverage'
import type { HedgePosition } from '@/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScenarioPanelProps {
  combinedCoverage: CombinedCoverage[]
  positions: HedgePosition[]
  ratesMap: Record<string, number>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function severityDotColor(severity: Scenario['severity']): string {
  if (severity === 'mild') return 'var(--teal)'
  if (severity === 'moderate') return 'var(--amber)'
  return 'var(--red)'
}

function severityCardTint(severity: Scenario['severity']): string {
  if (severity === 'mild') return 'rgba(20,184,166,0.05)'
  if (severity === 'moderate') return 'rgba(245,158,11,0.05)'
  return 'rgba(239,68,68,0.05)'
}

function fmtPct(val: number): string {
  const sign = val >= 0 ? '+' : ''
  return `${sign}${(val * 100).toFixed(1)}%`
}

function coverageColor(pct: number): string {
  if (pct >= 80) return 'var(--green)'
  if (pct >= 40) return 'var(--amber)'
  return 'var(--red)'
}

function impactColor(val: number): string {
  if (val > 0) return 'var(--green)'
  if (val < 0) return 'var(--red)'
  return 'var(--text-muted)'
}

// ─── Summary stat card ────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
  sub,
}: {
  label: string
  value: string
  color: string
  sub?: string
}) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-sm)',
        padding: '0.875rem 1rem',
      }}
    >
      <div
        style={{
          fontSize: '0.6875rem',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: '0.25rem',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontSize: '1.125rem',
          color,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ─── Scenario card ────────────────────────────────────────────────────────────

function ScenarioCard({
  scenario,
  isSelected,
  onSelect,
}: {
  scenario: Scenario
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        background: isSelected ? severityCardTint(scenario.severity) : 'var(--bg-card)',
        border: `1.5px solid ${isSelected ? severityDotColor(scenario.severity) : 'var(--border)'}`,
        borderRadius: 'var(--r-sm)',
        padding: '0.875rem',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
        boxShadow: isSelected ? `0 0 0 3px ${severityDotColor(scenario.severity)}22` : undefined,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.375rem',
          marginBottom: '0.375rem',
        }}
      >
        {/* Severity dot */}
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: severityDotColor(scenario.severity),
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontWeight: 700,
            fontSize: '0.8125rem',
            color: 'var(--text-primary)',
            flex: 1,
            lineHeight: 1.3,
          }}
        >
          {scenario.name}
        </span>
        {scenario.year && (
          <span
            style={{
              fontSize: '0.625rem',
              color: 'var(--text-muted)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '0.0625rem 0.375rem',
              flexShrink: 0,
            }}
          >
            {scenario.year}
          </span>
        )}
      </div>

      {/* Description */}
      <p
        style={{
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          margin: '0 0 0.5rem',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {scenario.description}
      </p>

      {/* Shock pills */}
      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
        {scenario.shocks.slice(0, 5).map((shock, i) => (
          <span
            key={i}
            style={{
              fontSize: '0.5625rem',
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '0.0625rem 0.3125rem',
              color: 'var(--text-secondary)',
            }}
          >
            {shock.label}
          </span>
        ))}
        {scenario.shocks.length > 5 && (
          <span
            style={{
              fontSize: '0.5625rem',
              color: 'var(--text-muted)',
              padding: '0.0625rem 0.25rem',
            }}
          >
            +{scenario.shocks.length - 5} more
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Results table row ────────────────────────────────────────────────────────

function ResultRow({
  row,
  index,
}: {
  row: PairScenarioResult
  index: number
}) {
  const isNoImpact = !row.shocked && Math.abs(row.netEconomicImpact) <= 100

  return (
    <tr
      style={{
        borderBottom: '1px solid var(--border)',
        background: index % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
        opacity: isNoImpact ? 0.45 : 1,
      }}
    >
      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.8125rem' }}>
        {row.currencyPair}
      </td>
      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
        {row.shocked ? (
          <span style={{ color: row.shockPct < 0 ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>
            {fmtPct(row.shockPct)}
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </td>
      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'right' }}>
        {formatCurrency(row.unhedgedCurrentUsd, 'USD', true)}
      </td>
      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', textAlign: 'right' }}>
        {isNoImpact ? (
          <span style={{ color: 'var(--text-muted)' }}>No impact</span>
        ) : (
          <span style={{ color: impactColor(row.unhedgedPnlImpact), fontWeight: 600 }}>
            {row.unhedgedPnlImpact >= 0 ? '+' : ''}{formatCurrency(row.unhedgedPnlImpact, 'USD', true)}
          </span>
        )}
      </td>
      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', textAlign: 'right', color: 'var(--text-muted)' }}>
        {Math.abs(row.hedgeInstrumentDelta) < 1
          ? '—'
          : `${row.hedgeInstrumentDelta >= 0 ? '+' : ''}${formatCurrency(row.hedgeInstrumentDelta, 'USD', true)}`}
      </td>
      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', textAlign: 'right' }}>
        {isNoImpact ? (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ) : (
          <span style={{ color: impactColor(row.netEconomicImpact), fontWeight: 600 }}>
            {row.netEconomicImpact >= 0 ? '+' : ''}{formatCurrency(row.netEconomicImpact, 'USD', true)}
          </span>
        )}
      </td>
      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: coverageColor(row.currentCoveragePct),
          }}
        >
          {row.currentCoveragePct.toFixed(0)}%
        </span>
      </td>
    </tr>
  )
}

// ─── Key Insight ──────────────────────────────────────────────────────────────

function KeyInsight({ result }: { result: ScenarioRunResult }) {
  const impact = result.netPortfolioImpact
  const nearZero = Math.abs(impact) < 5_000

  const worstPair = result.byPair
    .filter(r => r.shocked)
    .sort((a, b) => a.unhedgedPnlImpact - b.unhedgedPnlImpact)[0]

  if (nearZero) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.625rem',
          padding: '0.875rem 1rem',
          borderRadius: 'var(--r-sm)',
          background: 'rgba(20,184,166,0.06)',
          border: '1px solid rgba(20,184,166,0.2)',
          marginTop: '0.75rem',
        }}
      >
        <CheckCircle2 size={15} color="var(--teal)" style={{ marginTop: 1, flexShrink: 0 }} />
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
          Your hedged positions provide strong protection under this scenario. Net economic impact is approximately $0.
        </p>
      </div>
    )
  }

  if (impact < 0 && worstPair) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.625rem',
          padding: '0.875rem 1rem',
          borderRadius: 'var(--r-sm)',
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.2)',
          marginTop: '0.75rem',
        }}
      >
        <AlertTriangle size={15} color="var(--red)" style={{ marginTop: 1, flexShrink: 0 }} />
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
          Under this scenario, your unhedged{' '}
          <strong style={{ color: 'var(--text-primary)' }}>{worstPair.currencyPair}</strong>{' '}
          exposure would result in a{' '}
          <strong style={{ color: 'var(--red)' }}>
            {formatCurrency(Math.abs(worstPair.unhedgedPnlImpact), 'USD', true)} loss
          </strong>
          . Consider adding coverage via Hedge Advisor &rarr; Execute.
        </p>
      </div>
    )
  }

  // Positive impact (USD weakness / favorable move)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.625rem',
        padding: '0.875rem 1rem',
        borderRadius: 'var(--r-sm)',
        background: 'rgba(20,184,166,0.06)',
        border: '1px solid rgba(20,184,166,0.2)',
        marginTop: '0.75rem',
      }}
    >
      <TrendingUp size={15} color="var(--teal)" style={{ marginTop: 1, flexShrink: 0 }} />
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
        Under this scenario your portfolio would see a net gain of{' '}
        <strong style={{ color: 'var(--teal)' }}>
          {formatCurrency(impact, 'USD', true)}
        </strong>
        . Favorable FX moves benefit your unhedged positions.
      </p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ScenarioPanel({
  combinedCoverage,
  positions,
  ratesMap,
}: ScenarioPanelProps) {
  const [activeTab, setActiveTab] = useState<'prebuilt' | 'custom'>('prebuilt')
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null)
  const [result, setResult] = useState<ScenarioRunResult | null>(null)

  // Custom scenario state
  const [customShocks, setCustomShocks] = useState<ScenarioShock[]>([])
  const [customInput, setCustomInput] = useState<{
    currencyOrPair: string
    type: 'pct_change' | 'absolute_rate'
    value: string
  }>({ currencyOrPair: '', type: 'pct_change', value: '' })

  const ratesLoading = Object.keys(ratesMap).length === 0

  // ── Run handlers ──────────────────────────────────────────

  const handleRunPrebuilt = useCallback(() => {
    if (!selectedScenario) return
    const r = runScenario(selectedScenario, combinedCoverage, positions, ratesMap)
    setResult(r)
  }, [selectedScenario, combinedCoverage, positions, ratesMap])

  const handleRunCustom = useCallback(() => {
    if (customShocks.length === 0) return
    const customScenario: Scenario = {
      id: 'custom',
      name: 'Custom Scenario',
      category: 'custom',
      description: 'User-defined shock scenario.',
      severity: 'moderate',
      shocks: customShocks,
    }
    const r = runScenario(customScenario, combinedCoverage, positions, ratesMap)
    setResult(r)
  }, [customShocks, combinedCoverage, positions, ratesMap])

  // ── Custom shock builder ──────────────────────────────────

  function handleAddShock() {
    const numVal = parseFloat(customInput.value)
    if (!customInput.currencyOrPair.trim() || isNaN(numVal)) return
    const value = customInput.type === 'pct_change' ? numVal / 100 : numVal
    const label =
      customInput.type === 'pct_change'
        ? `${customInput.currencyOrPair.toUpperCase()} ${numVal >= 0 ? '+' : ''}${numVal}%`
        : `${customInput.currencyOrPair.toUpperCase()} → ${numVal}`
    setCustomShocks(prev => [
      ...prev,
      {
        currencyOrPair: customInput.currencyOrPair.trim().toUpperCase(),
        type: customInput.type,
        value,
        label,
      },
    ])
    setCustomInput(prev => ({ ...prev, currencyOrPair: '', value: '' }))
  }

  function handleRemoveShock(index: number) {
    setCustomShocks(prev => prev.filter((_, i) => i !== index))
  }

  // ── Result table rows (sorted by |netEconomicImpact| desc, filter trivial) ──

  const tableRows = result
    ? [...result.byPair]
        .filter(r => Math.abs(r.netEconomicImpact) > 100 || r.shocked)
        .sort((a, b) => Math.abs(b.netEconomicImpact) - Math.abs(a.netEconomicImpact))
    : []

  // ── Tab button style ──────────────────────────────────────

  function tabStyle(tab: 'prebuilt' | 'custom') {
    const active = activeTab === tab
    return {
      padding: '0.375rem 0.875rem',
      borderRadius: 'var(--r-sm)',
      border: active ? '1px solid var(--teal)' : '1px solid var(--border)',
      background: active ? 'rgba(20,184,166,0.1)' : 'transparent',
      color: active ? 'var(--teal)' : 'var(--text-muted)',
      fontSize: '0.8125rem',
      fontWeight: active ? 600 : 400,
      cursor: 'pointer',
      transition: 'all 0.15s',
    } as React.CSSProperties
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

      {/* 1. Tab switcher */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button style={tabStyle('prebuilt')} onClick={() => setActiveTab('prebuilt')}>
          Pre-built Scenarios
        </button>
        <button style={tabStyle('custom')} onClick={() => setActiveTab('custom')}>
          Custom Scenario
        </button>
      </div>

      {/* Rates loading notice */}
      {ratesLoading && (
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--amber)',
            padding: '0.5rem 0.75rem',
            background: 'rgba(245,158,11,0.07)',
            borderRadius: 'var(--r-sm)',
            border: '1px solid rgba(245,158,11,0.2)',
          }}
        >
          Live FX rates are loading — scenario results will use fallback rates.
        </div>
      )}

      {/* Empty coverage notice */}
      {combinedCoverage.length === 0 && (
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            padding: '0.5rem 0.75rem',
            background: 'var(--bg-surface)',
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--border)',
          }}
        >
          No exposure data — add FX exposures to run scenario analysis.
        </div>
      )}

      {/* 2a. Pre-built tab */}
      {activeTab === 'prebuilt' && (
        <div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '0.625rem',
            }}
          >
            {PREDEFINED_SCENARIOS.map(s => (
              <ScenarioCard
                key={s.id}
                scenario={s}
                isSelected={selectedScenario?.id === s.id}
                onSelect={() => {
                  setSelectedScenario(s)
                  setResult(null)
                }}
              />
            ))}
          </div>

          {/* Run button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleRunPrebuilt}
              disabled={!selectedScenario || combinedCoverage.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              {result && result.scenario.id === selectedScenario?.id ? (
                <>
                  <RefreshCw size={13} /> Re-run Scenario
                </>
              ) : (
                <>
                  <Play size={13} /> Run Scenario
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 2b. Custom tab */}
      {activeTab === 'custom' && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Build a custom shock
          </div>

          {/* Input row */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 120px' }}>
              <label style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Currency / Pair
              </label>
              <input
                type="text"
                placeholder="e.g. EUR or EUR/USD"
                value={customInput.currencyOrPair}
                onChange={e => setCustomInput(p => ({ ...p, currencyOrPair: e.target.value }))}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)',
                  padding: '0.375rem 0.625rem',
                  fontSize: '0.8125rem',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  outline: 'none',
                  width: '100%',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <label style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Type
              </label>
              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                {(['pct_change', 'absolute_rate'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setCustomInput(p => ({ ...p, type: t }))}
                    style={{
                      padding: '0.375rem 0.625rem',
                      fontSize: '0.75rem',
                      background: customInput.type === t ? 'rgba(20,184,166,0.15)' : 'transparent',
                      color: customInput.type === t ? 'var(--teal)' : 'var(--text-muted)',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: customInput.type === t ? 600 : 400,
                    }}
                  >
                    {t === 'pct_change' ? '% Change' : 'Absolute Rate'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '0 0 100px' }}>
              <label style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Value {customInput.type === 'pct_change' ? '(%)' : '(rate)'}
              </label>
              <input
                type="number"
                placeholder={customInput.type === 'pct_change' ? '-15' : '1.05'}
                value={customInput.value}
                onChange={e => setCustomInput(p => ({ ...p, value: e.target.value }))}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)',
                  padding: '0.375rem 0.625rem',
                  fontSize: '0.8125rem',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  outline: 'none',
                  width: '100%',
                }}
              />
            </div>

            <button
              onClick={handleAddShock}
              className="btn btn-ghost btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}
            >
              <Plus size={13} /> Add Shock
            </button>
          </div>

          {/* Shock list */}
          {customShocks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.125rem' }}>
                Shocks Added
              </div>
              {customShocks.map((shock, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    padding: '0.3125rem 0.625rem',
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      fontSize: '0.8125rem',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {shock.label}
                  </span>
                  <button
                    onClick={() => handleRemoveShock(i)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      padding: '0.125rem',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Run custom button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleRunCustom}
              disabled={customShocks.length === 0 || combinedCoverage.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              {result && result.scenario.id === 'custom' ? (
                <>
                  <RefreshCw size={13} /> Re-run Custom Scenario
                </>
              ) : (
                <>
                  <Play size={13} /> Run Custom Scenario
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 3. Results panel */}
      {result && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          {/* Results header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                {result.scenario.name}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                {new Date(result.runDate).toLocaleString()} · {result.pairsAffected} pair{result.pairsAffected !== 1 ? 's' : ''} affected
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {result.netPortfolioImpact < 0 ? (
                <TrendingDown size={13} color="var(--red)" />
              ) : (
                <TrendingUp size={13} color="var(--teal)" />
              )}
              <span>Stressed VaR: {formatCurrency(Math.abs(result.var95UnderScenario), 'USD', true)}</span>
            </div>
          </div>

          {/* Summary stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem' }}>
            <StatCard
              label="Net P&L Impact"
              value={`${result.netPortfolioImpact >= 0 ? '+' : ''}${formatCurrency(result.netPortfolioImpact, 'USD', true)}`}
              color={impactColor(result.netPortfolioImpact)}
              sub="net economic impact"
            />
            <StatCard
              label="Max Unhedged Loss"
              value={
                result.totalUnhedgedLoss < 0
                  ? formatCurrency(result.totalUnhedgedLoss, 'USD', true)
                  : '$0'
              }
              color={result.totalUnhedgedLoss < 0 ? 'var(--red)' : 'var(--text-muted)'}
              sub="unhedged exposure only"
            />
            <StatCard
              label="Unprotected Pairs"
              value={String(result.pairsUnprotected)}
              color={result.pairsUnprotected > 0 ? 'var(--amber)' : 'var(--teal)'}
              sub="shocked with <1% coverage"
            />
          </div>

          {/* Results table */}
          {tableRows.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.8125rem',
                }}
              >
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {[
                      'Pair',
                      'Shock',
                      'Unhedged Amt',
                      'P&L Impact',
                      'Hedge Delta',
                      'Net Impact',
                      'Coverage',
                    ].map(h => (
                      <th
                        key={h}
                        style={{
                          padding: '0.4375rem 0.75rem',
                          textAlign: h === 'Pair' || h === 'Shock' ? 'left' : 'right',
                          fontSize: '0.625rem',
                          fontWeight: 600,
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, i) => (
                    <ResultRow key={row.currencyPair} row={row} index={i} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: '1.5rem',
                color: 'var(--text-muted)',
                fontSize: '0.8125rem',
              }}
            >
              <CheckCircle2 size={20} color="var(--teal)" style={{ margin: '0 auto 0.5rem', display: 'block' }} />
              No pairs are materially affected by this scenario.
            </div>
          )}

          {/* 4. Key Insight */}
          <KeyInsight result={result} />
        </div>
      )}
    </div>
  )
}
