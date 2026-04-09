import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import { DiscoveryEventRow }   from '@/components/onboarding/DiscoveryEventRow'
import { useDiscoveryPipeline } from '@/hooks/useDiscoveryPipeline'
import { useOnboarding }        from '@/hooks/useOnboarding'
import type { FlatFileSchema }  from '@/lib/discoveryService'
import type { ERPType }         from '@/types'

const SESSION_SCHEMA_KEY   = 'orbit_onboarding_schema'
const SESSION_ERP_TYPE_KEY = 'orbit_onboarding_erp_type'

// ── Summary card ──────────────────────────────────────────────

function SummaryCard({
  label, value, sub, loading,
}: { label: string; value: string | number | null; sub?: string; loading: boolean }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
      <p style={{ margin: '0 0 4px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </p>
      {loading || value === null ? (
        <div style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" style={{ width: 18, height: 18 }} />
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, color: 'var(--teal)', lineHeight: 1 }}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      )}
      {sub && value !== null && (
        <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sub}</p>
      )}
    </div>
  )
}

// ── Stage progress bar ────────────────────────────────────────

const FLAT_FILE_STAGES = ['schema_pull', 'candidate_id', 'sample_pull', 'ai_analysis', 'validation', 'preview']
const FLAT_FILE_LABELS = ['Schema', 'Scan', 'Sample', 'AI Mapping', 'Validate', 'Preview']

const ERP_STAGES = ['schema_pull', 'triage', 'analysis_a', 'analysis_b', 'reconciliation', 'validation', 'preview']
const ERP_LABELS = ['Schema', 'Triage', 'Model A', 'Model B', 'Reconcile', 'Validate', 'Preview']

function StageBar({ events, isErp }: { events: Array<{ stage: string; status: string }>; isErp: boolean }) {
  const stages = isErp ? ERP_STAGES : FLAT_FILE_STAGES
  const completedStages = new Set(
    events.filter(e => e.status === 'completed' || e.status === 'warning').map(e => e.stage),
  )
  const runningStage = [...events].reverse().find((e: { stage: string; status: string }) => e.status === 'running')?.stage

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: '1rem' }}>
      {stages.map((stage, i) => {
        const done    = completedStages.has(stage)
        const running = runningStage === stage
        return (
          <div key={stage} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{
              flex: 1, height: 4, borderRadius: i === 0 ? '2px 0 0 2px' : i === stages.length - 1 ? '0 2px 2px 0' : 0,
              background: done ? 'var(--teal)' : running ? 'var(--blue)' : 'var(--border)',
              transition: 'background 0.3s',
              animation: running ? 'pulse 1.5s ease-in-out infinite' : 'none',
            }} />
          </div>
        )
      })}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────

