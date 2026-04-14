import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMfa } from '@/hooks/useMfa'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'

function parseTotpUri(uri: string) {
  try {
    const url = new URL(uri)
    return {
      secret: url.searchParams.get('secret') ?? '',
      issuer: url.searchParams.get('issuer') ?? '',
    }
  } catch {
    return { secret: '', issuer: '' }
  }
}

export function ForceMfaSetupPage() {
  const navigate = useNavigate()
  const { enroll, challenge, verify, listFactors, unenroll } = useMfa()
  
  const [mfaEnrolling, setMfaEnrolling] = useState(true)
  const [mfaFactorId, setMfaFactorId] = useState('')
  const [mfaTotpUri, setMfaTotpUri] = useState('')
  const parsedTotp = useMemo(() => parseTotpUri(mfaTotpUri), [mfaTotpUri])
  
  const [mfaCode, setMfaCode] = useState('')
  const [mfaVerifying, setMfaVerifying] = useState(false)
  const [mfaError, setMfaError] = useState<string | null>(null)

  const codeInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true

    async function initEnroll() {
      // First clean up dangling incomplete enrollments
      const { factors } = await listFactors()
      const pending = factors.filter(f => f.status !== 'verified')
      for (const f of pending) await unenroll(f.id)
      
      const { factorId, totpUri, error } = await enroll()
      if (!active) return

      if (error) {
        setMfaError(error)
        setMfaEnrolling(false)
        return
      }
      
      setMfaFactorId(factorId)
      setMfaTotpUri(totpUri)
      setMfaEnrolling(false)
      
      setTimeout(() => codeInputRef.current?.focus(), 100)
    }

    void initEnroll()
    
    return () => { active = false }
  }, [enroll, listFactors, unenroll])

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (mfaCode.length !== 6 || mfaVerifying) return

    setMfaError(null)
    setMfaVerifying(true)
    
    const { challengeId, error: cErr } = await challenge(mfaFactorId)
    if (cErr) {
      setMfaError(cErr)
      setMfaVerifying(false)
      return
    }

    const { error: vErr } = await verify(mfaFactorId, challengeId, mfaCode)
    if (vErr) {
      setMfaError(vErr)
      setMfaVerifying(false)
      return
    }

    // After success, we need to completely reload the session to bump the AAL level.
    // The safest way is to hit the DB one last time to force a sync hook.
    await supabase.auth.refreshSession()
    navigate('/')
  }

  async function handleSignOut() {
    await supabase.auth.signOut({ scope: 'global' })
    navigate('/login')
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg-app)', padding: '1rem',
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '2rem' }}>
          
          <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
            <div style={{ 
              width: 56, height: 56, borderRadius: '50%', background: 'rgba(239,68,68,0.1)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' 
            }}>
              <ShieldAlert size={26} color="var(--red, #ef4444)" />
            </div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Action Required</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              Your organization enforces Multi-Factor Authentication. You must configure an authenticator app to continue.
            </p>
          </div>

          {mfaEnrolling && (
             <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
               <span className="spinner" style={{ width: 24, height: 24 }} />
             </div>
          )}

          {!mfaEnrolling && mfaTotpUri && (
             <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
               <div style={{ background: 'var(--sidebar-hover)', padding: '1rem', borderRadius: 'var(--r-md)', textAlign: 'center' }}>
                 <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                   Setup Key
                 </div>
                 <div style={{ 
                   fontFamily: 'var(--font-mono)', fontSize: '1.125rem', letterSpacing: '0.1em', 
                   color: 'var(--teal)', padding: '0.75rem', background: 'var(--bg-app)', borderRadius: 'var(--r-sm)' 
                 }}>
                   {parsedTotp.secret}
                 </div>
                 <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                   Enter this code into your authenticator app (like Google Authenticator or Authy).
                 </p>
               </div>

               <div>
                 <label className="label">Verification Code</label>
                 <input
                   ref={codeInputRef}
                   className="input"
                   type="text"
                   inputMode="numeric"
                   pattern="[0-9]*"
                   maxLength={6}
                   value={mfaCode}
                   onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                   placeholder="000000"
                   disabled={mfaVerifying}
                   style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.4em', fontFamily: 'var(--font-mono)', paddingLeft: '1rem' }}
                   autoComplete="one-time-code"
                 />
               </div>

               {mfaError && (
                 <div className="error-banner">
                   {mfaError}
                 </div>
               )}

               <button type="submit" className="btn btn-primary" disabled={mfaVerifying || mfaCode.length !== 6} style={{ justifyContent: 'center' }}>
                 {mfaVerifying ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <><ShieldCheck size={16} /> Complete Setup</>}
               </button>
             </form>
          )}

          <div style={{ marginTop: '0.5rem', textAlign: 'center' }}>
            <button onClick={handleSignOut} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '0.8125rem', cursor: 'pointer' }}>
              Back to sign in
            </button>
          </div>
          
        </div>
      </div>
    </div>
  )
}
