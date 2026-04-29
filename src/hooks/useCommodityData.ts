import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { CommodityExposure, CommodityHedge } from '@/types'

export function useCommodityData() {
  const { user } = useAuth()
  const orgId = user?.organisation?.id
  const [exposures, setExposures] = useState<CommodityExposure[]>([])
  const [hedges, setHedges] = useState<CommodityHedge[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return

    let cancelled = false
    async function fetchData() {
      setLoading(true)
      const [expRes, hgRes] = await Promise.all([
        supabase.from('commodity_exposures').select('*').eq('org_id', orgId),
        supabase.from('commodity_hedges').select('*').eq('org_id', orgId),
      ])

      if (!cancelled) {
        setExposures(expRes.data ?? [])
        setHedges(hgRes.data ?? [])
        setLoading(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [orgId])

  // Compute metrics
  const metrics = useMemo(() => {
    let totalExposedVolume = 0
    let totalHedgedVolume = 0

    // Group by commodity type and unit of measure
    const groupedData: Record<string, { exposed: number; hedged: number; unit: string }> = {}

    exposures.forEach(exp => {
      const key = `${exp.commodity_type}-${exp.unit_of_measure}`
      if (!groupedData[key]) groupedData[key] = { exposed: 0, hedged: 0, unit: exp.unit_of_measure }
      groupedData[key].exposed += exp.volume
      totalExposedVolume += exp.volume // Note: Mixing units in a global total is technically flawed, but good for MVP illustration
    })

    hedges.forEach(hedge => {
      if (hedge.status !== 'active') return
      const key = `${hedge.commodity_type}-${hedge.unit_of_measure}`
      if (!groupedData[key]) groupedData[key] = { exposed: 0, hedged: 0, unit: hedge.unit_of_measure }
      groupedData[key].hedged += hedge.volume
      totalHedgedVolume += hedge.volume
    })

    const overallCoveragePct = totalExposedVolume > 0 ? (totalHedgedVolume / totalExposedVolume) * 100 : 0
    const activeHedgeCount = hedges.filter(h => h.status === 'active').length

    return {
      totalExposedVolume,
      totalHedgedVolume,
      overallCoveragePct,
      activeHedgeCount,
      groupedData
    }
  }, [exposures, hedges])

  return { exposures, hedges, metrics, loading }
}
