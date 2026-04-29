import { useState, useRef, useCallback } from 'react'
import { Upload, Check, AlertCircle, CheckCircle, X } from 'lucide-react'
import { useEntity } from '@/context/EntityContext'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UploadWizardProps<T extends Record<string, any>> {
  label: string
  icon: React.FC<any>
  color: string
  accept?: string
  parse: (file: File) => Promise<{ data: T[]; errors: string[]; warnings?: string[] }>
  columns: { key: string; label: string; format?: (val: any, row: T) => string }[]
  onImport: (rows: T[], entityId: string | null, file: File | null) => Promise<{ error: string | null }>
  onDone?: () => void
  downloadTemplate?: () => void
}

type Step = 1 | 2 | 3 | 4

const STEP_LABELS: Record<number, string> = {
  1: 'Entity',
  2: 'File',
  3: 'Review',
  4: 'Done',
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Step Indicator ────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem' }}>
      {([1, 2, 3, 4] as const).map((num, i) => (
        <div
          key={num}
          style={{ display: 'flex', alignItems: 'center', flex: i < 3 ? 1 : 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 700,
                flexShrink: 0,
                background:
                  step === num
                    ? '#00c8a0'
                    : step > num
                    ? 'var(--bg-surface)'
                    : 'var(--bg-surface)',
                color:
                  step === num
                    ? '#fff'
                    : step > num
                    ? '#00c8a0'
                    : 'var(--text-muted)',
                border:
                  step === num
                    ? 'none'
                    : step > num
                    ? '2px solid #00c8a0'
                    : '1px solid var(--border-dim)',
              }}
            >
              {step > num ? <Check size={12} /> : num}
            </div>
            <span
              style={{
                fontSize: '0.8125rem',
                fontWeight: step === num ? 600 : 400,
                color: step === num ? 'var(--text-primary)' : 'var(--text-muted)',
                whiteSpace: 'nowrap',
              }}
            >
              {STEP_LABELS[num]}
            </span>
          </div>
          {i < 3 && (
            <div
              style={{
                flex: 1,
                height: 1,
                background: step > num ? '#00c8a0' : 'var(--border-dim)',
                margin: '0 0.75rem',
              }}
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function UploadWizard<T extends Record<string, any>>({
  label,
  icon: Icon,
  color,
  accept = '.csv',
  parse,
  columns,
  onImport,
  onDone,
  downloadTemplate,
}: UploadWizardProps<T>) {
  const { entities } = useEntity()

  const [step, setStep] = useState<Step>(1)
  const [entityId, setEntityId] = useState<string | null>(null)

  // Step 2 state
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [parseResult, setParseResult] = useState<{
    data: T[]
    errors: string[]
    warnings: string[]
  } | null>(null)

  // Step 3 state
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // Step 4 state
  const [importedCount, setImportedCount] = useState(0)

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleFile = useCallback(
    async (file: File) => {
      // ── File type validation ────────────────────────────────────────────────
      const allowed = accept.split(',').map(s => s.trim().toLowerCase())
      const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase()
      if (!allowed.includes(ext)) {
        setParseResult({
          data: [],
          errors: [`Unsupported file type "${ext}". Accepted: ${allowed.join(', ')}.`],
          warnings: [],
        })
        setSelectedFile(file)
        return
      }

      // ── File size validation ────────────────────────────────────────────────
      const MB = 1024 * 1024
      if (file.size > 100 * MB) {
        setParseResult({
          data: [],
          errors: [`File is too large (${formatFileSize(file.size)}). Maximum allowed size is 100 MB.`],
          warnings: [],
        })
        setSelectedFile(file)
        return
      }

      setParsing(true)
      setParseResult(null)
      setImportError(null)
      setSelectedFile(file)

      const sizeWarning = file.size > 50 * MB
        ? [`Large file (${formatFileSize(file.size)}) — parsing may be slow.`]
        : []

      const result = await parse(file)
      setParseResult({
        data: result.data,
        errors: result.errors,
        warnings: [...sizeWarning, ...(result.warnings ?? [])],
      })
      setParsing(false)
    },
    [accept, parse]
  )

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  function handleClearFile() {
    setSelectedFile(null)
    setParseResult(null)
    setImportError(null)
  }

  async function handleImport() {
    if (!parseResult || parseResult.data.length === 0) return
    setImporting(true)
    setImportError(null)
    const result = await onImport(parseResult.data, entityId, selectedFile)
    if (result.error) {
      setImportError(result.error)
      setImporting(false)
    } else {
      setImportedCount(parseResult.data.length)
      setImporting(false)
      setStep(4)
    }
  }

  function handleUploadAnother() {
    setStep(1)
    setEntityId(null)
    setSelectedFile(null)
    setParseResult(null)
    setImportError(null)
    setImportedCount(0)
  }

  // ── Entity name lookup ─────────────────────────────────────────────────────

  const selectedEntity = entityId ? entities.find(e => e.id === entityId) ?? null : null

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border-dim)',
        borderRadius: 'var(--r-lg)',
        padding: '1.5rem',
        maxWidth: 720,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1.5rem',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 'var(--r-md)',
            background: color + '22',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon size={18} color={color} />
        </div>
        <div>
          <div
            style={{
              fontWeight: 600,
              fontSize: '0.9375rem',
              color: 'var(--text-primary)',
            }}
          >
            Import {label}
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            {accept.toUpperCase().replace('.', '')} upload wizard
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <StepIndicator step={step} />

      {/* ── STEP 1: ENTITY ── */}
      {step === 1 && (
        <div>
          <div
            style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '0.375rem',
            }}
          >
            Which entity is this data for?
          </div>
          <div
            style={{
              fontSize: '0.8125rem',
              color: 'var(--text-muted)',
              marginBottom: '1rem',
            }}
          >
            Select an entity to associate this upload with, or leave unassigned.
          </div>

          <select
            value={entityId ?? ''}
            onChange={e => setEntityId(e.target.value === '' ? null : e.target.value)}
            style={{
              width: '100%',
              padding: '0.625rem 0.75rem',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-dim)',
              borderRadius: 'var(--r-md)',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
              marginBottom: '1.5rem',
              cursor: 'pointer',
            }}
          >
            <option value="">All entities (unassigned)</option>
            {entities.map(e => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.functional_currency}
              </option>
            ))}
          </select>

          {entityId && selectedEntity && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.375rem 0.625rem',
                background: color + '14',
                border: `1px solid ${color}44`,
                borderRadius: 'var(--r-md)',
                marginBottom: '1.5rem',
              }}
            >
              <span
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                {selectedEntity.name}
              </span>
              <span
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  padding: '0.125rem 0.375rem',
                  background: color + '33',
                  color: color,
                  borderRadius: 999,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {selectedEntity.functional_currency}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setStep(2)}
              style={{
                padding: '0.5rem 1.25rem',
                background: '#00c8a0',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--r-md)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Next: Select File →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: FILE ── */}
      {step === 2 && (
        <div>
          {/* Drop zone */}
          <div
            onDragOver={e => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !selectedFile && fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? '#00c8a0' : 'var(--border-dim)'}`,
              borderRadius: 'var(--r-lg)',
              padding: '2.5rem 1.5rem',
              textAlign: 'center',
              cursor: selectedFile ? 'default' : 'pointer',
              background: dragging ? 'rgba(0,200,160,0.04)' : 'var(--bg-surface)',
              transition: 'all 0.15s',
              marginBottom: '1.25rem',
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept={accept}
              style={{ display: 'none' }}
              onChange={handleInputChange}
            />

            {parsing ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.75rem',
                }}
              >
                <div className="spinner" style={{ width: 28, height: 28 }} />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  Parsing file…
                </span>
              </div>
            ) : selectedFile && parseResult ? (
              <div style={{ textAlign: 'left' }}>
                {/* File info bar */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.875rem',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}
                  >
                    <Upload size={16} style={{ color: '#00c8a0' }} />
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '0.875rem',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {selectedFile.name}
                    </span>
                    <span
                      style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}
                    >
                      {formatFileSize(selectedFile.size)} ·{' '}
                      {parseResult.data.length} row
                      {parseResult.data.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      handleClearFile()
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      padding: '0.25rem',
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Errors */}
                {parseResult.errors.length > 0 && (
                  <div
                    style={{
                      background: 'rgba(239,68,68,0.08)',
                      border: '1px solid rgba(239,68,68,0.25)',
                      borderRadius: 'var(--r-md)',
                      padding: '0.625rem 0.875rem',
                      marginBottom: '0.625rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.375rem',
                        color: '#ef4444',
                        fontWeight: 600,
                        fontSize: '0.8125rem',
                        marginBottom: '0.375rem',
                      }}
                    >
                      <AlertCircle size={13} />
                      {parseResult.errors.length} parse error
                      {parseResult.errors.length !== 1 ? 's' : ''}
                    </div>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: '1.125rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.2rem',
                      }}
                    >
                      {parseResult.errors.slice(0, 5).map((err, i) => (
                        <li
                          key={i}
                          style={{ fontSize: '0.75rem', color: '#ef4444' }}
                        >
                          {err}
                        </li>
                      ))}
                      {parseResult.errors.length > 5 && (
                        <li
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                          }}
                        >
                          …and {parseResult.errors.length - 5} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Warnings */}
                {parseResult.warnings.length > 0 && (
                  <div
                    style={{
                      background: 'rgba(245,158,11,0.08)',
                      border: '1px solid rgba(245,158,11,0.25)',
                      borderRadius: 'var(--r-md)',
                      padding: '0.625rem 0.875rem',
                      marginBottom: '0.625rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.375rem',
                        color: '#f59e0b',
                        fontWeight: 600,
                        fontSize: '0.8125rem',
                      }}
                    >
                      <AlertCircle size={13} />
                      {parseResult.warnings.length} warning
                      {parseResult.warnings.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.625rem',
                }}
              >
                <Upload size={28} style={{ color: '#00c8a0', opacity: 0.7 }} />
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    fontSize: '0.9375rem',
                  }}
                >
                  Drop {accept.toUpperCase().replace('.', '')} file here
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                  or click to browse
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => setStep(1)}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'none',
                  border: '1px solid var(--border-dim)',
                  borderRadius: 'var(--r-md)',
                  fontSize: '0.875rem',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
              {downloadTemplate && (
                <button
                  onClick={downloadTemplate}
                  style={{
                    padding: '0.5rem 1rem',
                    background: 'none',
                    border: '1px solid var(--border-dim)',
                    borderRadius: 'var(--r-md)',
                    fontSize: '0.8125rem',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  Download Template
                </button>
              )}
            </div>
            <button
              onClick={() => setStep(3)}
              disabled={!parseResult || parseResult.data.length === 0}
              style={{
                padding: '0.5rem 1.25rem',
                background:
                  parseResult && parseResult.data.length > 0 ? '#00c8a0' : 'var(--bg-surface)',
                color:
                  parseResult && parseResult.data.length > 0
                    ? '#fff'
                    : 'var(--text-muted)',
                border: 'none',
                borderRadius: 'var(--r-md)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor:
                  parseResult && parseResult.data.length > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              Next: Review →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: REVIEW ── */}
      {step === 3 && parseResult && (
        <div>
          {/* Errors banner */}
          {parseResult.errors.length > 0 && (
            <div
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 'var(--r-md)',
                padding: '0.75rem 1rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
              }}
            >
              <AlertCircle
                size={15}
                style={{ color: '#ef4444', flexShrink: 0, marginTop: '0.125rem' }}
              />
              <div>
                <div
                  style={{
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: '#ef4444',
                    marginBottom: '0.25rem',
                  }}
                >
                  {parseResult.errors.length} row
                  {parseResult.errors.length !== 1 ? 's' : ''} had errors and were skipped
                </div>
                {parseResult.errors.slice(0, 3).map((e, i) => (
                  <div key={i} style={{ fontSize: '0.75rem', color: '#ef4444' }}>
                    {e}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Table preview */}
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              marginBottom: '0.5rem',
              fontWeight: 500,
            }}
          >
            Preview — first {Math.min(parseResult.data.length, 10)} of{' '}
            {parseResult.data.length} rows
          </div>

          <div
            style={{
              border: '1px solid var(--border-dim)',
              borderRadius: 'var(--r-md)',
              overflow: 'hidden',
              marginBottom: '1.25rem',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.8125rem',
                }}
              >
                <thead>
                  <tr>
                    {columns.map(col => (
                      <th
                        key={col.key}
                        style={{
                          padding: '0.5rem 0.75rem',
                          color: 'var(--text-muted)',
                          fontWeight: 500,
                          fontSize: '0.75rem',
                          borderBottom: '1px solid var(--border-dim)',
                          textAlign: 'left',
                          whiteSpace: 'nowrap',
                          background: 'var(--bg-surface)',
                        }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parseResult.data.slice(0, 10).map((row, i) => (
                    <tr
                      key={i}
                      style={{
                        borderBottom:
                          i < Math.min(parseResult.data.length, 10) - 1
                            ? '1px solid var(--border-dim)'
                            : 'none',
                      }}
                    >
                      {columns.map(col => (
                        <td
                          key={col.key}
                          style={{
                            padding: '0.5rem 0.75rem',
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            maxWidth: 180,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {col.format
                            ? col.format(row[col.key], row)
                            : row[col.key] ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Import error */}
          {importError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                padding: '0.75rem 1rem',
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 'var(--r-md)',
                marginBottom: '1rem',
              }}
            >
              <AlertCircle
                size={15}
                style={{ color: '#ef4444', flexShrink: 0, marginTop: '0.125rem' }}
              />
              <span style={{ fontSize: '0.8125rem', color: '#ef4444' }}>
                {importError}
              </span>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <button
              onClick={() => setStep(2)}
              disabled={importing}
              style={{
                padding: '0.5rem 1rem',
                background: 'none',
                border: '1px solid var(--border-dim)',
                borderRadius: 'var(--r-md)',
                fontSize: '0.875rem',
                color: 'var(--text-muted)',
                cursor: importing ? 'not-allowed' : 'pointer',
              }}
            >
              ← Back
            </button>
            <button
              onClick={handleImport}
              disabled={importing || parseResult.data.length === 0}
              style={{
                padding: '0.5rem 1.25rem',
                background: '#00c8a0',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--r-md)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: importing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
              }}
            >
              {importing ? (
                <>
                  <div className="spinner" style={{ width: 14, height: 14 }} />
                  Importing…
                </>
              ) : (
                <>
                  <Check size={14} />
                  Import {parseResult.data.length} row
                  {parseResult.data.length !== 1 ? 's' : ''}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 4: DONE ── */}
      {step === 4 && (
        <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#00c8a0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
            }}
          >
            <CheckCircle size={28} color="#fff" />
          </div>
          <div
            style={{
              fontSize: '1rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: '0.375rem',
            }}
          >
            Import Successful
          </div>
          <div
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              marginBottom: '1.5rem',
            }}
          >
            {importedCount} {label.toLowerCase()} row{importedCount !== 1 ? 's' : ''}{' '}
            imported
            {selectedEntity ? ` for ${selectedEntity.name}` : ' (all entities)'}
          </div>
          <div
            style={{
              display: 'flex',
              gap: '0.625rem',
              justifyContent: 'center',
            }}
          >
            <button
              onClick={handleUploadAnother}
              style={{
                padding: '0.5rem 1.125rem',
                background: 'none',
                border: '1px solid var(--border-dim)',
                borderRadius: 'var(--r-md)',
                fontSize: '0.875rem',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              Upload Another
            </button>
            {onDone && (
              <button
                onClick={onDone}
                style={{
                  padding: '0.5rem 1.125rem',
                  background: '#00c8a0',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--r-md)',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                View {label} →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
