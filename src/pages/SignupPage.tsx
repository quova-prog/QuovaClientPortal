import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export function SignupPage() {
  const { signUp } = useAuth()
  const [form, setForm] = useState({ email: '', password: '', orgName: '', fullName: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function set(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signUp(form.email, form.password, form.orgName, form.fullName)
    if (error) setError(error)
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg-app)', padding: '1rem',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ margin: '0 auto', display: 'block' }}>
            <circle cx="22" cy="22" r="7" fill="#00c8a0" />
            <ellipse cx="22" cy="22" rx="18" ry="9" stroke="#00c8a0" strokeWidth="2" fill="none" opacity="0.5" />
            <ellipse cx="22" cy="22" rx="18" ry="9" stroke="#00c8a0" strokeWidth="2" fill="none" opacity="0.5" transform="rotate(60 22 22)" />
            <ellipse cx="22" cy="22" rx="18" ry="9" stroke="#00c8a0" strokeWidth="2" fill="none" opacity="0.5" transform="rotate(120 22 22)" />
          </svg>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginTop: '0.75rem', letterSpacing: '-0.02em' }}>
            Create your account
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Set up Orbit for your organisation
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Your name</label>
              <input className="input" type="text" value={form.fullName} onChange={set('fullName')} placeholder="Jane Smith" required />
            </div>
            <div>
              <label className="label">Organisation</label>
              <input className="input" type="text" value={form.orgName} onChange={set('orgName')} placeholder="Celonis" required />
            </div>
          </div>
          <div>
            <label className="label">Work email</label>
            <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="jane@celonis.com" required />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={form.password} onChange={set('password')} placeholder="8+ characters" required minLength={8} />
          </div>
          {error && (
            <div style={{ background: '#ef444415', border: '1px solid #ef444430', borderRadius: 'var(--r-sm)', padding: '0.625rem 0.875rem', fontSize: '0.875rem', color: 'var(--red)' }}>
              {error}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}>
            {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Create account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '1.25rem' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
