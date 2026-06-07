import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { loadRuntimeWorkosAuthConfig } from '@/lib/workosConfig'
import { readInviteParams } from '@/lib/workosInvite'
import { QuovaMark } from '@/components/ui/QuovaMark'

// Public landing page for /accept-invite?invite=<uuid>. The send-team-invite
// Edge Function emits links of this shape. The page is the bridge between
// the invite email and the existing signup + accept_invite() RPC plumbing.
//
// State machine:
//   1. Auth still loading                    → spinner
//   2. Missing or malformed invite param     → "Invalid invite link"
//   3. User NOT logged in                    → redirect to /signup?invite=<id>
//      (SignupPage already reads ?invite and chains accept_invite after
//      email confirmation, so we don't need to do it here.)
//   4. User logged in, accept_invite RPC OK  → navigate to /dashboard
//   5. RPC error (wrong email, expired,
//      already accepted, etc.)               → show the RPC's error string

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ViewState =
  | { kind: 'loading' }
  | { kind: 'invalid_link' }
  | { kind: 'redirecting_to_signup' }
  | { kind: 'accepting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }

export function AcceptInvitePage() {
  const { user, loading, db } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const config = loadRuntimeWorkosAuthConfig()
  const inviteParams = readInviteParams(searchParams)
  const inviteId = inviteParams.legacyInviteId ?? ''
  const [state, setState] = useState<ViewState>({ kind: 'loading' })

  useEffect(() => {
    if (config.provider === 'workos') {
      setState({
        kind: 'error',
        message: 'WorkOS invitations must be accepted from the AuthKit invitation email. Ask your administrator to send a new invitation.',
      })
      return
    }

    if (loading) {
      setState({ kind: 'loading' })
      return
    }

    if (!inviteId || !UUID_RE.test(inviteId)) {
      setState({ kind: 'invalid_link' })
      return
    }

    // Not logged in — hand off to signup with the invite ID preserved.
    // SignupPage already wires the invite into the signUp() call and
    // chains accept_invite() server-side after email confirmation.
    if (!user) {
      setState({ kind: 'redirecting_to_signup' })
      navigate(`/signup?invite=${encodeURIComponent(inviteId)}`, { replace: true })
      return
    }

    // Logged in — try to redeem immediately.
    let cancelled = false
    setState({ kind: 'accepting' })
    ;(async () => {
      const { error } = await db.rpc('accept_invite', { p_invite_id: inviteId })
      if (cancelled) return
      if (error) {
        setState({ kind: 'error', message: error.message || 'Could not accept invite' })
        return
      }
      setState({ kind: 'success' })
      // Brief pause so the user sees the success state, then on to the app.
      setTimeout(() => { if (!cancelled) navigate('/dashboard', { replace: true }) }, 1200)
    })()

    return () => { cancelled = true }
  }, [config.provider, loading, user, inviteId, navigate, db])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-app)',
      padding: '2rem',
    }}>
      <div className="card" style={{
        maxWidth: 420,
        width: '100%',
        padding: '2rem',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1rem',
      }}>
        <QuovaMark size={44} />

        {state.kind === 'loading' && (
          <>
            <Loader2 size={28} className="animate-spin" color="var(--teal)" />
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700 }}>Checking your invite…</h1>
          </>
        )}

        {state.kind === 'redirecting_to_signup' && (
          <>
            <Loader2 size={28} className="animate-spin" color="var(--teal)" />
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700 }}>Redirecting to sign up…</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Create your account to accept this invite.
            </p>
          </>
        )}

        {state.kind === 'accepting' && (
          <>
            <Loader2 size={28} className="animate-spin" color="var(--teal)" />
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700 }}>Joining the team…</h1>
          </>
        )}

        {state.kind === 'success' && (
          <>
            <CheckCircle2 size={32} color="var(--green)" />
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700 }}>You're in.</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Taking you to the dashboard…
            </p>
          </>
        )}

        {state.kind === 'invalid_link' && (
          <>
            <AlertCircle size={32} color="var(--amber)" />
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700 }}>Invalid invite link</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              This invite link is missing or malformed. Ask your administrator
              to send a new invite.
            </p>
            <Link to="/login" className="btn btn-ghost btn-sm">Go to sign in</Link>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <AlertCircle size={32} color="var(--red)" />
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700 }}>We couldn't accept this invite</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              {state.message}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Link to="/dashboard" className="btn btn-ghost btn-sm">Go to dashboard</Link>
              <Link to="/login" className="btn btn-primary btn-sm">Sign in as another user</Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
