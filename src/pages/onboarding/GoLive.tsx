import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, ArrowRight, Calendar } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useOnboarding } from '@/hooks/useOnboarding'

const SESSION_SCHEMA_KEY   = 'orbit_onboarding_schema'
const SESSION_MAPPINGS_KEY = 'orbit_discovery_mappings'

// ── Mapping helpers ───────────────────────────────────────────

interface StoredMapping {
  source_field: string
  target_field: string
  confidence: number
  status?: string
}

/**
 * Read confirmed field mappings from sessionStorage and build a
 * source_column → target_field lookup. Falls back to an identity
 * map when no mappings are found (i.e. template-format CSVs).
 */
function loadColumnMap(): Record<string, string> {
  const map: Record<string, string> = {}
  try {
    const raw = sessionStorage.getItem(SESSION_MAPPINGS_KEY)
    if (!raw) return map
    const mappings = JSON.parse(raw) as StoredMapping[]
    for (const m of mappings) {
      // Skip rejected mappings; include confirmed, proposed, modified
      if (m.status === 'rejected') continue
      // Map the original CSV column name → Quova canonical field name
      // e.g. "Currency" → "transaction_currency", "Amount" → "notional_amount"
      map[m.source_field] = m.target_field
    }
  } catch { /* ignore */ }
  return map
}

/**
 * Remap a raw CSV row's keys using the column map from the discovery step.
 * If a column has no mapping, keep the original key (supports template CSVs).
 */
function remapRow(row: Record<string, string | undefined>, columnMap: Record<string, string>): ParsedRow {
  const remapped: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(row)) {
    const targetKey = columnMap[key] ?? key
    remapped[targetKey] = value
  }
  return remapped as ParsedRow
}

const SYNC_STEPS = [
  'Connecting to data source…',
  'Reading uploaded exposure data…',
  'Applying confirmed field mappings…',
  'Creating FX exposure records…',
  'Calculating currency pairs…',
  'Building exposure dashboard…',
  'Finalising setup…',
]

// Map transaction_type from CSV to direction for fx_exposures
function inferDirection(txnType: string): 'receivable' | 'payable' {
  const type = txnType.toLowerCase()
  if (type.includes('ar') || type.includes('receivable') || type.includes('sales')) return 'receivable'
  return 'payable' // ap_invoice, purchase_order, intercompany_payable, etc.
}

interface ParsedRow {
  transaction_id?: string
  transaction_type?: string
  transaction_currency?: string
  notional_amount?: string
  settlement_date?: string
  counterparty?: string
  entity?: string
  posting_date?: string
  functional_amount?: string
  cost_center?: string
  description?: string
  status?: string
  [key: string]: string | undefined
}

