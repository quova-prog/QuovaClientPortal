import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { reportMonitoringEvent, reportException } from '@/lib/monitoring'
import { ShieldCheck } from 'lucide-react'
import { QuovaMark } from '@/components/ui/QuovaMark'

// ── Rate limiting constants ────────────────────────────────────────────────────
const LOGIN_MAX_ATTEMPTS  = 3
const LOGIN_LOCKOUT_MS    = 30_000   // 30 s
const MFA_MAX_ATTEMPTS    = 3
const MFA_LOCKOUT_MS      = 60_000   // 60 s

interface MfaPending {
  factorId: string
  pendingToken: string
  pendingRefreshToken: string
  pendingExpiresIn: number
  pendingUserId: string
  pendingEmail: string
}

export function LoginPage() {
  const navigate = useNavigate()
  const { signIn, completeMfaSignIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Login rate limiting
  const [loginFailures, setLoginFailures] = useState(0)
  const [loginLockedUntil, setLoginLockedUntil] = useState<number | null>(null)
  const [loginCountdown, setLoginCountdown] = useState(0)

  // MFA step
  const [mfaPending, setMfaPending] = useState<MfaPending | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const mfaInputRef = useRef<HTMLInputElement>(null)

  // MFA rate limiting
  const [mfaFailures, setMfaFailures] = useState(0)
  const [mfaLockedUntil, setMfaLockedUntil] = useState<number | null>(null)
  const [mfaCountdown, setMfaCountdown] = useState(0)

  // Countdown tickers
  useEffect(() => {
    if (!loginLockedUntil) return
    const id = setInterval(() => {
      const remaining = Math.ceil((loginLockedUntil - Date.now()) / 1000)
      if (remaining <= 0) { setLoginLockedUntil(null); setLoginCountdown(0); clearInterval(id) }
      else setLoginCountdown(remaining)
    }, 500)
    return () => clearInterval(id)
  }, [loginLockedUntil])

  useEffect(() => {
    if (!mfaLockedUntil) return
    const id = setInterval(() => {
      const remaining = Math.ceil((mfaLockedUntil - Date.now()) / 1000)
      if (remaining <= 0) { setMfaLockedUntil(null); setMfaCountdown(0); clearInterval(id) }
      else setMfaCountdown(remaining)
    }, 500)
    return () => clearInterval(id)
  }, [mfaLockedUntil])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loginLockedUntil && Date.now() < loginLockedUntil) return
    setError('')
    setLoading(true)
    try {
      const result = await signIn(email, password)
      if (result.error) {
        const failures = loginFailures + 1
        setLoginFailures(failures)
        if (failures >= LOGIN_MAX_ATTEMPTS) {
          const until = Date.now() + LOGIN_LOCKOUT_MS
          setLoginLockedUntil(until)
          setLoginFailures(0)
          void reportMonitoringEvent({
            category: 'security',
            severity: 'warning',
            message: 'Login lockout threshold reached',
            metadata: {
              email,
              failure_count: failures,
              lockout_ms: LOGIN_LOCKOUT_MS,
            },
          })
          setError(`Too many failed attempts. Try again in ${LOGIN_LOCKOUT_MS / 1000} seconds.`)
        } else {
          setError(result.error)
        }
      } else if (result.mfaEnforcedSetupRequired) {
        setLoginFailures(0)
        navigate('/mfa-setup')
      } else if (result.mfaRequired) {
        setLoginFailures(0)
        setMfaPending({
          factorId: result.mfaFactorId!,
          pendingToken: result.pendingToken!,
          pendingRefreshToken: result.pendingRefreshToken!,
          pendingExpiresIn: result.pendingExpiresIn!,
          pendingUserId: result.pendingUserId!,
          pendingEmail: result.pendingEmail!,
        })
        setTimeout(() => mfaInputRef.current?.focus(), 100)
      } else {
        setLoginFailures(0)
      }
    } catch (err: unknown) {
      void reportException(err, {
        category: 'auth',
        severity: 'error',
        message: 'Login form submission failed unexpectedly',
      })
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!mfaPending || mfaCode.length !== 6) return
    if (mfaLockedUntil && Date.now() < mfaLockedUntil) return
    setError('')
    setLoading(true)
    try {
      const { error } = await completeMfaSignIn(
        mfaPending.factorId,
        mfaCode,
        mfaPending.pendingToken,
        mfaPending.pendingRefreshToken,
        mfaPending.pendingExpiresIn,
        mfaPending.pendingUserId,
        mfaPending.pendingEmail,
      )
      if (error) {
        const failures = mfaFailures + 1
        setMfaFailures(failures)
        setMfaCode('')
        if (failures >= MFA_MAX_ATTEMPTS) {
          const until = Date.now() + MFA_LOCKOUT_MS
          setMfaLockedUntil(until)
          setMfaFailures(0)
          void reportMonitoringEvent({
            category: 'security',
            severity: 'warning',
            message: 'MFA lockout threshold reached',
            metadata: {
              email: mfaPending.pendingEmail,
              failure_count: failures,
              lockout_ms: MFA_LOCKOUT_MS,
            },
          })
          setError(`Too many incorrect codes. Try again in ${MFA_LOCKOUT_MS / 1000} seconds.`)
        } else {
          setError(error)
        }
      } else {
        setMfaFailures(0)
      }
    } catch (err: unknown) {
      void reportException(err, {
        category: 'auth',
        severity: 'warning',
        message: 'MFA form submission failed unexpectedly',
      })
      setError(err instanceof Error ? err.message : 'MFA verification failed')
    } finally {
      setLoading(false)
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
          <QuovaMark />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginTop: '0.75rem', letterSpacing: '-0.02em' }}>
            {mfaPending ? 'Two-Factor Verification' : 'Sign in to Quova'}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            {mfaPending ? 'Enter the 6-digit code from your authenticator app' : 'The Financial Risk OS'}
          </p>
        </div>

        {mfaPending ? (
          /* ── MFA step ── */
          <form onSubmit={handleMfaSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', alignItems: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'rgba(0,200,160,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ShieldCheck size={26} color="var(--teal)" />
            </div>
            <div style={{ width: '100%' }}>
              <label className="label" style={{ textAlign: 'center', display: 'block' }}>Authenticator Code</label>
              <input
                ref={mfaInputRef}
                className="input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.4em', fontFamily: 'var(--font-mono)', paddingLeft: '1rem' }}
                autoComplete="one-time-code"
              />
            </div>
            {error && (
              <div className="error-banner" style={{ width: '100%' }}>
                {error}
              </div>
            )}
            {mfaLockedUntil && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Locked — try again in {mfaCountdown}s
              </p>
            )}
            <button className="btn btn-primary" type="submit"
              disabled={loading || mfaCode.length !== 6 || !!(mfaLockedUntil && Date.now() < mfaLockedUntil)}
              style={{ width: '100%', justifyContent: 'center' }}>
              {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Verify'}
            </button>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8125rem', cursor: 'pointer' }}
              onClick={() => { setMfaPending(null); setMfaCode(''); setError('') }}>
              ← Back to sign in
            </button>
          </form>
        ) : (
          /* ── Password step ── */
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
              <div className="error-banner">
                {error}
              </div>
            )}
            {loginLockedUntil && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
                Too many attempts — try again in {loginCountdown}s
              </p>
            )}
            <button className="btn btn-primary" type="submit"
              disabled={loading || !!(loginLockedUntil && Date.now() < loginLockedUntil)}
              style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}>
              {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Sign in'}
            </button>
          </form>
        )}

        {!mfaPending && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '1.25rem' }}>
            Don't have an account?{' '}
            <Link to="/signup">Create one</Link>
          </p>
        )}
      </div>
    </div>
  )
}

