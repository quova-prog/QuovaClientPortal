import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'

export interface PurchaseOrder {
  id: string
  po_number: string
  supplier: string
  currency: string
  amount: number
  due_date: string
  issue_date: string
  category: string
  status: 'open' | 'approved' | 'pending' | 'paid'
  description: string
  uploaded_at: string
}

export function usePurchaseOrders() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const orgId = user?.profile?.org_id

  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await db
      .from('purchase_orders')
      .select('*')
      .eq('org_id', orgId as string)
      .order('due_date', { ascending: true })
    if (err) setError(err.message)
    else setOrders((data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at })))
    setLoading(false)
  }, [orgId, db])

  useEffect(() => { load() }, [load])

  async function addOrder(o: Omit<PurchaseOrder, 'id' | 'uploaded_at'>): Promise<PurchaseOrder> {
    const { data, error: err } = await db
      .from('purchase_orders')
      .insert({ ...o, org_id: orgId, uploaded_by: user?.id })
      .select()
      .single()
    if (err) throw new Error(err.message)
    const row = { ...data, uploaded_at: data.created_at }
    setOrders(prev => [...prev, row])
    log({ action: 'create', resource: 'purchase_order', resource_id: data.id, summary: `Created PO ${data.po_number} for ${data.supplier}` })
    return row
  }

  async function addOrders(rows: Omit<PurchaseOrder, 'id' | 'uploaded_at'>[]): Promise<void> {
    const { data, error: err } = await db
      .from('purchase_orders')
      .insert(rows.map(r => ({ ...r, org_id: orgId, uploaded_by: user?.id })))
      .select()
    if (err) throw new Error(err.message)
    const newRows = (data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at }))
    setOrders(prev => [...prev, ...newRows])
  }

  async function updateOrder(id: string, updates: Partial<PurchaseOrder>): Promise<void> {
    const { id: _id, uploaded_at: _ua, ...patch } = { ...updates, updated_at: new Date().toISOString() }
    const { error: err } = await db
      .from('purchase_orders')
      .update(patch)
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setOrders(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o))
    log({ action: 'update', resource: 'purchase_order', resource_id: id, summary: `Updated purchase order ${id}` })
  }

  async function deleteOrder(id: string): Promise<void> {
    const { error: err } = await db
      .from('purchase_orders')
      .delete()
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setOrders(prev => prev.filter(o => o.id !== id))
    log({ action: 'delete', resource: 'purchase_order', resource_id: id, summary: `Deleted purchase order ${id}` })
  }

  async function clearAll(): Promise<void> {
    const { error: err } = await db
      .from('purchase_orders')
      .delete()
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setOrders([])
  }

  return { orders, addOrder, addOrders, updateOrder, deleteOrder, clearAll, loading, error }
}
