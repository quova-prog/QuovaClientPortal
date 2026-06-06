import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { loadRuntimeWorkosAuthConfig } from '@/lib/workosConfig'
import { clearRememberedWorkosInviteToken, readInviteParams, rememberWorkosInviteToken } from '@/lib/workosInvite'
import { beginWorkosAuthRedirect, continueWorkosRedirect } from '@/lib/workosRedirectGuard'
import { OrbitMark } from '@/components/ui/OrbitMark'

export function SignupPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const config = loadRuntimeWorkosAuthConfig()
  const inviteParams = readInviteParams(window.location.search)
  const inviteId = inviteParams.legacyInviteId
  const inviteToken = inviteParams.workosInviteToken
  const [form, setForm] = useState({ email: '', password: '', orgName: '', fullName: '' })
  const [error, setError] = useState('')
  const [workosRedirectPaused, setWorkosRedirectPaused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)
  const [attempts, setAttempts] = useState<number[]>([])
  const [cooldownEnd, setCooldownEnd] = useState(0)
  const [cooldownLeft, setCooldownLeft] = useState(0)

  function startWorkosAuthRedirect() {
    void signUp('', '', '', '', inviteToken ?? null)
  }

  useEffect(() => {
    if (config.provider !== 'workos') return
    if (inviteToken) rememberWorkosInviteToken(inviteToken)
    else clearRememberedWorkosInviteToken()
    const key = `signup:${inviteToken ?? 'default'}`
    if (!beginWorkosAuthRedirect(key)) {
      setWorkosRedirectPaused(true)
      return
    }
    startWorkosAuthRedirect()
  }, [config.provider, inviteToken, signUp])

  function handleContinueWorkosRedirect() {
    const key = `signup:${inviteToken ?? 'default'}`
    continueWorkosRedirect(key)
    setWorkosRedirectPaused(false)
    startWorkosAuthRedirect()
  }

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
      const { error, confirmationRequired } = await signUp(form.email, form.password, form.orgName, form.fullName, inviteId)
      if (error) {
        if (inviteId && error.toLowerCase().includes('user already')) {
          setError('That email already has an Orbit account. Sign in to accept this invite.')
        } else {
          setError(error)
        }
      }
      else if (confirmationRequired) setConfirmationSent(true)
      else {
        // Signup succeeded with an active session; user is at AAL1 and must
        // enrol MFA before any AAL2-gated data is reachable. buildAuthUser
        // returns null at AAL1, so the AuthContext stays empty and the
        // PublicRoute would just keep rendering this form. Mirror the
        // LoginPage mfaEnforcedSetupRequired path explicitly.
        navigate(inviteId ? `/mfa-setup?invite=${encodeURIComponent(inviteId)}` : '/mfa-setup')
      }
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
            Click it to activate your account — {inviteId ? 'your team access' : 'your organization'} will be set up automatically.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '1.5rem' }}>
            Already confirmed? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    )
  }

  if (config.provider === 'workos') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--bg-app)', padding: '1rem',
      }}>
        <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
          <OrbitMark />
          <div className="spinner" style={{ width: 28, height: 28, margin: '1.5rem auto' }} />
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600 }}>
            {workosRedirectPaused ? 'Continue sign up' : 'Redirecting to sign up'}
          </h1>
          {workosRedirectPaused && (
            <button
              type="button"
              className="btn-primary"
              onClick={handleContinueWorkosRedirect}
              style={{ marginTop: '1rem' }}
            >
              Continue
            </button>
          )}
          {error && <div className="error-banner" style={{ marginTop: '1rem' }}>{error}</div>}
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
          <OrbitMark />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginTop: '0.75rem', letterSpacing: '-0.02em' }}>
            {inviteId ? 'Join your team' : 'Create your account'}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            {inviteId ? 'Create your Orbit account to accept the invite' : 'Set up Orbit for your organization'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: inviteId ? '1fr' : '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">Your name</label>
              <input className="input" type="text" value={form.fullName} onChange={set('fullName')} required />
            </div>
            {!inviteId && (
              <div>
                <label className="label">Organization</label>
                <input className="input" type="text" value={form.orgName} onChange={set('orgName')} required />
              </div>
            )}
          </div>
          <div>
            <label className="label">Work email</label>
            <input className="input" type="email" value={form.email} onChange={set('email')} required />
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
              {inviteId && error.includes('Sign in to accept') && (
                <div style={{ marginTop: '0.75rem' }}>
                  <Link to={`/login?invite=${encodeURIComponent(inviteId)}`}>Sign in to accept invite</Link>
                </div>
              )}
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
