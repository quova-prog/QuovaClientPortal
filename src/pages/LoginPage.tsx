import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) setError(error)
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg-app)', padding: '1rem',
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <OrbitMark />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginTop: '0.75rem', letterSpacing: '-0.02em' }}>
            Sign in to Orbit
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            FX Risk Intelligence Platform
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.375rem' }}>
              <label className="label" style={{ margin: 0 }}>Password</label>
              <Link to="/forgot-password" style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Forgot password?
              </Link>
            </div>
            <input className="input" type="password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          {error && (
            <div style={{ background: '#ef444415', border: '1px solid #ef444430', borderRadius: 'var(--r-sm)', padding: '0.625rem 0.875rem', fontSize: '0.875rem', color: 'var(--red)' }}>
              {error}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}>
            {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Sign in'}
          </button>
        </form>

        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '1.25rem' }}>
          Don't have an account?{' '}
          <Link to="/signup">Create one</Link>
        </p>
      </div>
    </div>
  )
}

function OrbitMark() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ margin: '0 auto', display: 'block' }}>
      <circle cx="22" cy="22" r="7" fill="#00c8a0" />
      <ellipse cx="22" cy="22" rx="18" ry="9" stroke="#00c8a0" strokeWidth="2" fill="none" opacity="0.5" />
      <ellipse cx="22" cy="22" rx="18" ry="9" stroke="#00c8a0" strokeWidth="2" fill="none" opacity="0.5" transform="rotate(60 22 22)" />
      <ellipse cx="22" cy="22" rx="18" ry="9" stroke="#00c8a0" strokeWidth="2" fill="none" opacity="0.5" transform="rotate(120 22 22)" />
    </svg>
  )
}
