import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { FieldMapping, MappingStatus } from '@/types'

const SESSION_MAPPINGS_KEY = 'orbit_discovery_mappings'

export interface UseMappingsResult {
  mappings: FieldMapping[]
  loading:  boolean
  error:    string | null
  confirm:                   (id: string) => Promise<void>
  reject:                    (id: string, notes?: string) => Promise<void>
  edit:                      (id: string, newTargetField: string) => Promise<void>
  resetToProposed:           (id: string) => Promise<void>
  bulkConfirmHighConfidence: (threshold?: number) => Promise<void>
  reload: () => void
}

function toFieldMapping(
  m: Record<string, unknown>,
  idx: number,
): FieldMapping {
  return {
    id:              `local-${idx}`,
    discovery_id:    'local',
    source_table:    (m.source_table as string) ?? '',
    source_field:    (m.source_field as string) ?? '',
    source_data_type: null,
    sample_values:   (m.sample_values as string[]) ?? [],
    target_entity:   (m.target_entity as string) ?? 'exposure',
    target_field:    (m.target_field as string) ?? '',
    status:          ((m.status as MappingStatus) ?? 'proposed'),
    confidence:      (m.confidence as number) ?? 0,
    ai_reasoning:    (m.reasoning as string) ?? null,
    human_notes:     null,
    reviewed_by:     null,
    reviewed_at:     null,
    created_at:      new Date().toISOString(),
    // Reconciliation enrichment (pass through from ERP discovery path)
    ...(m.verdict != null && { verdict: m.verdict as FieldMapping['verdict'] }),
    ...(m.reconciliation_reasoning != null && { reconciliation_reasoning: m.reconciliation_reasoning as string }),
    ...(m.signals != null && { signals: m.signals as FieldMapping['signals'] }),
    ...(m.human_review_prompt != null && { human_review_prompt: m.human_review_prompt as string }),
    ...(m.human_review_priority != null && { human_review_priority: m.human_review_priority as FieldMapping['human_review_priority'] }),
    ...(m.proposal_a_field != null && { proposal_a_field: m.proposal_a_field as string }),
    ...(m.proposal_b_field != null && { proposal_b_field: m.proposal_b_field as string }),
    ...(m.proposal_a_confidence != null && { proposal_a_confidence: m.proposal_a_confidence as number }),
    ...(m.proposal_b_confidence != null && { proposal_b_confidence: m.proposal_b_confidence as number }),
  }
}

function loadFromSessionStorage(): FieldMapping[] {
  try {
    const stored = sessionStorage.getItem(SESSION_MAPPINGS_KEY)
    if (!stored) return []
    const raw = JSON.parse(stored) as Array<Record<string, unknown>>
    return raw.map((m, i) => toFieldMapping(m, i)).sort((a, b) => a.confidence - b.confidence)
  } catch {
    return []
  }
}

export function useMappings(discoveryId: string | null): UseMappingsResult {
  const [mappings, setMappings] = useState<FieldMapping[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [isLocal,  setIsLocal]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    // 1. Always try sessionStorage first — freshest data from current session
    const local = loadFromSessionStorage()
    if (local.length > 0) {
      setMappings(local)
      setIsLocal(true)
      setLoading(false)
      return
    }

    // 2. Try DB if we have a discoveryId
    if (discoveryId && discoveryId !== 'local') {
      try {
        const { data, error: err } = await supabase
          .from('field_mappings')
          .select('*')
          .eq('discovery_id', discoveryId)
          .order('confidence', { ascending: true })
        if (!err && data && data.length > 0) {
          setMappings(data as FieldMapping[])
          setIsLocal(false)
          setLoading(false)
          return
        }
      } catch {
        // fall through
      }
    }

    // 3. Nothing found
    setMappings([])
    setIsLocal(true)
    setLoading(false)
  }, [discoveryId])

  useEffect(() => { void load() }, [load])

  const applyUpdate = useCallback(async (id: string, updates: Partial<FieldMapping>) => {
    if (!isLocal) {
      const { error: err } = await supabase
        .from('field_mappings')
        .update({ ...updates, reviewed_at: new Date().toISOString() })
        .eq('id', id)
      if (err && import.meta.env.DEV) console.warn('[useMappings] DB update failed:', err.message)
    }
    setMappings(prev => {
      const updated = prev.map(m =>
        m.id === id ? { ...m, ...updates, reviewed_at: new Date().toISOString() } : m,
      )
      // Persist updated mappings to sessionStorage so GoLive can read confirmed/rejected status
      try {
        sessionStorage.setItem(SESSION_MAPPINGS_KEY, JSON.stringify(
          updated.map(m => ({
            source_table: m.source_table, source_field: m.source_field,
            target_entity: m.target_entity, target_field: m.target_field,
            confidence: m.confidence, reasoning: m.ai_reasoning,
            sample_values: m.sample_values, status: m.status,
            // Preserve reconciliation enrichment for round-trip
            ...(m.verdict != null && { verdict: m.verdict }),
            ...(m.reconciliation_reasoning != null && { reconciliation_reasoning: m.reconciliation_reasoning }),
            ...(m.signals != null && { signals: m.signals }),
            ...(m.human_review_prompt != null && { human_review_prompt: m.human_review_prompt }),
            ...(m.human_review_priority != null && { human_review_priority: m.human_review_priority }),
            ...(m.proposal_a_field != null && { proposal_a_field: m.proposal_a_field }),
            ...(m.proposal_b_field != null && { proposal_b_field: m.proposal_b_field }),
            ...(m.proposal_a_confidence != null && { proposal_a_confidence: m.proposal_a_confidence }),
            ...(m.proposal_b_confidence != null && { proposal_b_confidence: m.proposal_b_confidence }),
          })),
        ))
      } catch { /* sessionStorage full */ }
      return updated
    })
  }, [isLocal])

  const confirm = useCallback(async (id: string) => {
    await applyUpdate(id, { status: 'confirmed' as MappingStatus })
  }, [applyUpdate])

  const reject = useCallback(async (id: string, notes?: string) => {
    await applyUpdate(id, { status: 'rejected' as MappingStatus, ...(notes ? { human_notes: notes } : {}) })
  }, [applyUpdate])

  const edit = useCallback(async (id: string, newTargetField: string) => {
    await applyUpdate(id, { status: 'modified' as MappingStatus, target_field: newTargetField })
  }, [applyUpdate])

  const resetToProposed = useCallback(async (id: string) => {
    await applyUpdate(id, { status: 'proposed' as MappingStatus, human_notes: null, reviewed_at: null })
  }, [applyUpdate])

  const bulkConfirmHighConfidence = useCallback(async (threshold = 0.9) => {
    const toConfirm = mappings.filter(m => m.confidence >= threshold && m.status === 'proposed')
    for (const m of toConfirm) {
      await confirm(m.id)
    }
  }, [mappings, confirm])

  return { mappings, loading, error, confirm, reject, edit, resetToProposed, bulkConfirmHighConfidence, reload: load }
}
