import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { CheckCircle, Eye, EyeOff } from 'lucide-react'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [validSession, setValidSession] = useState(false)
  const [checking, setChecking] = useState(true)

  // Supabase sends the recovery token in the URL hash.
  // When we detect a SIGNED_IN event after a PASSWORD_RECOVERY event, we have a valid session.
  useEffect(() => {
    // Check if there's a recovery token in the URL
    const hash = window.location.hash
    if (hash && hash.includes('type=recovery')) {
      setValidSession(true)
      setChecking(false)
      return
    }

    // Also listen for auth state changes (Supabase sets session from URL automatically)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setValidSession(true)
      }
      setChecking(false)
    })

    // Give it a moment to process the URL hash
    const timer = setTimeout(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) setValidSession(true)
        setChecking(false)
      })
    }, 500)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(error.message)
    } else {
      setDone(true)
      setTimeout(() => navigate('/dashboard'), 2500)
    }
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)' }}>
        <div className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    )
  }

  if (!validSession) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)', padding: '1rem' }}>
        <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
          <div className="card">
            <h2 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Link expired or invalid</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              This password reset link has expired or already been used. Please request a new one.
            </p>
            <a href="/forgot-password" className="btn btn-primary" style={{ textDecoration: 'none', justifyContent: 'center', display: 'inline-flex', width: '100%' }}>
              Request new link
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg-app)', padding: '1rem',
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ margin: '0 auto', display: 'block' }}>
            <circle cx="22" cy="22" r="7" fill="#00c8a0" />
            <ellipse cx="22" cy="22" rx="18" ry="9" stroke="#00c8a0" strokeWidth="2" fill="none" opacity="0.5" />
            <ellipse cx="22" cy="22" rx="18" ry="9" stroke="#00c8a0" strokeWidth="2" fill="none" opacity="0.5" transform="rotate(60 22 22)" />
            <ellipse cx="22" cy="22" rx="18" ry="9" stroke="#00c8a0" strokeWidth="2" fill="none" opacity="0.5" transform="rotate(120 22 22)" />
          </svg>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginTop: '0.75rem', letterSpacing: '-0.02em' }}>
            Set new password
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Choose a strong password for your account
          </p>
        </div>

        {done ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: '#10b98115', border: '1px solid #10b98130',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.25rem',
            }}>
              <CheckCircle size={22} color="var(--green)" />
            </div>
            <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Password updated</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Redirecting you to the dashboard…
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label className="label">New password</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="8+ characters"
                  required
                  minLength={8}
                  style={{ paddingRight: '2.5rem' }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  style={{
                    position: 'absolute', right: '0.75rem', top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', padding: '0.125rem',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>

              {/* Strength indicator */}
              {password.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '3px', marginBottom: '0.25rem' }}>
                    {[1, 2, 3, 4].map(i => {
                      const strength = getStrength(password)
                      return (
                        <div key={i} style={{
                          flex: 1, height: 3, borderRadius: 2,
                          background: i <= strength ? strengthColor(strength) : 'var(--border)',
                          transition: 'background 0.2s',
                        }} />
                      )
                    })}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: strengthColor(getStrength(password)) }}>
                    {strengthLabel(getStrength(password))}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label className="label">Confirm password</label>
              <input
                className="input"
                type={showPw ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                required
                style={{
                  borderColor: confirm && confirm !== password ? 'var(--red)' : undefined,
                }}
              />
              {confirm && confirm !== password && (
                <p style={{ fontSize: '0.75rem', color: 'var(--red)', marginTop: '0.3rem' }}>
                  Passwords do not match
                </p>
              )}
            </div>

            {error && (
              <div style={{
                background: '#ef444415', border: '1px solid #ef444430',
                borderRadius: 'var(--r-sm)', padding: '0.625rem 0.875rem',
                fontSize: '0.875rem', color: 'var(--red)',
              }}>
                {error}
              </div>
            )}

            <button
              className="btn btn-primary"
              type="submit"
              disabled={loading || !password || password !== confirm}
              style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}
            >
              {loading
                ? <span className="spinner" style={{ width: 16, height: 16 }} />
                : 'Update password'
              }
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function getStrength(pw: string): number {
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/[0-9!@#$%^&*]/.test(pw)) s++
  return Math.max(1, s)
}

function strengthColor(s: number) {
  return ['', 'var(--red)', 'var(--amber)', '#84cc16', 'var(--green)'][s] ?? 'var(--green)'
}

function strengthLabel(s: number) {
  return ['', 'Weak', 'Fair', 'Good', 'Strong'][s] ?? 'Strong'
}
