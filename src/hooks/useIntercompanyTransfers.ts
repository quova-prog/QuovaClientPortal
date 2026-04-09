import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'

export interface IntercompanyTransfer {
  id: string
  transfer_date: string
  from_entity: string
  to_entity: string
  currency: string
  amount: number
  transfer_type: 'dividend' | 'loan' | 'service' | 'goods' | 'other'
  status: 'scheduled' | 'completed' | 'pending' | 'cancelled'
  reference: string
  description: string
  uploaded_at: string
}

export function useIntercompanyTransfers() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const orgId = user?.profile?.org_id

  const [transfers, setTransfers] = useState<IntercompanyTransfer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await db
      .from('intercompany_transfers')
      .select('*')
      .eq('org_id', orgId as string)
      .order('transfer_date', { ascending: true })
    if (err) setError(err.message)
    else setTransfers((data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at })))
    setLoading(false)
  }, [orgId, db])

  useEffect(() => { load() }, [load])

  async function addTransfer(t: Omit<IntercompanyTransfer, 'id' | 'uploaded_at'>): Promise<IntercompanyTransfer> {
    const { data, error: err } = await db
      .from('intercompany_transfers')
      .insert({ ...t, org_id: orgId, uploaded_by: user?.id })
      .select()
      .single()
    if (err) throw new Error(err.message)
    const row = { ...data, uploaded_at: data.created_at }
    setTransfers(prev => [...prev, row])
    log({ action: 'create', resource: 'intercompany_transfer', resource_id: data.id, summary: `Created intercompany transfer from ${data.from_entity} to ${data.to_entity}` })
    return row
  }

  async function addTransfers(rows: Omit<IntercompanyTransfer, 'id' | 'uploaded_at'>[]): Promise<void> {
    const { data, error: err } = await db
      .from('intercompany_transfers')
      .insert(rows.map(r => ({ ...r, org_id: orgId, uploaded_by: user?.id })))
      .select()
    if (err) throw new Error(err.message)
    const newRows = (data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at }))
    setTransfers(prev => [...prev, ...newRows])
  }

  async function updateTransfer(id: string, updates: Partial<IntercompanyTransfer>): Promise<void> {
    const { id: _id, uploaded_at: _ua, ...patch } = { ...updates, updated_at: new Date().toISOString() }
    const { error: err } = await db
      .from('intercompany_transfers')
      .update(patch)
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
    log({ action: 'update', resource: 'intercompany_transfer', resource_id: id, summary: `Updated intercompany transfer ${id}` })
  }

  async function deleteTransfer(id: string): Promise<void> {
    const { error: err } = await db
      .from('intercompany_transfers')
      .delete()
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setTransfers(prev => prev.filter(t => t.id !== id))
    log({ action: 'delete', resource: 'intercompany_transfer', resource_id: id, summary: `Deleted intercompany transfer ${id}` })
  }

  async function clearAll(): Promise<void> {
    const { error: err } = await db
      .from('intercompany_transfers')
      .delete()
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setTransfers([])
  }

  return { transfers, addTransfer, addTransfers, updateTransfer, deleteTransfer, clearAll, loading, error }
}
