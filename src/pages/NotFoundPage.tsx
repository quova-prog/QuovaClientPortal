import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)', flexDirection: 'column', gap: '1rem', padding: '2rem', textAlign: 'center' }}>
      <div style={{ fontSize: '4rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--teal)', letterSpacing: '-0.04em', lineHeight: 1 }}>404</div>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Page not found</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', maxWidth: 320 }}>
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link to="/dashboard" className="btn btn-primary" style={{ marginTop: '0.5rem' }}>
        ← Back to Dashboard
      </Link>
    </div>
  )
}
