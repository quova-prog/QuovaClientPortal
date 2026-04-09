import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, CheckCheck, ArrowLeft, ArrowRight, HelpCircle } from 'lucide-react'
import { MappingRow }       from '@/components/onboarding/MappingRow'
import { HumanReviewCard }  from '@/components/onboarding/HumanReviewCard'
import { useMappings }      from '@/hooks/useMappings'
import { useOnboarding }    from '@/hooks/useOnboarding'
import { ORBIT_TARGET_FIELDS } from '@/lib/discoveryService'
import { supabase } from '@/lib/supabase'
import type { OnboardingHumanReviewItem } from '@/types'

const SESSION_DISC_KEY   = 'orbit_discovery_id'
const SESSION_REPORT_KEY = 'orbit_discovery_report'
const SESSION_REVIEW_KEY = 'orbit_discovery_human_review'

const REQUIRED_FIELDS = ORBIT_TARGET_FIELDS.filter(f => f.required).map(f => f.field)

// ── Reconciliation summary from the ERP discovery report ──────

interface ReconSummary {
  totalTablesAnalyzed: number
  overallAgreementRate: number
  columnsWithConflict: number
  columnsRequiringHumanReview: number
  overallConfidence: number
}

export function ValidateMappings(): React.ReactElement {
  const navigate  = useNavigate()
  const { session, advanceStatus } = useOnboarding()

  // Get discoveryId: try sessionStorage first, then query DB, then use 'local' fallback
  const [discoveryId, setDiscoveryId] = useState<string | null>(null)
  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_DISC_KEY)
    if (stored) {
      setDiscoveryId(stored)
      return
    }
    // Fallback: query the latest completed discovery for this onboarding session
    if (!session?.id) {
      // No session yet — use 'local' to trigger sessionStorage mapping fallback
      setDiscoveryId('local')
      return
    }
    void (async () => {
      const { data } = await supabase
        .from('schema_discoveries')
        .select('id')
        .eq('session_id', session.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data?.id) {
        setDiscoveryId(data.id)
        try { sessionStorage.setItem(SESSION_DISC_KEY, data.id) } catch { /* ignore */ }
      } else {
        // DB has no discovery — use sessionStorage mappings
        setDiscoveryId('local')
      }
    })()
  }, [session?.id])

  const { mappings, loading, confirm, reject, edit, resetToProposed, bulkConfirmHighConfidence } = useMappings(discoveryId)

  const [advancing, setAdvancing] = useState(false)
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({})

  // Load ERP reconciliation data if available
  const [reconSummary, setReconSummary] = useState<ReconSummary | null>(null)
  const [humanReviewItems, setHumanReviewItems] = useState<OnboardingHumanReviewItem[]>([])
  const [reviewAnswers, setReviewAnswers] = useState<Record<string, string>>({})

  useEffect(() => {
    try {
      const reportStr = sessionStorage.getItem(SESSION_REPORT_KEY)
      if (reportStr) {
        const report = JSON.parse(reportStr) as { reconciledSummary?: ReconSummary }
        if (report.reconciledSummary) {
          setReconSummary(report.reconciledSummary)
        }
      }

      const reviewStr = sessionStorage.getItem(SESSION_REVIEW_KEY)
      if (reviewStr) {
        setHumanReviewItems(JSON.parse(reviewStr) as OnboardingHumanReviewItem[])
      }
    } catch { /* ignore */ }
  }, [])

  const isErpMode = reconSummary != null || mappings.some(m => m.verdict != null)

  // Coverage stats
  const confirmed   = mappings.filter(m => m.status === 'confirmed' || m.status === 'modified')
  const pending     = mappings.filter(m => m.status === 'proposed')
  const highConf    = pending.filter(m => m.confidence >= 0.9)
  const confirmedTargets = new Set([...confirmed, ...mappings.filter(m => m.status === 'modified')].map(m => m.target_field))
  const requiredCovered  = REQUIRED_FIELDS.filter(f => confirmedTargets.has(f))
  const canGoLive        = requiredCovered.length >= Math.min(REQUIRED_FIELDS.length, 4) && confirmed.length > 0

  const handleBulkConfirm = async () => {
    await bulkConfirmHighConfidence(0.9)
  }

  const handleGoLive = async () => {
    setAdvancing(true)
    try {
      await advanceStatus('live', 'Field mappings validated and confirmed')
      navigate('/onboarding/live')
    } catch (err) {
      console.error(err)
      setAdvancing(false)
    }
  }

  function exportCSV(): void {
    const headers = ['Source Table', 'Source Field', 'Target Entity', 'Target Field', 'Confidence', 'Status', 'AI Reasoning']
    if (isErpMode) headers.push('Verdict', 'Reconciliation Reasoning')

    const rows = [
      headers.join(','),
      ...mappings.map(m => {
        const base = [
          m.source_table, m.source_field, m.target_entity, m.target_field,
          `${Math.round(m.confidence * 100)}%`, m.status, (m.ai_reasoning ?? '').replace(/,/g, ';'),
        ]
        if (isErpMode) {
          base.push(m.verdict ?? '', (m.reconciliation_reasoning ?? '').replace(/,/g, ';'))
        }
        return base.join(',')
      }),
    ].join('\n')
    const blob = new Blob([rows], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'orbit-field-mappings.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/onboarding/discover')}
            style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8, padding: '4px 8px' }}
          >
            <ArrowLeft size={13} /> Back to Discovery
          </button>
          <h2 style={{ margin: '0 0 4px' }}>Validate Field Mappings</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {isErpMode
              ? 'Review the dual-model reconciled mappings below. Expand rows for signal details.'
              : 'Review the AI-proposed mappings below. Confirm, reject, or edit each one.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={exportCSV}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Download size={12} /> Export CSV
          </button>
          {highConf.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={handleBulkConfirm}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <CheckCheck size={12} /> Confirm all ≥90% ({highConf.length})
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: '1.5rem', alignItems: 'start' }}>

        {/* ── Left: Mapping table ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {loading ? (
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
              <div className="spinner" style={{ width: 24, height: 24 }} />
            </div>
          ) : mappings.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                No field mappings found. Go back and upload your file.
              </p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th>Source Field</th>
                      <th style={{ width: 24 }} />
                      <th>Quova Field</th>
                      <th>Sample Values</th>
                      <th style={{ width: isErpMode ? 140 : 100 }}>
                        {isErpMode ? 'Confidence / Verdict' : 'Confidence'}
                      </th>
                      <th style={{ width: 100 }}>Status</th>
                      <th style={{ width: 100 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map(m => (
                      <MappingRow
                        key={m.id}
                        mapping={m}
                        onConfirm={() => void confirm(m.id)}
                        onReject={() => void reject(m.id)}
                        onEdit={field => void edit(m.id, field)}
                        onReset={() => void resetToProposed(m.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Human review queue (ERP mode only) ── */}
          {humanReviewItems.length > 0 && (
            <div>
              <p style={{ margin: '0 0 0.5rem', fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <HelpCircle size={14} color="var(--amber)" /> Requires Your Input ({humanReviewItems.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {humanReviewItems.map((item, i) => (
                  <HumanReviewCard
                    key={`${item.sourceTable}-${item.sourceColumn}-${i}`}
                    item={item}
                    selectedOption={reviewAnswers[`${item.sourceTable}.${item.sourceColumn}`]}
                    onSelectOption={label =>
                      setReviewAnswers(prev => ({ ...prev, [`${item.sourceTable}.${item.sourceColumn}`]: label }))
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Gaps / missing fields ── */}
          {REQUIRED_FIELDS.filter(f => !confirmedTargets.has(f)).length > 0 && !loading && (
            <div className="card" style={{ borderColor: '#fde68a', background: 'var(--amber-bg)' }}>
              <p style={{ margin: '0 0 0.75rem', fontWeight: 600, fontSize: '0.875rem', color: '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
                <HelpCircle size={14} /> Missing Required Fields
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {REQUIRED_FIELDS.filter(f => !confirmedTargets.has(f)).map(field => {
                  const info = ORBIT_TARGET_FIELDS.find(t => t.field === field)
                  return (
                    <div key={field}>
                      <p style={{ margin: '0 0 4px', fontSize: '0.8rem', fontWeight: 600, color: '#92400e' }}>
                        ⚠ {info?.label ?? field}
                      </p>
                      <p style={{ margin: '0 0 5px', fontSize: '0.75rem', color: '#92400e' }}>
                        Which column in your file contains this information?
                      </p>
                      <input
                        className="input"
                        type="text"
                        placeholder={`e.g. "invoice_amount" or "N/A — not in our data"`}
                        value={gapAnswers[field] ?? ''}
                        onChange={e => setGapAnswers(prev => ({ ...prev, [field]: e.target.value }))}
                        style={{ fontSize: '0.8rem' }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Progress panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', position: 'sticky', top: '1rem' }}>

          {/* ERP reconciliation summary stats */}
          {reconSummary && (
            <div className="card">
              <p style={{ margin: '0 0 0.75rem', fontWeight: 600, fontSize: '0.875rem' }}>Reconciliation Summary</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <StatRow label="Agreement Rate" value={`${Math.round(reconSummary.overallAgreementRate * 100)}%`} color="var(--green)" />
                <StatRow label="Tables Analysed" value={String(reconSummary.totalTablesAnalyzed)} color="var(--blue)" />
                <StatRow label="Conflicts Resolved" value={String(reconSummary.columnsWithConflict)} color="var(--amber)" />
                <StatRow label="Flagged for Review" value={String(reconSummary.columnsRequiringHumanReview)} color="var(--red)" />
              </div>
            </div>
          )}

          {/* Coverage stats */}
          <div className="card">
            <p style={{ margin: '0 0 0.75rem', fontWeight: 600, fontSize: '0.875rem' }}>Mapping Progress</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Confirmed */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Confirmed</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--green)' }}>
                    {confirmed.length}/{mappings.length}
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{
                    width: mappings.length ? `${(confirmed.length / mappings.length) * 100}%` : '0%',
                    height: '100%', background: 'var(--green)', borderRadius: 999, transition: 'width 0.3s',
                  }} />
                </div>
              </div>

              {/* Required fields */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Required fields confirmed</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: requiredCovered.length === REQUIRED_FIELDS.length ? 'var(--green)' : 'var(--amber)' }}>
                    {requiredCovered.length}/{REQUIRED_FIELDS.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                  {REQUIRED_FIELDS.map(f => {
                    const covered = confirmedTargets.has(f)
                    const info    = ORBIT_TARGET_FIELDS.find(t => t.field === f)
                    return (
                      <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '0.9rem' }}>{covered ? '✅' : '⬜'}</span>
                        <span style={{ fontSize: '0.7rem', color: covered ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {info?.label ?? f}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Pending reminder */}
          {pending.length > 0 && (
            <div style={{ padding: '0.6rem 0.75rem', background: '#f0fdfa', borderRadius: 'var(--r-md)', border: '1px solid #99f6e4' }}>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--teal-dark)' }}>
                <strong>{pending.length}</strong> mapping{pending.length > 1 ? 's' : ''} detected — click ✓ to confirm each, or use <strong>"Confirm all ≥90%"</strong> above to approve in bulk.
              </p>
            </div>
          )}

          {/* Go Live */}
          <button
            className="btn btn-primary"
            disabled={!canGoLive || advancing}
            onClick={handleGoLive}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            {advancing ? (
              <><div className="spinner" style={{ width: 14, height: 14 }} /> Preparing…</>
            ) : (
              <>Go Live <ArrowRight size={14} /></>
            )}
          </button>
          {!canGoLive && (
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              Confirm the mappings above (✓) to enable Go Live.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: '0.82rem', fontWeight: 700, color }}>{value}</span>
    </div>
  )
}
