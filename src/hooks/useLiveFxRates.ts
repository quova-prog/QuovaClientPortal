import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchLatestRates, fetchRatesForDate } from '@/lib/frankfurter'

export interface LiveRate {
  pair: string            // e.g. 'EUR/USD'
  rate: number            // current rate
  prevRate: number | null // rate from previous fetch
  change: 'up' | 'down' | 'flat'
  changeAbs: number       // absolute change from previous
  changePct: number       // percentage change from previous
  rateDate: string        // date string from API
}

export function useLiveFxRates(): {
  rates: LiveRate[]
  ratesMap: Record<string, number>
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => Promise<void>
} {
  const [rates, setRates] = useState<LiveRate[]>([])
  const [ratesMap, setRatesMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Store previous day's rates as change baseline
  const prevRatesRef = useRef<Record<string, number>>({})
  const baselineLoadedRef = useRef(false)

  const fetchAndStore = useCallback(async () => {
    try {
      setError(null)

      // On first run, load yesterday's rates as baseline for daily change
      if (!baselineLoadedRef.current) {
        baselineLoadedRef.current = true
        try {
          const yd = new Date()
          yd.setDate(yd.getDate() - 1)
          // Roll back past weekends — ECB doesn't publish on Sat/Sun
          if (yd.getDay() === 0) yd.setDate(yd.getDate() - 2)
          else if (yd.getDay() === 6) yd.setDate(yd.getDate() - 1)
          const { pairs: ydRates } = await fetchRatesForDate(yd.toISOString().split('T')[0])
          prevRatesRef.current = ydRates
        } catch {
          // silently ignore — change will show as flat
        }
      }

      const { pairs: pairRates, rateDate } = await fetchLatestRates([])

      const prev = prevRatesRef.current

      // Build LiveRate array
      const liveRates: LiveRate[] = Object.entries(pairRates).map(([pair, rate]) => {
        const prevRate = prev[pair] ?? null
        const changeAbs = prevRate !== null ? rate - prevRate : 0
        const changePct = prevRate !== null && prevRate !== 0 ? (changeAbs / prevRate) * 100 : 0
        const change: 'up' | 'down' | 'flat' =
          changeAbs > 0 ? 'up' : changeAbs < 0 ? 'down' : 'flat'
        return { pair, rate, prevRate, change, changeAbs, changePct, rateDate }
      })

      const newMap: Record<string, number> = {}
      liveRates.forEach(r => { newMap[r.pair] = r.rate })
      // prevRatesRef stays as yesterday's baseline — do not overwrite

      setRates(liveRates)
      setRatesMap(newMap)
      setLastUpdated(new Date())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch rates'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch on mount
  useEffect(() => {
    fetchAndStore()
  }, [fetchAndStore])

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchAndStore()
    }, 5 * 60 * 1000)

    return () => clearInterval(intervalId)
  }, [fetchAndStore])

  return { rates, ratesMap, loading, error, lastUpdated, refresh: fetchAndStore }
}
