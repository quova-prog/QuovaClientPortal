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
    if (!user?.profile?.org_id || !user?.id) return   // not logged in — skip silently

    try {
      // Use RPC instead of direct INSERT — server validates action enum,
      // resolves org_id from profile, and sanitises content fields.
      const { error } = await db.rpc('write_audit_log', {
        p_action:      event.action,
        p_resource:    event.resource,
        p_resource_id: event.resource_id ?? null,
        p_summary:     event.summary,
        p_metadata:    event.metadata ?? {},
      })
      if (error) throw error
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
