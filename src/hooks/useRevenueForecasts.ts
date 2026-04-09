import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'

export interface RevenueForecast {
  id: string
  currency: string
  amount: number
  period: string
  fiscal_year: number
  segment: string
  region: string
  description: string
  uploaded_at: string
}

export function useRevenueForecasts() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const orgId = user?.profile?.org_id

  const [forecasts, setForecasts] = useState<RevenueForecast[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await db
      .from('revenue_forecasts')
      .select('*')
      .eq('org_id', orgId as string)
      .order('fiscal_year', { ascending: true })
    if (err) setError(err.message)
    else setForecasts((data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at })))
    setLoading(false)
  }, [orgId, db])

  useEffect(() => { load() }, [load])

  async function addForecast(f: Omit<RevenueForecast, 'id' | 'uploaded_at'>): Promise<RevenueForecast> {
    const { data, error: err } = await db
      .from('revenue_forecasts')
      .insert({ ...f, org_id: orgId, uploaded_by: user?.id })
      .select()
      .single()
    if (err) throw new Error(err.message)
    const row = { ...data, uploaded_at: data.created_at }
    setForecasts(prev => [...prev, row])
    log({ action: 'create', resource: 'revenue_forecast', resource_id: data.id, summary: `Created revenue forecast for ${data.currency} ${data.period}` })
    return row
  }

  async function addForecasts(rows: Omit<RevenueForecast, 'id' | 'uploaded_at'>[]): Promise<void> {
    const { data, error: err } = await db
      .from('revenue_forecasts')
      .insert(rows.map(r => ({ ...r, org_id: orgId, uploaded_by: user?.id })))
      .select()
    if (err) throw new Error(err.message)
    const newRows = (data ?? []).map((r: any) => ({ ...r, uploaded_at: r.created_at }))
    setForecasts(prev => [...prev, ...newRows])
  }

  async function updateForecast(id: string, updates: Partial<RevenueForecast>): Promise<void> {
    const { id: _id, uploaded_at: _ua, ...patch } = { ...updates, updated_at: new Date().toISOString() }
    const { error: err } = await db
      .from('revenue_forecasts')
      .update(patch)
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setForecasts(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))
    log({ action: 'update', resource: 'revenue_forecast', resource_id: id, summary: `Updated revenue forecast ${id}` })
  }

  async function deleteForecast(id: string): Promise<void> {
    const { error: err } = await db
      .from('revenue_forecasts')
      .delete()
      .eq('id', id as string)
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setForecasts(prev => prev.filter(f => f.id !== id))
    log({ action: 'delete', resource: 'revenue_forecast', resource_id: id, summary: `Deleted revenue forecast ${id}` })
  }

  async function clearAll(): Promise<void> {
    const { error: err } = await db
      .from('revenue_forecasts')
      .delete()
      .eq('org_id', orgId as string)
    if (err) throw new Error(err.message)
    setForecasts([])
  }

  return { forecasts, addForecast, addForecasts, updateForecast, deleteForecast, clearAll, loading, error }
}
