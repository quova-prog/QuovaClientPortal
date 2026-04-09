import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'

export interface BudgetRate {
  id: string
  currency_pair: string
  budget_rate: number
  fiscal_year: number
  period: string
  notional_budget: number
  description: string
  uploaded_at: string
}

export function useBudgetRates() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const orgId = user?.profile?.org_id

  const [rates, setRates] = useState<BudgetRate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await db
      .from('budget_rates')
      .select('*')
      .eq('org_id', orgId as string)
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setRates((data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at })))
    setLoading(false)
  }, [orgId, db])

  useEffect(() => { load() }, [load])

  async function addRate(r: Omit<BudgetRate, 'id' | 'uploaded_at'>): Promise<BudgetRate> {
    const { data, error: err } = await db
      .from('budget_rates')
      .insert({ ...r, org_id: orgId, uploaded_by: user?.id })
      .select()
      .single()
    if (err) throw new Error(err.message)
    const row = { ...data, uploaded_at: data.created_at }
    setRates(prev => [row, ...prev])
    log({ action: 'create', resource: 'budget_rate', resource_id: data.id, summary: `Created budget rate for ${data.currency_pair}` })
    return row
  }

  async function addRates(rows: Omit<BudgetRate, 'id' | 'uploaded_at'>[]): Promise<void> {
    const { data, error: err } = await db
      .from('budget_rates')
      .insert(rows.map(r => ({ ...r, org_id: orgId, uploaded_by: user?.id })))
      .select()
    if (err) throw new Error(err.message)
    const newRows = (data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at }))
    setRates(prev => [...newRows, ...prev])
  }

  async function updateRate(id: string, updates: Partial<BudgetRate>): Promise<void> {
    const { id: _id, uploaded_at: _ua, ...fields } = updates
    const patch = { ...fields, updated_at: new Date().toISOString() }
    const { error: err } = await db
      .from('budget_rates')
      .update(patch)
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setRates(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r))
    log({ action: 'update', resource: 'budget_rate', resource_id: id, summary: `Updated budget rate ${id}` })
  }

  async function deleteRate(id: string): Promise<void> {
    const { error: err } = await db
      .from('budget_rates')
      .delete()
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setRates(prev => prev.filter(r => r.id !== id))
    log({ action: 'delete', resource: 'budget_rate', resource_id: id, summary: `Deleted budget rate ${id}` })
  }

  async function clearAll(): Promise<void> {
    const { error: err } = await db
      .from('budget_rates')
      .delete()
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setRates([])
  }

  return { rates, addRate, addRates, updateRate, deleteRate, clearAll, loading, error }
}