export function GoLive(): React.ReactElement {
  const navigate    = useNavigate()
  const { user }    = useAuth()
  const { session, profile, advanceStatus } = useOnboarding()

  const orgId = user?.profile?.org_id
  const funcCcy = profile?.functional_currency ?? 'USD'

  const [progress,     setProgress]     = useState(0)
  const [currentStep,  setCurrentStep]  = useState(0)
  const [synced,       setSynced]       = useState(false)
  const [importCount,  setImportCount]  = useState(0)
  const [error,        setError]        = useState<string | null>(null)
  const importStarted  = useRef(false)

  // ── Import CSV data into fx_exposures ─────────────────────

  useEffect(() => {
    if (importStarted.current || !orgId) return
    importStarted.current = true

    let importedCount = 0
    void (async () => {
      try {
        // Step 1: reading data
        setCurrentStep(0)
        setProgress(10)
        await pause(400)

        // Read raw CSV rows stored during upload
        let rawRows: Record<string, string | undefined>[] = []
        try {
          const rawStr = sessionStorage.getItem('orbit_onboarding_raw_rows')
          if (rawStr) rawRows = JSON.parse(rawStr)
        } catch { /* ignore */ }

        setCurrentStep(1)
        setProgress(20)
        await pause(400)

        if (rawRows.length === 0) {
          console.warn('[GoLive] No raw rows in sessionStorage — syncing without data import')
        }

        // Step 3: apply confirmed field mappings to remap CSV columns → canonical names
        setCurrentStep(2)
        setProgress(30)
        const columnMap = loadColumnMap()
        const hasMappings = Object.keys(columnMap).length > 0
        if (hasMappings) {
          console.log(`[GoLive] Applying ${Object.keys(columnMap).length} field mappings`)
        }
        const rows: ParsedRow[] = rawRows.map(r => hasMappings ? remapRow(r, columnMap) : r as ParsedRow)
        await pause(300)

        // Step 4: create fx_exposure records
        setCurrentStep(3)
        setProgress(40)

        if (rows.length > 0) {
          // Create upload batch
          const { data: batch } = await supabase
            .from('upload_batches')
            .insert({
              org_id:   orgId,
              filename: 'onboarding-import.csv',
              row_count: rows.length,
              status:   'complete',
              table_name: 'fx_exposures',
            })
            .select('id')
            .single()

          const batchId = batch?.id ?? null

          // Build exposure records (skip rows with no FX risk — same currency as functional)
          const exposures = rows
            .filter(r => {
              const ccy = (r.transaction_currency ?? '').trim().toUpperCase()
              return ccy && r.notional_amount && ccy !== funcCcy
            })
            .map(row => {
              const txnCcy  = (row.transaction_currency ?? '').trim().toUpperCase()
              const amount  = parseFloat((row.notional_amount ?? '0').replace(/[$,\s]/g, ''))
              const pair    = `${txnCcy}/${funcCcy}`
              const direction = inferDirection(row.transaction_type ?? 'ap_invoice')

              return {
                org_id:          orgId,
                upload_batch_id: batchId,
                entity:          (row.entity ?? 'Default').trim(),
                currency_pair:   pair,
                base_currency:   txnCcy,
                quote_currency:  funcCcy,
                direction,
                notional_base:   amount,
                notional_usd:    null, // will be calculated by the dashboard
                settlement_date: row.settlement_date ?? new Date().toISOString().split('T')[0],
                description:     row.description ?? null,
                source_system:   'onboarding_import',
                status:          'open',
              }
            })

          // Insert in batches of 50
          let inserted = 0
          for (let i = 0; i < exposures.length; i += 50) {
            const chunk = exposures.slice(i, i + 50)
            const { error: insErr } = await supabase.from('fx_exposures').insert(chunk)
            if (insErr) {
              console.error('[GoLive] Insert error:', insErr.message)
            } else {
              inserted += chunk.length
            }
            setProgress(40 + Math.round((inserted / exposures.length) * 40))
          }

          importedCount = inserted
          setImportCount(inserted)
          console.log(`[GoLive] Imported ${inserted} exposures`)
        }

        // Step 5: currency pairs
        setCurrentStep(4)
        setProgress(85)
        await pause(400)

        // Step 6: building dashboard
        setCurrentStep(5)
        setProgress(92)
        await pause(400)

        // Step 7: finalising
        setCurrentStep(6)
        setProgress(100)
        await pause(300)

        // Mark session as live
        if (session?.status !== 'live') {
          await advanceStatus('live', `Initial import: ${importedCount} exposures`)
        }

        setSynced(true)
      } catch (err) {
        console.error('[GoLive] Import failed:', err)
        setError(err instanceof Error ? err.message : 'Import failed')
        setSynced(true) // still show celebration, just without data
      }
    })()
  }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const currencies = profile?.transaction_currencies ?? []

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '3rem 1rem', textAlign: 'center' }}>

      {!synced ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'var(--teal-dim)', border: '2px solid var(--teal)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div className="spinner" style={{ width: 28, height: 28, borderColor: 'var(--teal)', borderTopColor: 'transparent' }} />
          </div>

          <div>
            <h2 style={{ margin: '0 0 6px' }}>Setting up your dashboard…</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Importing your exposure data. This usually takes less than 30 seconds.
            </p>
          </div>

          <div style={{ width: '100%', maxWidth: 480 }}>
            <div style={{ height: 8, borderRadius: 999, background: 'var(--border)', overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--teal)', borderRadius: 999, transition: 'width 0.3s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{SYNC_STEPS[currentStep]}</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--teal)' }}>{progress}%</span>
            </div>
          </div>

          <div style={{ width: '100%', maxWidth: 480, textAlign: 'left' }}>
            {SYNC_STEPS.map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                <span style={{ fontSize: '0.85rem' }}>
                  {i < currentStep ? '✅' : i === currentStep ? '⏳' : '⬜'}
                </span>
                <span style={{
                  fontSize: '0.8rem',
                  color: i <= currentStep ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: i === currentStep ? 500 : 400,
                }}>{step}</span>
              </div>
            ))}
          </div>

          {error && (
            <div style={{ padding: '0.75rem', background: 'var(--red-bg)', borderRadius: 'var(--r-md)', border: '1px solid #fecaca', width: '100%', maxWidth: 480 }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--red)' }}>{error}</p>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', animation: 'fadeIn 0.4s ease' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: '#ecfdf5', border: '3px solid #a7f3d0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CheckCircle2 size={36} color="var(--green)" />
          </div>

          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: '1.5rem' }}>Your FX dashboard is live! 🎉</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {importCount > 0
                ? `${importCount} exposure records imported and your dashboard is ready.`
                : 'Your dashboard is ready. Upload exposure data to see live positions.'}
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center', width: '100%', maxWidth: 480 }}>
            {importCount > 0 && (
              <div className="card" style={{ flex: 1, minWidth: 130, textAlign: 'center', padding: '1rem' }}>
                <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Exposures Imported</p>
                <p style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, color: 'var(--teal)' }}>{importCount}</p>
              </div>
            )}
            <div className="card" style={{ flex: 1, minWidth: 130, textAlign: 'center', padding: '1rem' }}>
              <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Currencies</p>
              <p style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, color: 'var(--teal)' }}>{currencies.length}</p>
              <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{currencies.slice(0, 4).join(', ')}</p>
            </div>
            <div className="card" style={{ flex: 1, minWidth: 130, textAlign: 'center', padding: '1rem' }}>
              <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Entities</p>
              <p style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, color: 'var(--teal)' }}>{profile?.entities?.length ?? 1}</p>
            </div>
          </div>

          <div style={{ width: '100%', maxWidth: 480, padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', textAlign: 'left' }}>
            <p style={{ margin: '0 0 0.75rem', fontWeight: 600, fontSize: '0.875rem' }}>What's next:</p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Review your exposure dashboard to see live positions</li>
              <li style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Set a hedge policy in Strategy & Policy</li>
              <li style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Get AI-powered hedging recommendations in Hedge Advisor</li>
            </ul>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => navigate('/dashboard')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.625rem 1.5rem' }}>
              Go to Dashboard <ArrowRight size={14} />
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/strategy')}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Calendar size={14} /> Set Hedge Policy
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
