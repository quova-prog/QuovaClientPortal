import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'

export interface PayrollEntry {
  id: string
  pay_date: string
  currency: string
  gross_amount: number
  net_amount: number
  employee_count: number
  entity: string
  department: string
  pay_period: string          // e.g. "2025-Q1", "2025-03", "Jan 2025"
  description: string
  uploaded_at: string
}

export function usePayroll() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const orgId = user?.profile?.org_id

  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await db
      .from('payroll')
      .select('*')
      .eq('org_id', orgId as string)
      .order('pay_date', { ascending: true })
    if (err) setError(err.message)
    else setEntries((data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at })))
    setLoading(false)
  }, [orgId, db])

  useEffect(() => { load() }, [load])

  async function addEntry(e: Omit<PayrollEntry, 'id' | 'uploaded_at'>): Promise<PayrollEntry> {
    const { data, error: err } = await db
      .from('payroll')
      .insert({ ...e, org_id: orgId, uploaded_by: user?.id })
      .select()
      .single()
    if (err) throw new Error(err.message)
    const row = { ...data, uploaded_at: data.created_at }
    setEntries(prev => [...prev, row])
    log({ action: 'create', resource: 'payroll', resource_id: data.id, summary: `Created payroll entry for ${data.currency} on ${data.pay_date}` })
    return row
  }

  async function addEntries(rows: Omit<PayrollEntry, 'id' | 'uploaded_at'>[]): Promise<void> {
    const { data, error: err } = await db
      .from('payroll')
      .insert(rows.map(r => ({ ...r, org_id: orgId, uploaded_by: user?.id })))
      .select()
    if (err) throw new Error(err.message)
    const newRows = (data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at }))
    setEntries(prev => [...prev, ...newRows])
  }

  async function updateEntry(id: string, updates: Partial<PayrollEntry>): Promise<void> {
    const { id: _id, uploaded_at: _ua, ...patch } = { ...updates, updated_at: new Date().toISOString() }
    const { error: err } = await db
      .from('payroll')
      .update(patch)
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e))
    log({ action: 'update', resource: 'payroll', resource_id: id, summary: `Updated payroll entry ${id}` })
  }

  async function deleteEntry(id: string): Promise<void> {
    const { error: err } = await db
      .from('payroll')
      .delete()
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setEntries(prev => prev.filter(e => e.id !== id))
    log({ action: 'delete', resource: 'payroll', resource_id: id, summary: `Deleted payroll entry ${id}` })
  }

  async function clearAll(): Promise<void> {
    const { error: err } = await db
      .from('payroll')
      .delete()
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setEntries([])
  }

  return { entries, addEntry, addEntries, updateEntry, deleteEntry, clearAll, loading, error }
}
