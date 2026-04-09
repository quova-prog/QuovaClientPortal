import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'

export interface CapexEntry {
  id: string
  project_name: string
  currency: string
  budget_amount: number
  committed_amount: number
  payment_date: string
  category: 'equipment' | 'property' | 'technology' | 'infrastructure' | 'other'
  entity: string
  status: 'planned' | 'approved' | 'committed' | 'completed'
  description: string
  uploaded_at: string
}

export function useCapex() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const orgId = user?.profile?.org_id

  const [entries, setEntries] = useState<CapexEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await db
      .from('capex')
      .select('*')
      .eq('org_id', orgId as string)
      .order('payment_date', { ascending: true })
    if (err) setError(err.message)
    else setEntries((data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at })))
    setLoading(false)
  }, [orgId, db])

  useEffect(() => { load() }, [load])

  async function addEntry(e: Omit<CapexEntry, 'id' | 'uploaded_at'>): Promise<CapexEntry> {
    const { data, error: err } = await db
      .from('capex')
      .insert({ ...e, org_id: orgId, uploaded_by: user?.id })
      .select()
      .single()
    if (err) throw new Error(err.message)
    const row = { ...data, uploaded_at: data.created_at }
    setEntries(prev => [...prev, row])
    log({ action: 'create', resource: 'capex', resource_id: data.id, summary: `Created capex entry for ${data.project_name}` })
    return row
  }

  async function addEntries(rows: Omit<CapexEntry, 'id' | 'uploaded_at'>[]): Promise<void> {
    const { data, error: err } = await db
      .from('capex')
      .insert(rows.map(r => ({ ...r, org_id: orgId, uploaded_by: user?.id })))
      .select()
    if (err) throw new Error(err.message)
    const newRows = (data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at }))
    setEntries(prev => [...prev, ...newRows])
  }

  async function updateEntry(id: string, updates: Partial<CapexEntry>): Promise<void> {
    const { id: _id, uploaded_at: _ua, ...patch } = { ...updates, updated_at: new Date().toISOString() }
    const { error: err } = await db
      .from('capex')
      .update(patch)
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e))
    log({ action: 'update', resource: 'capex', resource_id: id, summary: `Updated capex entry ${id}` })
  }

  async function deleteEntry(id: string): Promise<void> {
    const { error: err } = await db
      .from('capex')
      .delete()
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setEntries(prev => prev.filter(e => e.id !== id))
    log({ action: 'delete', resource: 'capex', resource_id: id, summary: `Deleted capex entry ${id}` })
  }

  async function clearAll(): Promise<void> {
    const { error: err } = await db
      .from('capex')
      .delete()
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setEntries([])
  }

  return { entries, addEntry, addEntries, updateEntry, deleteEntry, clearAll, loading, error }
}
