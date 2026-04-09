import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

const IDLE_LIMIT_MS  = 30 * 60 * 1000  // 30 minutes
const WARNING_MS     = 5  * 60 * 1000  // warn when 5 minutes remain
const TICK_MS        = 1_000           // check every second

// Using Date.now() comparisons instead of setTimeout so the timer
// correctly accounts for time that passed while the machine was asleep.

export function IdleTimeout() {
  const { signOut } = useAuth()
  const navigate    = useNavigate()

  const [showWarning, setShowWarning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(WARNING_MS / 1000)

  // Refs survive re-renders without causing them
  const lastActivityRef = useRef(Date.now())
  const showWarningRef  = useRef(false)
  const didLogoutRef    = useRef(false)

  // Record activity; ignore if the warning modal is already open
  const handleActivity = useCallback(() => {
    const now = Date.now()
    const elapsed = now - lastActivityRef.current

    // If the session already expired while the machine was asleep,
    // ignore wake/unlock activity so it cannot silently revive itself.
    if (elapsed >= IDLE_LIMIT_MS) return

    if (!showWarningRef.current) {
      lastActivityRef.current = now
    }
  }, [])

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'] as const
    events.forEach(e => window.addEventListener(e, handleActivity, { passive: true }))

    const ticker = setInterval(() => {
      if (didLogoutRef.current) return

      const elapsed   = Date.now() - lastActivityRef.current
      const remaining = IDLE_LIMIT_MS - elapsed

      if (remaining <= 0) {
        // Time's up — log out
        didLogoutRef.current   = true
        showWarningRef.current = false
        setShowWarning(false)
        signOut().then(() => navigate('/login'))
      } else if (remaining <= WARNING_MS) {
        // Show / keep the warning modal and update the countdown
        if (!showWarningRef.current) {
          showWarningRef.current = true
          setShowWarning(true)
        }
        setSecondsLeft(Math.ceil(remaining / 1000))
      } else {
        // Still well within the limit; dismiss warning if it was showing
        if (showWarningRef.current) {
          showWarningRef.current = false
          setShowWarning(false)
        }
      }
    }, TICK_MS)

    return () => {
      events.forEach(e => window.removeEventListener(e, handleActivity))
      clearInterval(ticker)
    }
  }, [handleActivity, signOut, navigate])

  function handleStaySignedIn() {
    // Reset the activity clock — ticker will hide the warning on next tick
    lastActivityRef.current = Date.now()
    showWarningRef.current  = false
    setShowWarning(false)
  }

  async function handleSignOut() {
    didLogoutRef.current   = true
    showWarningRef.current = false
    setShowWarning(false)
    await signOut()
    navigate('/login')
  }

  if (!showWarning) return null

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const countdownLabel = `${mins}:${String(secs).padStart(2, '0')}`

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-xl)',
        padding: '2rem',
        maxWidth: 400,
        width: '90%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1rem',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <ShieldAlert size={40} color="var(--teal)" />

        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Session Expiring Soon
          </h2>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: 'var(--text-secondary, #94a3b8)' }}>
            You&apos;ve been inactive. Your session will end automatically.
          </p>
        </div>

        <div style={{
          fontSize: '3rem',
          fontWeight: 700,
          color: 'var(--teal)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
        }}>
          {countdownLabel}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
          <button
            onClick={handleSignOut}
            style={{
              flex: 1,
              padding: '0.625rem 1rem',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md, 8px)',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Sign Out Now
          </button>
          <button
            onClick={handleStaySignedIn}
            style={{
              flex: 1,
              padding: '0.625rem 1rem',
              background: 'var(--teal)',
              border: '1px solid var(--teal)',
              borderRadius: 'var(--r-md, 8px)',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Stay Signed In
          </button>
        </div>
      </div>
    </div>
  )
}
