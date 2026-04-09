import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'

export interface ErpConnection {
  id: string
  org_id: string
  connector_type: string
  display_name: string
  status: 'connected' | 'disconnected' | 'error'
  config: Record<string, unknown>
  credentials_set: boolean
  sync_modules: string[]
  sync_frequency: string
  last_synced_at: string | null
  last_sync_status: string | null
  last_sync_count: number | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type ErpConnectionUpsert = Omit<ErpConnection, 'id' | 'org_id' | 'created_at' | 'updated_at'> & { id?: string }

export function useErpConnections() {
  const { user, db } = useAuth()
  const orgId = user?.profile?.org_id

  const [connections, setConnections] = useState<ErpConnection[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    const { data } = await db
      .from('erp_connections')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
    setConnections(data ?? [])
    setLoading(false)
  }, [orgId, db])

  useEffect(() => { load() }, [load])

  async function upsertConnection(payload: ErpConnectionUpsert): Promise<void> {
    if (!orgId) return

    if (payload.id) {
      const { id, ...rest } = payload
      await db
        .from('erp_connections')
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('org_id', orgId)
    } else {
      await db
        .from('erp_connections')
        .insert({ ...payload, org_id: orgId })
    }

    await load()
  }

  async function deleteConnection(id: string): Promise<void> {
    if (!orgId) return
    await db
      .from('erp_connections')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)
    await load()
  }

  return { connections, loading, upsertConnection, deleteConnection, reload: load }
}
