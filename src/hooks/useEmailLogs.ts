import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'

export interface EmailLog {
  id: string
  email_type: 'urgent_alert' | 'daily_digest' | 'weekly_digest'
  recipient: string
  subject: string
  status: 'sent' | 'failed' | 'bounced'
  error: string | null
  sent_at: string
}

export function useEmailLogs(pageSize = 20) {
  const { user, db } = useAuth()
  const orgId = user?.profile?.org_id
  const isAdmin = user?.profile?.role === 'admin'

  const [logs, setLogs] = useState<EmailLog[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const load = useCallback(async () => {
    if (!orgId || !isAdmin) { setLoading(false); return }
    setLoading(true)

    let query = db
      .from('email_logs')
      .select('id, email_type, recipient, subject, status, error, sent_at', { count: 'exact' })
      .eq('org_id', orgId)
      .order('sent_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (typeFilter !== 'all') {
      query = query.eq('email_type', typeFilter)
    }

    const { data, error, count } = await query

    if (error) {
      // Graceful fallback if table doesn't exist yet
      if (error.message.includes('schema cache') || error.code === '42P01') {
        setLogs([])
        setTotal(0)
        setLoading(false)
        return
      }
      setLoading(false)
      return
    }

    setLogs((data ?? []) as EmailLog[])
    setTotal(count ?? 0)
    setLoading(false)
  }, [orgId, isAdmin, db, page, pageSize, typeFilter])

  useEffect(() => { load() }, [load])

  return {
    logs, loading, total, page, setPage, typeFilter, setTypeFilter,
    pageSize, isAdmin, reload: load,
    totalPages: Math.ceil(total / pageSize),
  }
}
