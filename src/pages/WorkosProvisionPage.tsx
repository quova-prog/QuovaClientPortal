import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { OrbitMark } from '@/components/ui/OrbitMark'

export function WorkosProvisionPage() {
  const { loading, provider, provisionOrg, user, workosProvisionRequired } = useAuth()
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)' }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    )
  }

  if (provider !== 'workos') return <Navigate to="/login" replace />
  if (user) return <Navigate to="/" replace />
  if (!workosProvisionRequired) return <Navigate to="/login" replace />

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const result = await provisionOrg(orgName)
      if (result.error) setError(result.error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-app)',
      padding: '1rem',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <OrbitMark />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginTop: '0.75rem' }}>
            Create your organization
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="label">Organization</label>
            <input
              className="input"
              type="text"
              value={orgName}
              onChange={event => setOrgName(event.target.value)}
              required
              minLength={2}
              maxLength={120}
              autoFocus
            />
          </div>

          {error && <div className="error-banner">{error}</div>}

          <button
            className="btn btn-primary"
            type="submit"
            disabled={submitting || orgName.trim().length < 2}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {submitting ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
