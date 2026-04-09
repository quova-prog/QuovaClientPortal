import { useCallback } from 'react'
import { useAuth } from './useAuth'
import { reportException } from '@/lib/monitoring'

export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'logout' | 'export' | 'upload'

export interface AuditEvent {
  action: AuditAction
  resource: string
  resource_id?: string
  summary: string
  metadata?: Record<string, unknown>
}

export function useAuditLog() {
  const { user, db } = useAuth()

  const log = useCallback(async (event: AuditEvent): Promise<void> => {
    const orgId = user?.profile?.org_id
    if (!orgId || !user?.id) return   // not logged in — skip silently

    try {
      await db.from('audit_logs').insert({
        org_id:      orgId,
        user_id:     user.id,
        user_email:  user.email ?? null,
        action:      event.action,
        resource:    event.resource,
        resource_id: event.resource_id ?? null,
        summary:     event.summary,
        metadata:    event.metadata ?? {},
      })
    } catch (err) {
      void reportException(err, {
        category: 'audit',
        severity: 'warning',
        message: 'Audit log write failed',
        metadata: {
          action: event.action,
          resource: event.resource,
          resource_id: event.resource_id ?? null,
        },
      })
      // Never let audit log failures crash the app
      if (import.meta.env.DEV) console.warn('[audit]', err)
    }
  }, [user, db])

  return { log }
}
