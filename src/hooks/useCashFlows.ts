import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'

export interface CashFlowEntry {
  id: string
  flow_date: string
  currency: string
  amount: number         // positive = inflow, negative = outflow
  flow_type: 'inflow' | 'outflow' | 'net'
  category: string
  entity: string
  account: string
  counterparty: string
  description: string
  confidence: 'confirmed' | 'forecast' | 'indicative'
  entity_id?: string | null
  uploaded_at: string
}

export function useCashFlows() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const orgId = user?.profile?.org_id

  const [flows, setFlows] = useState<CashFlowEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await db
      .from('cash_flows')
      .select('*')
      .eq('org_id', orgId as string)
      .order('flow_date', { ascending: true })
    if (err) setError(err.message)
    else setFlows((data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at })))
    setLoading(false)
  }, [orgId, db])

  useEffect(() => { load() }, [load])

  async function addFlow(f: Omit<CashFlowEntry, 'id' | 'uploaded_at'>): Promise<CashFlowEntry> {
    const { data, error: err } = await db
      .from('cash_flows')
      .insert({ ...f, org_id: orgId, uploaded_by: user?.id })
      .select()
      .single()
    if (err) throw new Error(err.message)
    const row = { ...data, uploaded_at: data.created_at }
    setFlows(prev => [...prev, row])
    log({ action: 'create', resource: 'cash_flow', resource_id: data.id, summary: `Created ${data.flow_type} cash flow for ${data.currency}` })
    return row
  }

  async function addFlows(rows: Omit<CashFlowEntry, 'id' | 'uploaded_at'>[]): Promise<void> {
    const { data, error: err } = await db
      .from('cash_flows')
      .insert(rows.map(r => ({ ...r, org_id: orgId, uploaded_by: user?.id })))
      .select()
    if (err) throw new Error(err.message)
    const newRows = (data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at }))
    setFlows(prev => [...prev, ...newRows])
  }

  async function updateFlow(id: string, updates: Partial<CashFlowEntry>): Promise<void> {
    const { id: _id, uploaded_at: _ua, ...patch } = { ...updates, updated_at: new Date().toISOString() }
    const { error: err } = await db
      .from('cash_flows')
      .update(patch)
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setFlows(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))
    log({ action: 'update', resource: 'cash_flow', resource_id: id, summary: `Updated cash flow ${id}` })
  }

  async function deleteFlow(id: string): Promise<void> {
    const { error: err } = await db
      .from('cash_flows')
      .delete()
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setFlows(prev => prev.filter(f => f.id !== id))
    log({ action: 'delete', resource: 'cash_flow', resource_id: id, summary: `Deleted cash flow ${id}` })
  }

  async function clearAll(): Promise<void> {
    const { error: err } = await db
      .from('cash_flows')
      .delete()
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setFlows([])
  }

  return { flows, addFlow, addFlows, updateFlow, deleteFlow, clearAll, loading, error }
}