export function DiscoveryFeed(): React.ReactElement {
  const navigate = useNavigate()
  const { session, profile, advanceStatus } = useOnboarding()
  const pipeline  = useDiscoveryPipeline()
  const feedRef   = useRef<HTMLDivElement>(null)
  const hasStarted = useRef(false)

  // Read ERP type from sessionStorage
  const erpTypeRef = useRef<ERPType | null>(null)
  if (erpTypeRef.current === null) {
    try {
      erpTypeRef.current = (sessionStorage.getItem(SESSION_ERP_TYPE_KEY) as ERPType) ?? 'flat_file'
    } catch {
      erpTypeRef.current = 'flat_file'
    }
  }
  const isErp = erpTypeRef.current !== 'flat_file'

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [pipeline.events.length])

  // Auto-start discovery on mount — wait for both session and profile to load
  useEffect(() => {
    if (hasStarted.current || !session || !profile) return

    // Read schema from sessionStorage (persisted by ConnectERP)
    let schema: FlatFileSchema | null = null
    try {
      const stored = sessionStorage.getItem(SESSION_SCHEMA_KEY)
      if (stored) {
        schema = JSON.parse(stored) as FlatFileSchema
        console.log('[DiscoveryFeed] Loaded schema from sessionStorage:', schema.columns.length, 'columns,', schema.rowCount, 'rows')
      }
    } catch (err) {
      console.warn('[DiscoveryFeed] Failed to read schema from sessionStorage:', err)
    }

    if (!schema || schema.columns.length === 0) {
      // For ERP path, schema is built internally by the pipeline — pass a minimal stub
      // For flat file path, use profile-derived fallback
      console.warn('[DiscoveryFeed] No schema in sessionStorage — using fallback')
      schema = {
        columns: profile.transaction_currencies.map(ccy => ({
          name: ccy, sampleValues: [ccy], dataType: 'currency_code',
        })),
        rowCount: 0,
        fileName: isErp ? `${erpTypeRef.current}-stub` : 'profile-derived',
      }
    }

    hasStarted.current = true
    void pipeline.run(schema, profile, session, erpTypeRef.current ?? undefined)
  }, [session, profile]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleContinue = async () => {
    if (!pipeline.discoveryId) {
      // Store discoveryId in sessionStorage for ValidateMappings
    } else {
      try {
        sessionStorage.setItem('orbit_discovery_id', pipeline.discoveryId)
      } catch { /* ignore */ }
    }
    await advanceStatus('validate', 'AI discovery completed')
    navigate('/onboarding/validate')
  }

  const summary = pipeline.summary
  const stageLabels = isErp ? ERP_LABELS : FLAT_FILE_LABELS

  return (
    <div style={{ maxWidth: 1060, margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => navigate('/onboarding/connect')}
          style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8, padding: '4px 8px' }}
        >
          <ArrowLeft size={13} /> Back to Connect
        </button>
        <h2 style={{ margin: '0 0 4px' }}>AI Discovery</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {isErp
            ? 'Orbit AI is running dual-model analysis on your ERP schema and reconciling mappings.'
            : 'Orbit AI is analysing your data and mapping fields to our exposure model.'}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '1.5rem', alignItems: 'start' }}>

        {/* ── Left: Event feed ── */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: pipeline.isRunning ? 'var(--teal)' : pipeline.hasError ? 'var(--red)' : 'var(--green)', animation: pipeline.isRunning ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Analysis Log</span>
            {pipeline.isRunning && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Running…</span>
            )}
            {isErp && (
              <span className="badge badge-blue" style={{ fontSize: '0.6rem', marginLeft: 'auto' }}>Dual-LLM</span>
            )}
          </div>

          {/* Feed */}
          <div
            ref={feedRef}
            style={{ minHeight: 300, maxHeight: 420, overflowY: 'auto', padding: '0 1rem' }}
          >
            {pipeline.events.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                <div className="spinner" style={{ width: 20, height: 20 }} />
              </div>
            ) : (
              pipeline.events.map(event => (
                <DiscoveryEventRow key={event.id} event={event} />
              ))
            )}
          </div>

          {/* Stage bar */}
          <div style={{ padding: '0 1rem 1rem' }}>
            <StageBar events={pipeline.events} isErp={isErp} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              {stageLabels.map(l => (
                <span key={l} style={{ fontSize: '0.6rem', color: 'var(--text-muted)', flex: 1, textAlign: 'center' }}>{l}</span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Summary cards ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <SummaryCard
            label="Fields Mapped"
            value={summary ? summary.total_mappings : null}
            loading={pipeline.isRunning && !summary}
          />
          <SummaryCard
            label="Avg Confidence"
            value={summary ? `${Math.round(summary.avg_confidence * 100)}%` : null}
            loading={pipeline.isRunning && !summary}
          />
          <SummaryCard
            label="Currencies Found"
            value={summary ? summary.currencies_found.length : null}
            sub={summary?.currencies_found.join(', ')}
            loading={pipeline.isRunning && !summary}
          />
          <SummaryCard
            label={isErp ? 'Tables Analysed' : 'Open Exposures'}
            value={summary ? (isErp ? summary.tables_identified : summary.estimated_open_exposures) : null}
            loading={pipeline.isRunning && !summary}
          />

          {/* Gaps warning */}
          {pipeline.gaps.length > 0 && !pipeline.isRunning && (
            <div style={{ padding: '0.75rem', background: 'var(--amber-bg)', borderRadius: 'var(--r-md)', border: '1px solid #fde68a' }}>
              <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '0.78rem', color: '#92400e' }}>
                ⚠ {pipeline.gaps.length} gap{pipeline.gaps.length > 1 ? 's' : ''} found
              </p>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#92400e' }}>
                You'll be able to resolve {pipeline.gaps.length > 1 ? 'these' : 'this'} in the next step.
              </p>
            </div>
          )}

          {/* Error */}
          {pipeline.hasError && (
            <div style={{ padding: '0.75rem', background: 'var(--red-bg)', borderRadius: 'var(--r-md)', border: '1px solid #fecaca' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: '0.78rem', color: 'var(--red)' }}>Discovery failed</p>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                hasStarted.current = false
                window.location.reload()
              }} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          )}

          {/* Continue */}
          {pipeline.isDone && (
            <button
              className="btn btn-primary"
              onClick={handleContinue}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              Review Mappings <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
