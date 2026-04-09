import { useState, useRef, useCallback } from 'react'
import { Upload, FileText, X, Download, AlertTriangle, CheckCircle } from 'lucide-react'
import Papa from 'papaparse'
import { prepareForAI, stripPIIString } from '@/lib/piiStripper'
import type { FlatFileSchema } from '@/lib/discoveryService'

const TEMPLATE_HEADERS = [
  'transaction_id', 'transaction_type', 'transaction_currency',
  'notional_amount', 'settlement_date', 'counterparty', 'entity',
  'posting_date', 'functional_amount', 'cost_center', 'description', 'status',
]

const TEMPLATE_EXAMPLE = [
  'INV-2025-001', 'ap_invoice', 'EUR', '150000.00', '2025-06-15',
  'Siemens AG', 'Orbit US Inc', '2025-01-15', '162000.00',
  'Engineering', 'Q1 software license payment', 'open',
]

interface FlatFileUploaderProps {
  onParsed: (schema: FlatFileSchema, strippedRows: Record<string, string>[]) => void
}

export function FlatFileUploader({ onParsed }: FlatFileUploaderProps): React.ReactElement {
  const [isDragging, setIsDragging] = useState(false)
  const [file,       setFile]       = useState<File | null>(null)
  const [parsing,    setParsing]    = useState(false)
  const [errors,     setErrors]     = useState<string[]>([])
  const [preview,    setPreview]    = useState<{
    rowCount: number
    columns:  string[]
    currencies: string[]
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const parseFile = useCallback((f: File) => {
    setParsing(true)
    setErrors([])
    setPreview(null)

    Papa.parse<Record<string, string>>(f, {
      header:         true,
      skipEmptyLines: true,
      complete: result => {
        const errs: string[] = []
        const rows    = result.data
        const columns = result.meta.fields ?? []

        if (rows.length === 0) {
          setErrors(['The file appears to be empty or has no data rows.'])
          setParsing(false)
          return
        }

        // Detect ISO currency codes in any column
        const ISO_CCY = /^[A-Z]{3}$/
        const currencies = new Set<string>()
        for (const row of rows.slice(0, 200)) {
          for (const val of Object.values(row)) {
            if (ISO_CCY.test((val ?? '').trim())) currencies.add(val.trim())
          }
        }

        // Build FlatFileSchema
        const schema: FlatFileSchema = {
          columns: columns.map(col => {
            const samples = rows.slice(0, 20)
              .map(r => (r[col] ?? '').trim())
              .filter(Boolean)

            let dataType = 'text'
            if (samples.length > 0) {
              if (samples.every(s => !isNaN(Number(s.replace(/[$,\s]/g, ''))))) dataType = 'numeric'
              else if (samples.every(s =>
                /^\d{4}-\d{2}-\d{2}/.test(s) ||
                /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s)
              )) dataType = 'date'
              else if (samples.every(s => ISO_CCY.test(s))) dataType = 'currency_code'
            }
            return { name: col, sampleValues: samples.slice(0, 10).map(stripPIIString), dataType }
          }),
          rowCount: rows.length,
          fileName: f.name,
        }

        const strippedRows = prepareForAI(
          rows as unknown as Record<string, unknown>[],
        ) as Record<string, string>[]

        setPreview({ rowCount: rows.length, columns, currencies: [...currencies] })
        setParsing(false)

        if (errs.length === 0) {
          // Persist raw rows for GoLive to import into fx_exposures
          try {
            sessionStorage.setItem('orbit_onboarding_raw_rows', JSON.stringify(rows))
          } catch { /* sessionStorage might be full */ }
          onParsed(schema, strippedRows)
        } else {
          setErrors(errs)
        }
      },
      error: err => {
        setErrors([`Parse error: ${err.message}`])
        setParsing(false)
      },
    })
  }, [onParsed])

  const handleFile = useCallback((f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv') {
      setErrors(['Please upload a CSV file (.csv).'])
      return
    }
    setFile(f)
    parseFile(f)
  }, [parseFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  function downloadTemplate(): void {
    const csv = [TEMPLATE_HEADERS.join(','), TEMPLATE_EXAMPLE.join(',')].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'orbit-exposure-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

      {/* Template download banner */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.75rem 1rem', gap: 16,
        background: 'var(--bg-surface)', borderRadius: 'var(--r-md)',
        border: '1px solid var(--border)',
      }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem' }}>
            Don't have your own format?
          </p>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Download our template with all columns pre-configured.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={downloadTemplate}
          style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <Download size={12} /> Download Template
        </button>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragging ? 'var(--teal)' : preview ? 'var(--teal)' : 'var(--border)'}`,
          borderRadius: 'var(--r-lg)', padding: '2rem 1.5rem',
          textAlign: 'center', cursor: 'pointer',
          background: isDragging ? 'var(--teal-dim)' : preview ? '#f0fdfa' : 'var(--bg-surface)',
          transition: 'all 0.15s',
        }}
      >
        <input
          ref={inputRef} type="file" accept=".csv"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />

        {parsing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div className="spinner" style={{ width: 22, height: 22 }} />
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Parsing file…</p>
          </div>
        ) : file && preview ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <FileText size={26} color="var(--teal)" />
            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem' }}>{file.name}</p>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {preview.rowCount.toLocaleString()} rows · {preview.columns.length} columns
            </p>
            <button
              onClick={e => { e.stopPropagation(); setFile(null); setPreview(null) }}
              style={{
                all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center',
                gap: 4, fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4,
              }}
            >
              <X size={11} /> Remove file
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <Upload size={26} color="var(--text-muted)" />
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem' }}>
                Drag & drop your file here
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                or click to browse · CSV · Max 50 MB
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div style={{
          display: 'flex', gap: 8, padding: '0.75rem',
          background: 'var(--red-bg)', borderRadius: 'var(--r-md)',
          border: '1px solid #fecaca',
        }}>
          <AlertTriangle size={14} color="var(--red)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            {errors.map((e, i) => (
              <p key={i} style={{ margin: 0, fontSize: '0.8rem', color: 'var(--red)' }}>{e}</p>
            ))}
          </div>
        </div>
      )}

      {/* Success preview */}
      {preview && errors.length === 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '0.75rem 1rem',
          background: '#f0fdfa', borderRadius: 'var(--r-md)',
          border: '1px solid #99f6e4',
        }}>
          <CheckCircle size={15} color="var(--teal-dark)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem', color: 'var(--teal-dark)' }}>
              File ready for AI analysis
            </p>
            <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {preview.rowCount.toLocaleString()} rows · {preview.columns.length} columns
              {preview.currencies.length > 0 && ` · Currencies: ${preview.currencies.join(', ')}`}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
