import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'

export interface SupplierContract {
  id: string
  supplier_name: string
  currency: string
  contract_value: number
  start_date: string
  end_date: string
  payment_frequency: 'monthly' | 'quarterly' | 'annual' | 'one-time'
  next_payment_date: string
  payment_amount: number
  category: string
  status: 'active' | 'expired' | 'pending'
  description: string
  uploaded_at: string
}

export function useSupplierContracts() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const orgId = user?.profile?.org_id

  const [contracts, setContracts] = useState<SupplierContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await db
      .from('supplier_contracts')
      .select('*')
      .eq('org_id', orgId as string)
      .order('end_date', { ascending: true })
    if (err) setError(err.message)
    else setContracts((data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at })))
    setLoading(false)
  }, [orgId, db])

  useEffect(() => { load() }, [load])

  async function addContract(c: Omit<SupplierContract, 'id' | 'uploaded_at'>): Promise<SupplierContract> {
    const { data, error: err } = await db
      .from('supplier_contracts')
      .insert({ ...c, org_id: orgId, uploaded_by: user?.id })
      .select()
      .single()
    if (err) throw new Error(err.message)
    const row = { ...data, uploaded_at: data.created_at }
    setContracts(prev => [...prev, row])
    log({ action: 'create', resource: 'supplier_contract', resource_id: data.id, summary: `Created supplier contract for ${data.supplier_name}` })
    return row
  }

  async function addContracts(rows: Omit<SupplierContract, 'id' | 'uploaded_at'>[]): Promise<void> {
    const { data, error: err } = await db
      .from('supplier_contracts')
      .insert(rows.map(r => ({ ...r, org_id: orgId, uploaded_by: user?.id })))
      .select()
    if (err) throw new Error(err.message)
    const newRows = (data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at }))
    setContracts(prev => [...prev, ...newRows])
  }

  async function updateContract(id: string, updates: Partial<SupplierContract>): Promise<void> {
    const { id: _id, uploaded_at: _ua, ...patch } = { ...updates, updated_at: new Date().toISOString() }
    const { error: err } = await db
      .from('supplier_contracts')
      .update(patch)
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setContracts(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
    log({ action: 'update', resource: 'supplier_contract', resource_id: id, summary: `Updated supplier contract ${id}` })
  }

  async function deleteContract(id: string): Promise<void> {
    const { error: err } = await db
      .from('supplier_contracts')
      .delete()
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setContracts(prev => prev.filter(c => c.id !== id))
    log({ action: 'delete', resource: 'supplier_contract', resource_id: id, summary: `Deleted supplier contract ${id}` })
  }

  async function clearAll(): Promise<void> {
    const { error: err } = await db
      .from('supplier_contracts')
      .delete()
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setContracts([])
  }

  return { contracts, addContract, addContracts, updateContract, deleteContract, clearAll, loading, error }
}
