import { useEffect, useState, useMemo } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

interface AuditLog {
  id: string
  user_email: string | null
  action: string
  resource: string
  resource_id: string | null
  summary: string | null
  created_at: string
}

type ActionFilter = 'all' | 'login_logout' | 'create' | 'update' | 'delete' | 'upload_export'

const ACTION_BADGE_STYLES: Record<string, { background: string; color: string }> = {
  login:   { background: 'rgba(59,130,246,0.15)',  color: '#60a5fa' },
  logout:  { background: 'rgba(59,130,246,0.15)',  color: '#60a5fa' },
  create:  { background: 'rgba(34,197,94,0.15)',   color: '#4ade80' },
  update:  { background: 'rgba(245,158,11,0.15)',  color: '#fbbf24' },
  delete:  { background: 'rgba(239,68,68,0.15)',   color: '#f87171' },
  upload:  { background: 'rgba(168,85,247,0.15)',  color: '#c084fc' },
  export:  { background: 'rgba(168,85,247,0.15)',  color: '#c084fc' },
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const mon = months[d.getMonth()]
  const day = d.getDate()
  const year = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${mon} ${day}, ${year} · ${hh}:${mm}:${ss}`
}

function ActionBadge({ action }: { action: string }) {
  const style = ACTION_BADGE_STYLES[action] ?? { background: 'rgba(100,116,139,0.15)', color: '#94a3b8' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '0.125rem 0.5rem',
      borderRadius: 999,
      fontSize: '0.6875rem',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      background: style.background,
      color: style.color,
    }}>
      {action}
    </span>
  )
}

export function AuditLogPage() {
  const { db } = useAuth()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')
  const [searchText, setSearchText] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    ;db
      .from('audit_logs')
      .select('id, user_email, action, resource, resource_id, summary, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data, error: err }: { data: AuditLog[] | null; error: any }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else setLogs(data ?? [])
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [db])

  const filtered = useMemo(() => {
    let result = logs

    if (actionFilter !== 'all') {
      const actionMap: Record<ActionFilter, string[]> = {
        all:           [],
        login_logout:  ['login', 'logout'],
        create:        ['create'],
        update:        ['update'],
        delete:        ['delete'],
        upload_export: ['upload', 'export'],
      }
      result = result.filter(l => actionMap[actionFilter].includes(l.action))
    }

    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      result = result.filter(l =>
        (l.summary ?? '').toLowerCase().includes(q) ||
        l.resource.toLowerCase().includes(q) ||
        (l.user_email ?? '').toLowerCase().includes(q)
      )
    }

    return result
  }, [logs, actionFilter, searchText])

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 'var(--r-md)', background: 'rgba(0,200,160,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <ShieldCheck size={20} color="var(--teal)" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Audit Log
          </h1>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary, #94a3b8)' }}>
            Immutable record of all actions in your organisation
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value as ActionFilter)}
          style={{
            padding: '0.375rem 0.625rem',
            background: 'var(--bg-input, var(--bg-card))',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            color: 'var(--text-primary)',
            fontSize: '0.8125rem',
            cursor: 'pointer',
          }}
        >
          <option value="all">All Actions</option>
          <option value="login_logout">Login / Logout</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="upload_export">Upload / Export</option>
        </select>

        <input
          type="text"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Search summary, resource, user…"
          style={{
            flex: 1, minWidth: 200,
            padding: '0.375rem 0.625rem',
            background: 'var(--bg-input, var(--bg-card))',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            color: 'var(--text-primary)',
            fontSize: '0.8125rem',
            outline: 'none',
          }}
        />

        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #94a3b8)', flexShrink: 0 }}>
          {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {/* Content */}
      {loading ? (
        <div className="card" style={{ padding: '3rem', display: 'flex', justifyContent: 'center' }}>
          <div className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : error ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#f87171' }}>
          Failed to load audit logs: {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <ShieldCheck size={40} color="var(--teal)" style={{ opacity: 0.4, marginBottom: '0.75rem' }} />
          <div style={{ fontSize: '0.9375rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            No audit entries found
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary, #94a3b8)' }}>
            {logs.length === 0 ? 'Actions will appear here as your team uses Orbit.' : 'Try adjusting your filters.'}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Timestamp', 'User', 'Action', 'Resource', 'Summary'].map(col => (
                  <th key={col} style={{
                    padding: '0.625rem 1rem', textAlign: 'left',
                    fontSize: '0.6875rem', fontWeight: 600,
                    color: 'var(--text-secondary, #94a3b8)',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    background: 'var(--bg-table-head, rgba(0,0,0,0.15))',
                    whiteSpace: 'nowrap',
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((log, idx) => (
                <tr
                  key={log.id}
                  style={{
                    borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                    background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.05)',
                  }}
                >
                  <td style={{ padding: '0.625rem 1rem', color: 'var(--text-secondary, #94a3b8)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTimestamp(log.created_at)}
                  </td>
                  <td style={{ padding: '0.625rem 1rem', color: 'var(--text-primary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.user_email ?? '—'}
                  </td>
                  <td style={{ padding: '0.625rem 1rem' }}>
                    <ActionBadge action={log.action} />
                  </td>
                  <td style={{ padding: '0.625rem 1rem', color: 'var(--text-primary)' }}>
                    <span style={{ fontWeight: 500 }}>{log.resource}</span>
                    {log.resource_id && (
                      <span style={{ color: 'var(--text-secondary, #94a3b8)', marginLeft: '0.375rem', fontSize: '0.75rem' }}>
                        #{log.resource_id.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.625rem 1rem', color: 'var(--text-secondary, #94a3b8)' }}>
                    {log.summary ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
