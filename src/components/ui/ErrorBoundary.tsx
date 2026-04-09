import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { reportException } from '@/lib/monitoring'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo })
    void reportException(error, {
      category: 'application',
      severity: 'critical',
      message: 'React error boundary caught an exception',
      metadata: {
        componentStack: errorInfo.componentStack,
      },
    })
    if (import.meta.env.DEV) console.error('Quova error boundary caught:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ error: null, errorInfo: null })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: '60vh', padding: '2rem',
        }}>
          <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: '#ef444415', border: '1px solid #ef444430',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.25rem',
            }}>
              <AlertTriangle size={22} color="var(--red)" />
            </div>
            <h2 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Something went wrong</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              An unexpected error occurred. Your data is safe — this is a display issue only.
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={this.handleReset}>
                <RefreshCw size={14} /> Try again
              </button>
              <button className="btn btn-ghost" onClick={() => window.location.href = '/dashboard'}>
                Go to Dashboard
              </button>
            </div>

            {/* Error details — collapsed, for developers */}
            {this.state.error && (
              <details style={{ marginTop: '1.5rem', textAlign: 'left' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.8125rem', color: 'var(--text-muted)', userSelect: 'none' }}>
                  Error details
                </summary>
                <pre style={{
                  marginTop: '0.75rem', padding: '0.875rem',
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)', fontSize: '0.75rem', color: 'var(--red)',
                  overflow: 'auto', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                }}>
                  {this.state.error.message}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

// Inline error for smaller failures (e.g. a single card failing to load)
export function InlineError({
  message = 'Failed to load this section.',
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.625rem',
      padding: '0.875rem 1rem',
      background: '#ef444410', border: '1px solid #ef444425',
      borderRadius: 'var(--r-md)', fontSize: '0.875rem', color: 'var(--red)',
    }}>
      <AlertTriangle size={14} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="btn btn-ghost btn-sm" style={{ color: 'var(--red)', borderColor: '#ef444430' }}>
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  )
}
