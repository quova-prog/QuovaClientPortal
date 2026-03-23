import { useState, useRef } from 'react'
import { Upload, Download, Trash2, Filter, Search, FileText, CheckCircle, AlertCircle, X } from 'lucide-react'
import { useExposures } from '@/hooks/useData'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { parseWorkdayCsv, downloadCsvTemplate } from '@/lib/csvParser'
import { formatCurrency, formatDate, daysUntil, currencyFlag } from '@/lib/utils'
import type { ParsedExposure } from '@/types'

type UploadState = 'idle' | 'parsing' | 'preview' | 'uploading' | 'done' | 'error'

export function ExposurePage() {
  const { exposures, loading, refresh, deleteExposure } = useExposures()
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [preview, setPreview] = useState<ParsedExposure[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [filename, setFilename] = useState('')
  const [search, setSearch] = useState('')
  const [filterDir, setFilterDir] = useState<'all' | 'receivable' | 'payable'>('all')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Filter exposures
  const filtered = exposures.filter(e => {
    const matchesSearch = !search || [e.entity, e.currency_pair, e.description ?? '']
      .some(s => s.toLowerCase().includes(search.toLowerCase()))
    const matchesDir = filterDir === 'all' || e.direction === filterDir
    return matchesSearch && matchesDir
  })

  // Handle file selection
  async function handleFile(file: File) {
    setFilename(file.name)
    setUploadState('parsing')
    setParseErrors([])
    setParseWarnings([])
    const result = await parseWorkdayCsv(file)
    setParseErrors(result.errors)
    setParseWarnings(result.warnings)
    if (result.rows.length > 0) {
      setPreview(result.rows)
      setUploadState('preview')
    } else {
      setUploadState('error')
    }
  }

  // Confirm upload
  async function confirmUpload() {
    if (!user?.profile?.org_id || preview.length === 0) return
    setUploadState('uploading')

    // Create batch record
    const { data: batch } = await supabase
      .from('upload_batches')
      .insert({ org_id: user.profile.org_id, filename, row_count: preview.length, status: 'processing' })
      .select().single()

    // Insert exposures
    const rows = preview.map(row => ({
      ...row,
      org_id: user.profile!.org_id,
      upload_batch_id: batch?.id ?? null,
    }))

    const { error } = await supabase.from('fx_exposures').insert(rows)

    if (!error && batch) {
      await supabase.from('upload_batches').update({ status: 'complete' }).eq('id', batch.id)
    }

    setUploadState('done')
    setPreview([])
    refresh()
  }

  function cancelUpload() {
    setUploadState('idle')
    setPreview([])
    setParseErrors([])
    setParseWarnings([])
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleDelete(id: string) {
    await deleteExposure(id)
    setConfirmDeleteId(null)
  }

  return (
    <div style={{ padding: '1.75rem', maxWidth: 1200 }} className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Exposure Ledger</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            {exposures.length} open exposure{exposures.length !== 1 ? 's' : ''} · Upload from Workday CSV
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={downloadCsvTemplate}>
            <Download size={14} /> Template
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Upload CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
      </div>

      {/* Upload Panel */}
      {uploadState !== 'idle' && uploadState !== 'done' && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: uploadState === 'error' ? 'var(--red)' : 'var(--teal)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <FileText size={16} color="var(--teal)" />
              <span style={{ fontWeight: 500 }}>{filename}</span>
            </div>
            {uploadState !== 'uploading' && (
              <button onClick={cancelUpload} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={16} />
              </button>
            )}
          </div>

          {uploadState === 'parsing' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.875rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              <div className="spinner" /> Parsing CSV…
            </div>
          )}

          {parseErrors.length > 0 && (
            <div style={{ marginTop: '0.75rem', background: '#ef444415', border: '1px solid #ef444430', borderRadius: 'var(--r-sm)', padding: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--red)', fontWeight: 500, fontSize: '0.8125rem', marginBottom: '0.4rem' }}>
                <AlertCircle size={13} /> {parseErrors.length} error{parseErrors.length !== 1 ? 's' : ''} found
              </div>
              {parseErrors.slice(0, 5).map((e, i) => <div key={i} style={{ fontSize: '0.8125rem', color: 'var(--red)', opacity: 0.85 }}>{e}</div>)}
            </div>
          )}

          {parseWarnings.length > 0 && (
            <div style={{ marginTop: '0.625rem', background: '#f59e0b15', border: '1px solid #f59e0b30', borderRadius: 'var(--r-sm)', padding: '0.625rem 0.75rem' }}>
              {parseWarnings.slice(0, 3).map((w, i) => <div key={i} style={{ fontSize: '0.8125rem', color: 'var(--amber)' }}>⚠ {w}</div>)}
            </div>
          )}

          {uploadState === 'preview' && preview.length > 0 && (
            <>
              <div style={{ marginTop: '1rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--teal)', fontWeight: 500, fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                  <CheckCircle size={14} /> {preview.length} rows ready to import
                </div>
                {/* Preview table */}
                <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
                  <table className="data-table" style={{ fontSize: '0.8125rem' }}>
                    <thead>
                      <tr>
                        <th>Entity</th><th>Pair</th><th>Direction</th>
                        <th className="text-right">Notional</th><th>Settlement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.slice(0, 10).map((row, i) => (
                        <tr key={i}>
                          <td>{row.entity}</td>
                          <td style={{ fontWeight: 500 }}>{row.currency_pair}</td>
                          <td>
                            <span className={`badge badge-${row.direction === 'receivable' ? 'green' : 'blue'}`}>
                              {row.direction}
                            </span>
                          </td>
                          <td className="text-right mono">{formatCurrency(row.notional_base, row.base_currency)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{formatDate(row.settlement_date)}</td>
                        </tr>
                      ))}
                      {preview.length > 10 && (
                        <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>…and {preview.length - 10} more</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-primary" onClick={confirmUpload}>
                  <Upload size={14} /> Import {preview.length} rows
                </button>
                <button className="btn btn-ghost" onClick={cancelUpload}>Cancel</button>
              </div>
            </>
          )}

          {uploadState === 'uploading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.875rem', color: 'var(--teal)', fontSize: '0.875rem' }}>
              <div className="spinner" style={{ borderTopColor: 'var(--teal)' }} /> Importing…
            </div>
          )}
        </div>
      )}

      {uploadState === 'done' && (
        <div style={{ marginBottom: '1rem', background: '#00c8a015', border: '1px solid #00c8a030', borderRadius: 'var(--r-md)', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--teal)', fontSize: '0.875rem' }}>
          <CheckCircle size={15} /> Import complete — exposure ledger updated.
          <button onClick={() => setUploadState('idle')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)' }}><X size={14} /></button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1rem' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
          <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input className="input" style={{ paddingLeft: '2.25rem' }} placeholder="Search entity, currency, description…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {(['all', 'receivable', 'payable'] as const).map(dir => (
          <button key={dir} onClick={() => setFilterDir(dir)}
            className={`btn btn-sm ${filterDir === dir ? 'btn-primary' : 'btn-ghost'}`}>
            {dir === 'all' ? 'All' : dir === 'receivable' ? '↑ Receivable' : '↓ Payable'}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8125rem', display: 'flex', alignItems: 'center' }}>
          {filtered.length} of {exposures.length}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <div className="spinner" style={{ width: 24, height: 24 }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <Upload size={32} />
            <h3>No exposures{search ? ' matching your search' : ''}</h3>
            {!search && <p style={{ fontSize: '0.875rem' }}>Upload a Workday CSV to populate the ledger.</p>}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Currency Pair</th>
                  <th>Direction</th>
                  <th className="text-right">Notional</th>
                  <th>Settlement Date</th>
                  <th>Days</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const days = daysUntil(e.settlement_date)
                  return (
                    <tr key={e.id}>
                      <td style={{ fontWeight: 500 }}>{e.entity}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          <span>{currencyFlag(e.base_currency)}</span>
                          <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{e.currency_pair}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge badge-${e.direction === 'receivable' ? 'green' : 'blue'}`}>
                          {e.direction === 'receivable' ? '↑' : '↓'} {e.direction}
                        </span>
                      </td>
                      <td className="text-right mono" style={{ fontWeight: 500 }}>
                        {formatCurrency(e.notional_base, e.base_currency)}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{formatDate(e.settlement_date)}</td>
                      <td>
                        <span style={{ fontSize: '0.8125rem', color: days < 0 ? 'var(--text-muted)' : days <= 14 ? 'var(--red)' : days <= 30 ? 'var(--amber)' : 'var(--text-muted)' }}>
                          {days < 0 ? 'Past' : `${days}d`}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.description || '—'}
                      </td>
                      <td>
                        <span className={`badge badge-${e.status === 'open' ? 'teal' : 'gray'}`}>
                          {e.status}
                        </span>
                      </td>
                      <td>
                        {confirmDeleteId === e.id ? (
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(e.id)}>Delete</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(e.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem', borderRadius: 'var(--r-sm)' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
