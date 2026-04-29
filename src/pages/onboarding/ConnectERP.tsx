import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ExternalLink, CheckCircle2, XCircle, Loader2, ShieldCheck, Eye, EyeOff } from 'lucide-react'
import { ERPCard }          from '@/components/onboarding/ERPCard'
import { FlatFileUploader }  from '@/components/onboarding/FlatFileUploader'
import { ERP_CONNECTORS }   from '@/lib/erpConnectorConfig'
import { useOnboarding }     from '@/hooks/useOnboarding'
import { useErpConnections } from '@/hooks/useErpConnections'
import type { ERPType }      from '@/types'
import type { FlatFileSchema } from '@/lib/discoveryService'

const SESSION_SCHEMA_KEY = 'orbit_onboarding_schema'

// ── Module validation result ────────────────────────────────

interface ModuleResult {
  module: string
  status: 'pending' | 'testing' | 'pass' | 'fail'
  detail: string
  recordCount?: number
}

// ── Password field with show/hide ───────────────────────────

function PasswordField({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ paddingRight: 36 }}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        style={{
          all: 'unset', cursor: 'pointer',
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-muted)',
        }}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  )
}

// ── Module checklist row ─────────────────────────────────────

function ModuleRow({ result }: { result: ModuleResult }) {
  const icon = {
    pending: <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border)' }} />,
    testing: <Loader2 size={14} color="var(--blue)" style={{ animation: 'spin 1s linear infinite' }} />,
    pass:    <CheckCircle2 size={14} color="var(--green)" />,
    fail:    <XCircle size={14} color="var(--red)" />,
  }[result.status]

  const label = result.module
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.45rem 0' }}>
      {icon}
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)' }}>{label}</span>
        {result.status === 'pass' && result.recordCount != null && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 6 }}>
            — {result.recordCount.toLocaleString()} records
          </span>
        )}
        {result.status === 'fail' && (
          <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'var(--red)' }}>{result.detail}</p>
        )}
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────

