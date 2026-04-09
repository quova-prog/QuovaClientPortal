import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { reportException, setMonitoringContext } from '@/lib/monitoring'

export function MonitoringBridge() {
  const { user } = useAuth()
  const location = useLocation()

  useEffect(() => {
    setMonitoringContext({
      userId: user?.id ?? null,
      orgId: user?.profile?.org_id ?? null,
      route: `${location.pathname}${location.search}`,
    })
  }, [user?.id, user?.profile?.org_id, location.pathname, location.search])

  useEffect(() => {
    function onError(event: ErrorEvent) {
      void reportException(event.error ?? event.message, {
        category: 'application',
        severity: 'critical',
        message: event.message || 'Unhandled window error',
        metadata: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      })
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      void reportException(event.reason, {
        category: 'application',
        severity: 'error',
        message: 'Unhandled promise rejection',
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  return null
}
