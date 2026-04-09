import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'

export interface LoanSchedule {
  id: string
  loan_id: string
  lender: string
  currency: string
  principal: number
  outstanding_balance: number
  interest_rate: number       // as percentage e.g. 4.5 = 4.5%
  payment_date: string        // ISO date - next/upcoming payment
  maturity_date: string       // ISO date
  payment_type: 'principal' | 'interest' | 'both'
  payment_amount: number
  loan_type: 'term' | 'revolver' | 'bond' | 'other'
  description: string
  uploaded_at: string
}

export function useLoanSchedules() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const orgId = user?.profile?.org_id

  const [loans, setLoans] = useState<LoanSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await db
      .from('loan_schedules')
      .select('*')
      .eq('org_id', orgId as string)
      .order('payment_date', { ascending: true })
    if (err) setError(err.message)
    else setLoans((data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at })))
    setLoading(false)
  }, [orgId, db])

  useEffect(() => { load() }, [load])

  async function addLoan(l: Omit<LoanSchedule, 'id' | 'uploaded_at'>): Promise<LoanSchedule> {
    const { data, error: err } = await db
      .from('loan_schedules')
      .insert({ ...l, org_id: orgId, uploaded_by: user?.id })
      .select()
      .single()
    if (err) throw new Error(err.message)
    const row = { ...data, uploaded_at: data.created_at }
    setLoans(prev => [...prev, row])
    log({ action: 'create', resource: 'loan_schedule', resource_id: data.id, summary: `Created loan schedule ${data.loan_id} from ${data.lender}` })
    return row
  }

  async function addLoans(rows: Omit<LoanSchedule, 'id' | 'uploaded_at'>[]): Promise<void> {
    const { data, error: err } = await db
      .from('loan_schedules')
      .insert(rows.map(r => ({ ...r, org_id: orgId, uploaded_by: user?.id })))
      .select()
    if (err) throw new Error(err.message)
    const newRows = (data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at }))
    setLoans(prev => [...prev, ...newRows])
  }

  async function updateLoan(id: string, updates: Partial<LoanSchedule>): Promise<void> {
    const { id: _id, uploaded_at: _ua, ...patch } = { ...updates, updated_at: new Date().toISOString() }
    const { error: err } = await db
      .from('loan_schedules')
      .update(patch)
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setLoans(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l))
    log({ action: 'update', resource: 'loan_schedule', resource_id: id, summary: `Updated loan schedule ${id}` })
  }

  async function deleteLoan(id: string): Promise<void> {
    const { error: err } = await db
      .from('loan_schedules')
      .delete()
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setLoans(prev => prev.filter(l => l.id !== id))
    log({ action: 'delete', resource: 'loan_schedule', resource_id: id, summary: `Deleted loan schedule ${id}` })
  }

  async function clearAll(): Promise<void> {
    const { error: err } = await db
      .from('loan_schedules')
      .delete()
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setLoans([])
  }

  return { loans, addLoan, addLoans, updateLoan, deleteLoan, clearAll, loading, error }
}
