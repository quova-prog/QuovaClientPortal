import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'

export interface CustomerContract {
  id: string
  customer_name: string
  currency: string
  contract_value: number
  start_date: string
  end_date: string
  payment_frequency: 'monthly' | 'quarterly' | 'annual' | 'one-time'
  next_payment_date: string
  payment_amount: number
  segment: string
  region: string
  status: 'active' | 'expired' | 'pending'
  description: string
  uploaded_at: string
}

export function useCustomerContracts() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const orgId = user?.profile?.org_id

  const [contracts, setContracts] = useState<CustomerContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await db
      .from('customer_contracts')
      .select('*')
      .eq('org_id', orgId as string)
      .order('end_date', { ascending: true })
    if (err) setError(err.message)
    else setContracts((data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at })))
    setLoading(false)
  }, [orgId, db])

  useEffect(() => { load() }, [load])

  async function addContract(c: Omit<CustomerContract, 'id' | 'uploaded_at'>): Promise<CustomerContract> {
    const { data, error: err } = await db
      .from('customer_contracts')
      .insert({ ...c, org_id: orgId, uploaded_by: user?.id })
      .select()
      .single()
    if (err) throw new Error(err.message)
    const row = { ...data, uploaded_at: data.created_at }
    setContracts(prev => [...prev, row])
    log({ action: 'create', resource: 'customer_contract', resource_id: data.id, summary: `Created customer contract for ${data.customer_name}` })
    return row
  }

  async function addContracts(rows: Omit<CustomerContract, 'id' | 'uploaded_at'>[]): Promise<void> {
    const { data, error: err } = await db
      .from('customer_contracts')
      .insert(rows.map(r => ({ ...r, org_id: orgId, uploaded_by: user?.id })))
      .select()
    if (err) throw new Error(err.message)
    const newRows = (data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at }))
    setContracts(prev => [...prev, ...newRows])
  }

  async function updateContract(id: string, updates: Partial<CustomerContract>): Promise<void> {
    const { id: _id, uploaded_at: _ua, ...patch } = { ...updates, updated_at: new Date().toISOString() }
    const { error: err } = await db
      .from('customer_contracts')
      .update(patch)
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setContracts(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
    log({ action: 'update', resource: 'customer_contract', resource_id: id, summary: `Updated customer contract ${id}` })
  }

  async function deleteContract(id: string): Promise<void> {
    const { error: err } = await db
      .from('customer_contracts')
      .delete()
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setContracts(prev => prev.filter(c => c.id !== id))
    log({ action: 'delete', resource: 'customer_contract', resource_id: id, summary: `Deleted customer contract ${id}` })
  }

  async function clearAll(): Promise<void> {
    const { error: err } = await db
      .from('customer_contracts')
      .delete()
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setContracts([])
  }

  return { contracts, addContract, addContracts, updateContract, deleteContract, clearAll, loading, error }
}
