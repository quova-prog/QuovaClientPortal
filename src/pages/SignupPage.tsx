import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { QuovaMark } from '@/components/ui/QuovaMark'

export function SignupPage() {
  const { signUp } = useAuth()
  const [form, setForm] = useState({ email: '', password: '', orgName: '', fullName: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)
  const [attempts, setAttempts] = useState<number[]>([])
  const [cooldownEnd, setCooldownEnd] = useState(0)
  const [cooldownLeft, setCooldownLeft] = useState(0)

  useEffect(() => {
    if (cooldownEnd <= 0) return
    const id = setInterval(() => {
      const remaining = Math.ceil((cooldownEnd - Date.now()) / 1000)
      if (remaining <= 0) { setCooldownLeft(0); setCooldownEnd(0); clearInterval(id) }
      else setCooldownLeft(remaining)
    }, 1000)
    return () => clearInterval(id)
  }, [cooldownEnd])

  function set(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Rate limiting: max 3 attempts per 60 seconds
    const now = Date.now()
    const recentAttempts = attempts.filter(t => now - t < 60000)
    if (recentAttempts.length >= 3) {
      const waitUntil = recentAttempts[0] + 60000
      setCooldownEnd(waitUntil)
      setCooldownLeft(Math.ceil((waitUntil - now) / 1000))
      return
    }
    setAttempts([...recentAttempts, now])

    setError('')
    setLoading(true)
    try {
      const { error, confirmationRequired } = await signUp(form.email, form.password, form.orgName, form.fullName)
      if (error) setError(error)
      else if (confirmationRequired) setConfirmationSent(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  if (confirmationSent) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--bg-app)', padding: '1rem',
      }}>
        <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%', background: 'var(--teal-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1.25rem',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
            Check your inbox
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
            We sent a confirmation link to <strong style={{ color: 'var(--text-primary)' }}>{form.email}</strong>.
            Click it to activate your account — your organisation will be set up automatically.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '1.5rem' }}>
            Already confirmed? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg-app)', padding: '1rem',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <QuovaMark />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginTop: '0.75rem', letterSpacing: '-0.02em' }}>
            Create your account
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Set up Quova for your organisation
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
          {cooldownLeft > 0 && (
            <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 8, padding: '0.75rem 1rem', color: '#f59e0b', fontSize: '0.875rem', fontWeight: 500, textAlign: 'center' }}>
              Too many attempts. Please wait {cooldownLeft} seconds.
            </div>
          )}
          {error && (
            <div className="error-banner">
              {error}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={loading || cooldownLeft > 0} style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}>
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
