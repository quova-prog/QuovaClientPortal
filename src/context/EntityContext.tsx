import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import type { Entity } from '@/types'

const ENTITY_STORAGE_KEY = 'orbit_selected_entity_id'
const ENTITY_STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface StoredEntity { id: string; savedAt: number }

function readStoredEntityId(): string | null {
  try {
    const raw = localStorage.getItem(ENTITY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredEntity
    if (!parsed.id || !parsed.savedAt) return null
    if (Date.now() - parsed.savedAt > ENTITY_STORAGE_TTL_MS) {
      localStorage.removeItem(ENTITY_STORAGE_KEY)
      return null
    }
    return parsed.id
  } catch {
    // Legacy: plain string stored by old code
    try { return localStorage.getItem(ENTITY_STORAGE_KEY) } catch { return null }
  }
}

function writeStoredEntityId(id: string) {
  const payload: StoredEntity = { id, savedAt: Date.now() }
  localStorage.setItem(ENTITY_STORAGE_KEY, JSON.stringify(payload))
}

// ── Context shape ─────────────────────────────────────────────────────────────

interface EntityContextType {
  /** All active entities for this org */
  entities: Entity[]
  loading: boolean
  /**
   * Currently selected entity ID.
   * null  → Consolidated view (all entities rolled up)
   */
  currentEntityId: string | null
  setCurrentEntityId: (id: string | null) => void
  /** Convenience: the matching Entity object, or null when consolidated */
  currentEntity: Entity | null
  /** True when showing rolled-up consolidated view */
  isConsolidated: boolean
  /** Re-fetch entities from DB (e.g. after creating/deactivating an entity) */
  refreshEntities: () => void
}

const EntityContext = createContext<EntityContextType | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

export function EntityProvider({ children }: { children: ReactNode }) {
  const { db, user, loading: authLoading } = useAuth()
  const [entities, setEntities]             = useState<Entity[]>([])
  const [loading, setLoading]               = useState(true)
  // Restore entity selection from localStorage (with TTL) so it survives hard refreshes
  const [currentEntityId, _setCurrentEntityId] = useState<string | null>(() => {
    try { return readStoredEntityId() } catch { return null }
  })

  // Wrap setter so every change is persisted with a fresh timestamp
  const setCurrentEntityId = useCallback((id: string | null) => {
    _setCurrentEntityId(id)
    try {
      if (id) writeStoredEntityId(id)
      else localStorage.removeItem(ENTITY_STORAGE_KEY)
    } catch { /* localStorage not available */ }
  }, [])

  const fetchEntities = useCallback(() => {
    if (!user) {
      if (authLoading) return
      setEntities([])
      setLoading(false)
      try { localStorage.removeItem(ENTITY_STORAGE_KEY) } catch { /* ignore */ }
      _setCurrentEntityId(null)
      return
    }
    const orgId = user.profile?.org_id ?? user.organisation?.id
    if (!orgId) { setEntities([]); setLoading(false); return }
    setLoading(true)
    ;db
      .from('entities')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('name')
      .then(({ data, error }: any) => {
        if (error && import.meta.env.DEV) console.error('[EntityContext] fetch error:', error)
        const loaded: Entity[] = data ?? []
        setEntities(loaded)
        _setCurrentEntityId(prev => {
          if (!error && prev && !loaded.find(e => e.id === prev)) {
            try { localStorage.removeItem(ENTITY_STORAGE_KEY) } catch { /* ignore */ }
            return null
          }
          return prev
        })
        setLoading(false)
      })
  }, [db, user, authLoading])

  useEffect(() => { fetchEntities() }, [fetchEntities])

  const currentEntity   = entities.find(e => e.id === currentEntityId) ?? null
  const isConsolidated  = currentEntityId === null

  return (
    <EntityContext.Provider
      value={{ entities, loading, currentEntityId, setCurrentEntityId, currentEntity, isConsolidated, refreshEntities: fetchEntities }}
    >
      {children}
    </EntityContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useEntity() {
  const ctx = useContext(EntityContext)
  if (!ctx) throw new Error('useEntity must be used within <EntityProvider>')
  return ctx
}