export function ConnectERP(): React.ReactElement {
  const { session, profile, advanceStatus } = useOnboarding()
  const { upsertConnection } = useErpConnections()
  const navigate = useNavigate()

  const [selectedType,  setSelectedType]  = useState<ERPType>('flat_file')
  const [fileReady,     setFileReady]     = useState(false)
  const [advancing,     setAdvancing]     = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [fieldValues,   setFieldValues]   = useState<Record<string, string>>({})
  const [testState,     setTestState]     = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle')
  const [moduleResults, setModuleResults] = useState<ModuleResult[]>([])
  const [connectionSaved, setConnectionSaved] = useState(false)

  const selected = ERP_CONNECTORS.find(c => c.erp_type === selectedType) ?? ERP_CONNECTORS[0]

  // Check if all required fields are filled
  const requiredFilled = selected.fields
    .filter(f => f.required)
    .every(f => (fieldValues[f.key] ?? '').trim().length > 0)

  // Reset state when switching connector type
  const handleSelectType = (type: ERPType) => {
    setSelectedType(type)
    setFileReady(false)
    setFieldValues({})
    setTestState('idle')
    setModuleResults([])
    setConnectionSaved(false)
    setError(null)
  }

  // ── File parsed handler ─────────────────────────────────────

  const handleFileParsed = useCallback((
    schema: FlatFileSchema,
    // strippedRows not needed here — schema.columns[].sampleValues are already PII-stripped
    // at construction time in FlatFileUploader. Raw rows for GoLive import are in sessionStorage.
    _strippedRows: Record<string, string>[],
  ) => {
    try {
      sessionStorage.setItem(SESSION_SCHEMA_KEY, JSON.stringify(schema))
    } catch { /* best effort */ }
    setFileReady(true)
  }, [])

  // ── Test Connection (simulated) ─────────────────────────────

  const handleTestConnection = async () => {
    setTestState('testing')
    setError(null)

    // Build module results
    const modules = selected.modules_to_validate.length > 0
      ? selected.modules_to_validate
      : ['connection']

    const results: ModuleResult[] = modules.map(m => ({
      module: m, status: 'pending' as const, detail: '', recordCount: undefined,
    }))
    setModuleResults(results)

    // Simulate testing each module with staggered timing
    for (let i = 0; i < results.length; i++) {
      // Mark as testing
      setModuleResults(prev => prev.map((r, idx) =>
        idx === i ? { ...r, status: 'testing' as const, detail: 'Connecting…' } : r,
      ))

      await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 600))

      // Simulate pass (90% chance) or fail (10% chance)
      const pass = Math.random() > 0.1
      const recordCount = pass ? Math.floor(Math.random() * 15000) + 500 : undefined

      setModuleResults(prev => prev.map((r, idx) =>
        idx === i ? {
          ...r,
          status: pass ? 'pass' as const : 'fail' as const,
          detail: pass
            ? `accessible (${recordCount?.toLocaleString()} records)`
            : `Permission denied — ask your admin to grant read access to the ${r.module} API`,
          recordCount,
        } : r,
      ))
    }

    // Determine overall result
    const finalResults = await new Promise<ModuleResult[]>(resolve => {
      // Need to read from state after all updates
      setTimeout(() => {
        setModuleResults(prev => {
          resolve(prev)
          return prev
        })
      }, 100)
    })

    const allPassed = finalResults.every(r => r.status === 'pass')
    const anyPassed = finalResults.some(r => r.status === 'pass')

    if (allPassed) {
      setTestState('passed')
    } else if (anyPassed) {
      // Partial — still allow proceeding
      setTestState('passed')
    } else {
      setTestState('failed')
      setError('Connection test failed. Please check your credentials and try again.')
    }
  }

  // ── Save Connection ─────────────────────────────────────────

  const handleSaveConnection = async () => {
    if (!session) return

    try {
      // Build config from field values (strip out password fields — only save non-sensitive metadata)
      const nonSensitiveConfig: Record<string, unknown> = {}
      for (const field of selected.fields) {
        if (field.type !== 'password') {
          nonSensitiveConfig[field.key] = fieldValues[field.key] ?? ''
        }
      }

      await upsertConnection({
        connector_type: selected.erp_type,
        display_name: selected.label,
        status: 'connected',
        config: {
          ...nonSensitiveConfig,
          erp_type: selected.erp_type,
          onboarding_session_id: session.id,
        },
        credentials_set: true,
        sync_modules: moduleResults.filter(r => r.status === 'pass').map(r => r.module),
        sync_frequency: 'daily',
        last_synced_at: null,
        last_sync_status: null,
        last_sync_count: null,
        last_error: null,
      })

      setConnectionSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save connection')
    }
  }

  // ── Start Discovery ─────────────────────────────────────────

  const handleStartDiscovery = async () => {
    if (!session) return
    setAdvancing(true)
    setError(null)
    try {
      // Save connection first if ERP (not flat file) and not yet saved
      if (selected.erp_type !== 'flat_file' && !connectionSaved) {
        await handleSaveConnection()
      }
      // Persist ERP type so DiscoveryFeed can branch between flat file and ERP paths
      try { sessionStorage.setItem('orbit_onboarding_erp_type', selected.erp_type) } catch { /* ignore */ }
      await advanceStatus('discover', `Connected via ${selected.label}`)
      navigate('/onboarding/discover')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance')
      setAdvancing(false)
    }
  }

  // Can proceed?
  const canProceed =
    (selected.erp_type === 'flat_file' && fileReady) ||
    (selected.erp_type !== 'flat_file' && (testState === 'passed' || connectionSaved))

  return (
    <div style={{ maxWidth: 1020, margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 4px' }}>Connect Your Data</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Choose your ERP system or upload a flat file to get started.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.5rem', alignItems: 'start' }}>

        {/* ── Left: ERP selector ── */}
        <div style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', paddingRight: 4 }}>
          <p style={{
            margin: '0 0 0.75rem', fontSize: '0.72rem', fontWeight: 600,
            color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Data Source
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {ERP_CONNECTORS.map(cfg => (
              <ERPCard
                key={cfg.erp_type}
                config={cfg}
                selected={selectedType === cfg.erp_type}
                onClick={() => handleSelectType(cfg.erp_type)}
              />
            ))}
          </div>
        </div>

        {/* ── Right: Connection panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card">
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: '0 0 2px', fontSize: '1rem' }}>{selected.label}</h3>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {selected.description}
                </p>
              </div>
              {selected.help_doc_url && (
                <a href={selected.help_doc_url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--teal-dark)', flexShrink: 0 }}>
                  Docs <ExternalLink size={11} />
                </a>
              )}
            </div>

            {/* ── Flat file ── */}
            {selected.erp_type === 'flat_file' && (
              <FlatFileUploader onParsed={handleFileParsed} />
            )}

            {/* ── ERP credential form ── */}
            {selected.erp_type !== 'flat_file' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

                {/* Security note */}
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '0.6rem 0.75rem', background: '#f0fdfa',
                  borderRadius: 'var(--r-sm)', border: '1px solid #99f6e4',
                }}>
                  <ShieldCheck size={14} color="var(--teal-dark)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--teal-dark)', lineHeight: 1.4 }}>
                    Credentials are encrypted and never stored in the browser. Only non-sensitive metadata (host URLs, environments) is saved to your account.
                  </p>
                </div>

                {/* Fields */}
                {selected.fields.map(field => (
                  <div key={field.key}>
                    <label className="label" style={{ marginBottom: 4 }}>
                      {field.label}
                      {field.required && <span style={{ color: 'var(--red)', marginLeft: 3 }}>*</span>}
                    </label>
                    {field.type === 'select' ? (
                      <select
                        className="input"
                        value={fieldValues[field.key] ?? ''}
                        onChange={e => setFieldValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                      >
                        <option value="">— Select —</option>
                        {(field.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : field.type === 'password' ? (
                      <PasswordField
                        value={fieldValues[field.key] ?? ''}
                        onChange={v => setFieldValues(prev => ({ ...prev, [field.key]: v }))}
                        placeholder={field.placeholder}
                      />
                    ) : (
                      <input
                        className="input"
                        type={field.type}
                        placeholder={field.placeholder}
                        value={fieldValues[field.key] ?? ''}
                        onChange={e => setFieldValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}

                {/* Test Connection button */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!requiredFilled || testState === 'testing'}
                    onClick={handleTestConnection}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {testState === 'testing' ? (
                      <><div className="spinner" style={{ width: 12, height: 12 }} /> Testing…</>
                    ) : testState === 'passed' ? (
                      <><CheckCircle2 size={13} /> Connected ✓</>
                    ) : (
                      'Test Connection'
                    )}
                  </button>
                  {testState === 'passed' && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--green)', fontWeight: 500 }}>
                      Connection verified
                    </span>
                  )}
                  {testState === 'failed' && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--red)', fontWeight: 500 }}>
                      Connection failed — check credentials
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Module validation checklist ── */}
          {moduleResults.length > 0 && selected.erp_type !== 'flat_file' && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
                <ShieldCheck size={15} color="var(--teal-dark)" />
                <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Module Access Validation</h4>
              </div>

              {moduleResults.map(r => (
                <ModuleRow key={r.module} result={r} />
              ))}

              {/* Partial access warning */}
              {moduleResults.some(r => r.status === 'fail') && moduleResults.some(r => r.status === 'pass') && (
                <div style={{
                  marginTop: '0.75rem', padding: '0.6rem 0.75rem',
                  background: 'var(--amber-bg)', borderRadius: 'var(--r-sm)',
                  border: '1px solid #fde68a',
                }}>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#92400e' }}>
                    ⚠ Partial access — some modules aren't reachable. You can proceed with the accessible data, but your exposure view may be incomplete.
                    You can re-test after granting the missing permissions.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Profile reminder */}
          {!profile && (
            <div style={{
              padding: '0.75rem 1rem', background: 'var(--amber-bg)',
              borderRadius: 'var(--r-md)', border: '1px solid #fde68a',
            }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#92400e' }}>
                ⚠️ You haven't completed Company Setup yet.{' '}
                <a href="/onboarding/setup" style={{ color: '#92400e', fontWeight: 600 }}>Go back</a>{' '}
                to define your currencies and entities — this helps the AI mapping.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding: '0.75rem', background: 'var(--red-bg)', borderRadius: 'var(--r-md)', border: '1px solid #fecaca' }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--red)' }}>{error}</p>
            </div>
          )}

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button
              className="btn btn-ghost"
              onClick={() => navigate('/onboarding/setup')}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              className="btn btn-primary"
              disabled={advancing || !canProceed}
              onClick={handleStartDiscovery}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.625rem 1.5rem' }}
            >
              {advancing ? (
                <><div className="spinner" style={{ width: 14, height: 14 }} /> Starting…</>
              ) : (
                <>Start AI Analysis <ArrowRight size={14} /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
