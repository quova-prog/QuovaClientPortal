import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { CheckCircle, ArrowLeft } from 'lucide-react'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
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
            Reset your password
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            We'll send a reset link to your email
          </p>
        </div>

        {sent ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: '#10b98115', border: '1px solid #10b98130',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.25rem',
            }}>
              <CheckCircle size={22} color="var(--green)" />
            </div>
            <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Check your email</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              We sent a password reset link to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>.
              The link expires in 1 hour.
            </p>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              Didn't receive it? Check your spam folder, or{' '}
              <button onClick={() => setSent(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', fontSize: 'inherit', padding: 0 }}>
                try again
              </button>.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label className="label">Email address</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoFocus
              />
            </div>

            {error && (
              <div className="error-banner">
                {error}
              </div>
            )}

            <button
              className="btn btn-primary"
              type="submit"
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {loading
                ? <span className="spinner" style={{ width: 16, height: 16 }} />
                : 'Send reset link'
              }
            </button>
          </form>
        )}

        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '1.25rem' }}>
          <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <ArrowLeft size={13} /> Back to sign in
          </Link>
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
