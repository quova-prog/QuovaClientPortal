import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useAuditLog } from '@/hooks/useAuditLog'
import { useEntity } from '@/context/EntityContext'
import { useMfa } from '@/hooks/useMfa'
import type { Entity } from '@/types'
import { Save, CheckCircle, User, Bell, Building2, Lock, Plus, Pencil, X, Globe, ShieldCheck, ArrowUpRight } from 'lucide-react'
import { TIER_DISPLAY, getUpgradeTier, getUpgradeFeatures, normalizePlan } from '@/lib/tierService'

type TabKey = 'profile' | 'notifications' | 'organisation' | 'entities' | 'security'

const TABS: { key: TabKey; label: string; icon: React.FC<any> }[] = [
  { key: 'profile',       label: 'Profile',          icon: User        },
  { key: 'notifications', label: 'Notifications',    icon: Bell        },
  { key: 'organisation',  label: 'Organisation',     icon: Building2   },
  { key: 'entities',      label: 'Entities',         icon: Globe       },
  { key: 'security',      label: 'Security',         icon: ShieldCheck },
]

const CURRENCIES = ['USD','CAD','EUR','GBP','AUD','CHF','JPY','MXN','BRL','CNY','INR','SGD','HKD']
const BLANK_ENTITY = { name: '', functional_currency: 'USD', jurisdiction: '', parent_entity_id: '' }

function parseTotpUri(totpUri: string): { secret: string; issuer: string; account: string } {
  try {
    const url = new URL(totpUri)
    const label = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const [issuerFromLabel = '', account = ''] = label.split(':')
    return {
      secret: url.searchParams.get('secret') ?? '',
      issuer: url.searchParams.get('issuer') ?? issuerFromLabel,
      account,
    }
  } catch {
    return { secret: '', issuer: '', account: '' }
  }
}

export function SettingsPage() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()
  const { enroll, challenge, verify, unenroll, listFactors } = useMfa()

  const [tab, setTab] = useState<TabKey>('profile')
  const [dbError, setDbError] = useState<string | null>(null)

  // ── Profile form ──────────────────────────────────────────────────────────
  const [profileForm, setProfileForm] = useState({ full_name: '', role: '' })
  const [savingProfile, setSavingProfile] = useState(false)
  const [savedProfile, setSavedProfile]   = useState(false)

  useEffect(() => {
    if (user?.profile) {
      setProfileForm({ full_name: user.profile.full_name ?? '', role: user.profile.role ?? '' })
    }
  }, [user?.profile])

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!user?.profile?.id) return
    setSavingProfile(true)
    setDbError(null)
    const { error } = await db.from('profiles').update({ full_name: profileForm.full_name }).eq('id', user.profile.id)
    if (error) { setSavingProfile(false); setDbError(error.message); return }
    await log({
      action: 'update',
      resource: 'profile',
      resource_id: user.profile.id,
      summary: 'Updated user profile',
      metadata: { fields: ['full_name'] },
    })
    setSavingProfile(false); setSavedProfile(true)
    setTimeout(() => setSavedProfile(false), 3000)
  }

  // ── Notification prefs ────────────────────────────────────────────────────
  type NotifPrefs = {
    maturing_hedges: boolean; upcoming_settlements: boolean;
    policy_alerts: boolean; upload_events: boolean; email_digest: boolean;
  }
  const DEFAULT_NOTIF: NotifPrefs = {
    maturing_hedges: true, upcoming_settlements: true,
    policy_alerts: true, upload_events: true, email_digest: false,
  }
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(() => {
    try {
      const stored = localStorage.getItem('orbit_notif_prefs')
      if (stored) return { ...DEFAULT_NOTIF, ...JSON.parse(stored) }
    } catch {}
    return DEFAULT_NOTIF
  })
  const [savingNotif, setSavingNotif] = useState(false)
  const [savedNotif,  setSavedNotif]  = useState(false)

  function toggleNotif(k: keyof NotifPrefs) {
    setNotifPrefs(p => ({ ...p, [k]: !p[k] }))
  }

  async function handleSaveNotifications() {
    setSavingNotif(true)
    await new Promise(r => setTimeout(r, 600))
    localStorage.setItem('orbit_notif_prefs', JSON.stringify(notifPrefs))
    setSavingNotif(false); setSavedNotif(true)
    setTimeout(() => setSavedNotif(false), 3000)
  }

  // ── Entities ──────────────────────────────────────────────────────────────
  const { entities, loading: entitiesLoading, refreshEntities } = useEntity()
  const [entityForm, setEntityForm]   = useState<typeof BLANK_ENTITY>({ ...BLANK_ENTITY })
  const [editingId,  setEditingId]    = useState<string | null>(null)   // null = adding new
  const [showForm,   setShowForm]     = useState(false)
  const [savingEntity, setSavingEntity] = useState(false)
  const [savedEntity,  setSavedEntity]  = useState(false)

  const orgPlan = normalizePlan(user?.organisation?.plan)

  function openAdd() {
    setEntityForm({ ...BLANK_ENTITY })
    setEditingId(null)
    setShowForm(true)
  }

  function openEdit(e: Entity) {
    setEntityForm({
      name: e.name,
      functional_currency: e.functional_currency,
      jurisdiction: e.jurisdiction ?? '',
      parent_entity_id: e.parent_entity_id ?? '',
    })
    setEditingId(e.id)
    setShowForm(true)
  }

  async function handleSaveEntity(evt: React.FormEvent) {
    evt.preventDefault()
    if (!user?.profile?.org_id) return
    setSavingEntity(true)
    setDbError(null)
    const payload = {
      name: entityForm.name,
      functional_currency: entityForm.functional_currency,
      jurisdiction: entityForm.jurisdiction || null,
      parent_entity_id: entityForm.parent_entity_id || null,
      org_id: user.profile.org_id,
    }
    if (editingId) {
      const { error } = await db.from('entities').update(payload).eq('id', editingId)
      if (error) { setSavingEntity(false); setDbError(error.message); return }
      await log({
        action: 'update',
        resource: 'entity',
        resource_id: editingId,
        summary: `Updated entity ${entityForm.name}`,
        metadata: {
          name: entityForm.name,
          functional_currency: entityForm.functional_currency,
        },
      })
    } else {
      const { data, error } = await db.from('entities').insert(payload).select('id').single()
      if (error) { setSavingEntity(false); setDbError(error.message); return }
      await log({
        action: 'create',
        resource: 'entity',
        resource_id: data?.id,
        summary: `Created entity ${entityForm.name}`,
        metadata: {
          name: entityForm.name,
          functional_currency: entityForm.functional_currency,
        },
      })
    }
    setSavingEntity(false)
    setSavedEntity(true)
    setShowForm(false)
    setTimeout(() => setSavedEntity(false), 3000)
    refreshEntities()
  }

  async function handleDeactivate(id: string) {
    setDbError(null)
    const { error } = await db.from('entities').update({ is_active: false }).eq('id', id)
    if (error) { setDbError(error.message); return }
    await log({
      action: 'update',
      resource: 'entity',
      resource_id: id,
      summary: `Deactivated entity ${id}`,
      metadata: { is_active: false },
    })
    refreshEntities()
  }

  // ── Bulk assignment (Option C) ─────────────────────────────────────────────
  const [unassigned, setUnassigned] = useState({ exposures: 0, positions: 0 })
  const [bulkTargetId, setBulkTargetId] = useState('')
  const [assigning, setAssigning]       = useState<'exposures' | 'positions' | null>(null)
  const [assignDone, setAssignDone]     = useState<string | null>(null)
  const [unassignedStrings, setUnassignedStrings] = useState<{ entity: string; count: number }[]>([])

  // Load unassigned counts whenever the entities tab is active
  useEffect(() => {
    if (tab !== 'entities' || !user) return
    Promise.all([
      db.from('fx_exposures').select('id', { count: 'exact', head: true }).is('entity_id', null).eq('org_id', user.profile?.org_id),
      db.from('hedge_positions').select('id', { count: 'exact', head: true }).is('entity_id', null).eq('org_id', user.profile?.org_id),
      // Distinct entity strings still unassigned
      db.from('fx_exposures').select('entity').is('entity_id', null).eq('org_id', user.profile?.org_id).not('entity', 'is', null),
    ]).then(([exp, pos, strings]: any[]) => {
      setUnassigned({ exposures: exp.count ?? 0, positions: pos.count ?? 0 })
      // Tally by string value
      const tally: Record<string, number> = {}
      ;(strings.data ?? []).forEach((r: any) => {
        const key = r.entity?.trim() || '(blank)'
        tally[key] = (tally[key] ?? 0) + 1
      })
      setUnassignedStrings(Object.entries(tally).map(([entity, count]) => ({ entity, count })).sort((a, b) => b.count - a.count))
    })
  }, [tab, user, db])

  async function handleBulkAssign(type: 'exposures' | 'positions') {
    if (!bulkTargetId || !user?.profile?.org_id) return
    setAssigning(type)
    setDbError(null)
    const table = type === 'exposures' ? 'fx_exposures' : 'hedge_positions'
    const { error } = await db.from(table).update({ entity_id: bulkTargetId }).is('entity_id', null).eq('org_id', user.profile.org_id)
    setAssigning(null)
    if (error) { setDbError(error.message); return }
    const name = entities.find(e => e.id === bulkTargetId)?.name ?? 'entity'
    await log({
      action: 'update',
      resource: table,
      summary: `Bulk assigned unassigned ${type} to ${name}`,
      metadata: {
        entity_id: bulkTargetId,
        entity_name: name,
      },
    })
    setAssignDone(`All unassigned ${type} assigned to ${name}`)
    setTimeout(() => setAssignDone(null), 4000)
    refreshEntities()
  }

  // ── MFA state ─────────────────────────────────────────────────────────────
  const [mfaFactors, setMfaFactors] = useState<{ id: string; friendly_name: string; factor_type: string; status: string }[]>([])
  const [mfaLoading, setMfaLoading] = useState(false)
  const [mfaEnrolling, setMfaEnrolling] = useState(false)
  const [mfaFactorId, setMfaFactorId] = useState('')
  const [mfaTotpUri, setMfaTotpUri] = useState('')
  const parsedTotp = useMemo(() => parseTotpUri(mfaTotpUri), [mfaTotpUri])
  const [mfaChallengeId, setMfaChallengeId] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [mfaVerifying, setMfaVerifying] = useState(false)
  const [mfaSuccess, setMfaSuccess] = useState(false)
  const [mfaError, setMfaError] = useState<string | null>(null)
  const [mfaRemoving, setMfaRemoving] = useState(false)

  async function loadMfaFactors() {
    setMfaLoading(true)
    const { factors } = await listFactors()
    setMfaFactors(factors.filter(f => f.status === 'verified'))
    setMfaLoading(false)
  }

  useEffect(() => {
    if (tab === 'security') {
      loadMfaFactors()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  async function handleEnroll() {
    setMfaError(null)
    setMfaEnrolling(true)
    // Clean up any pending (unverified) factors left over from a previous attempt
    const { factors: existingFactors } = await listFactors()
    const pending = existingFactors.filter(f => f.status !== 'verified')
    for (const f of pending) {
      await unenroll(f.id)
    }
    const { factorId, totpUri, error } = await enroll()
    if (error) { setMfaError(error); setMfaEnrolling(false); return }
    setMfaFactorId(factorId)
    setMfaTotpUri(totpUri)
    setMfaEnrolling(false)
  }

  async function handleVerify() {
    setMfaError(null)
    setMfaVerifying(true)
    const { challengeId, error: cErr } = await challenge(mfaFactorId)
    if (cErr) { setMfaError(cErr); setMfaVerifying(false); return }
    const { error: vErr } = await verify(mfaFactorId, challengeId || mfaChallengeId, mfaCode)
    if (vErr) { setMfaError(vErr); setMfaVerifying(false); return }
    setMfaVerifying(false)
    setMfaSuccess(true)
    setMfaFactorId('')
    setMfaTotpUri('')
    setMfaCode('')
    setMfaChallengeId('')
    await log({
      action: 'update',
      resource: 'mfa_factor',
      resource_id: mfaFactorId,
      summary: 'Enabled MFA',
      metadata: { factor_type: 'totp' },
    })
    await loadMfaFactors()
    setTimeout(() => setMfaSuccess(false), 5000)
  }

  async function handleUnenroll(factorId: string) {
    setMfaError(null)
    setMfaRemoving(true)
    const { error } = await unenroll(factorId)
    if (error) { setMfaError(error); setMfaRemoving(false); return }
    setMfaRemoving(false)
    await log({
      action: 'delete',
      resource: 'mfa_factor',
      resource_id: factorId,
      summary: 'Removed MFA factor',
      metadata: { factor_type: 'totp' },
    })
    await loadMfaFactors()
  }

  const NOTIF_OPTIONS: { key: keyof NotifPrefs; label: string; desc: string }[] = [
    { key: 'maturing_hedges',      label: 'Maturing Positions',    desc: 'Alert when a hedge position is due within 7 days' },
    { key: 'upcoming_settlements', label: 'Upcoming Settlements',  desc: 'Alert when an exposure settles within 3 days' },
    { key: 'policy_alerts',        label: 'Policy Compliance',     desc: 'Alert when coverage falls outside policy range' },
    { key: 'upload_events',        label: 'Upload Events',         desc: 'Alert on CSV import success or failure' },
    { key: 'email_digest',         label: 'Weekly Email Digest',   desc: 'Send a weekly summary to your email address' },
  ]

  return (
    <div className="fade-in" style={{ maxWidth: 720, padding: '1.75rem' }}>

      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Settings</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
          Configure profile, preferences and account settings
        </p>
      </div>

      {dbError && (
        <div className="error-banner" style={{
          padding: '0.75rem 1rem', marginBottom: '1rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          <span style={{ flex: 1 }}>Save failed: {dbError}</span>
          <button onClick={() => setDbError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div className="tab-bar" style={{ marginBottom: '1.5rem' }}>
        {TABS.map(t => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Profile ───────────────────────────────────────────────────────── */}
      {tab === 'profile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <User size={16} color="var(--teal)" />
              <h3 style={{ fontWeight: 600 }}>Personal Details</h3>
            </div>

            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="label">Display Name</label>
                <input className="input" value={profileForm.full_name}
                  onChange={e => setProfileForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="Your name" />
              </div>
              <div>
                <label className="label">Email Address</label>
                <input className="input" value={user?.email ?? ''} readOnly
                  style={{ opacity: 0.6, cursor: 'not-allowed' }} />
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Email cannot be changed here</p>
              </div>
              <div>
                <label className="label">Role</label>
                <input className="input" value={profileForm.role} readOnly
                  style={{ opacity: 0.6, cursor: 'not-allowed', textTransform: 'capitalize' }} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button className="btn btn-primary" type="submit" disabled={savingProfile}>
                  {savingProfile
                    ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving…</>
                    : <><Save size={14} /> Save Profile</>
                  }
                </button>
                {savedProfile && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--green)', fontSize: '0.875rem' }}>
                    <CheckCircle size={14} /> Saved
                  </div>
                )}
              </div>
            </form>
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <Lock size={16} color="var(--text-muted)" />
              <h3 style={{ fontWeight: 600 }}>Security</h3>
            </div>
            <button className="btn btn-ghost btn-sm">Change Password →</button>
          </div>
        </div>
      )}

      {/* ── Notifications ─────────────────────────────────────────────────── */}
      {tab === 'notifications' && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
            <Bell size={16} color="var(--teal)" />
            <h3 style={{ fontWeight: 600 }}>Notification Preferences</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {NOTIF_OPTIONS.map((opt, i) => (
              <div key={opt.key}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 0', borderBottom: i < NOTIF_OPTIONS.length - 1 ? '1px solid var(--border-dim)' : 'none' }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '0.125rem' }}>{opt.label}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{opt.desc}</div>
                </div>
                {/* Toggle */}
                <button
                  onClick={() => toggleNotif(opt.key)}
                  style={{
                    width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', flexShrink: 0,
                    background: notifPrefs[opt.key] ? 'var(--teal)' : '#cbd5e1',
                    position: 'relative', transition: 'background 0.2s',
                  }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%', background: '#fff',
                    position: 'absolute', top: 3,
                    left: notifPrefs[opt.key] ? 21 : 3,
                    transition: 'left 0.2s',
                  }} />
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1rem' }}>
            <button className="btn btn-primary btn-sm" disabled={savingNotif} onClick={handleSaveNotifications}>
              {savingNotif
                ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Saving…</>
                : <><Save size={13} /> Save Preferences</>
              }
            </button>
            {savedNotif && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--green)', fontSize: '0.875rem' }}>
                <CheckCircle size={14} /> Saved
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Entities ──────────────────────────────────────────────────────── */}
      {tab === 'entities' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Header + Add button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h3 style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Legal Entities</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                Each entity can have its own functional currency and hedge exposure
              </p>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={openAdd}
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              <Plus size={13} /> Add Entity
            </button>
          </div>

          {/* Add / Edit form */}
          {showForm && (
            <div className="card" style={{ border: '1px solid rgba(0,200,160,0.25)', background: 'rgba(0,200,160,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h4 style={{ fontWeight: 600, fontSize: '0.875rem' }}>{editingId ? 'Edit Entity' : 'New Entity'}</h4>
                <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
                  <X size={15} />
                </button>
              </div>
              <form onSubmit={handleSaveEntity} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                <div>
                  <label className="label">Entity Name *</label>
                  <input className="input" required value={entityForm.name}
                    onChange={e => setEntityForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Acme Europe GmbH" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="label">Functional Currency *</label>
                    <select className="input" value={entityForm.functional_currency}
                      onChange={e => setEntityForm(f => ({ ...f, functional_currency: e.target.value }))}>
                      {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Jurisdiction</label>
                    <input className="input" value={entityForm.jurisdiction}
                      onChange={e => setEntityForm(f => ({ ...f, jurisdiction: e.target.value }))}
                      placeholder="e.g. DE, CA, US" maxLength={10} />
                  </div>
                </div>
                <div>
                  <label className="label">Parent Entity (optional)</label>
                  <select className="input" value={entityForm.parent_entity_id}
                    onChange={e => setEntityForm(f => ({ ...f, parent_entity_id: e.target.value }))}>
                    <option value="">— None (top-level) —</option>
                    {entities.filter(e => e.id !== editingId).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', paddingTop: '0.25rem' }}>
                  <button className="btn btn-primary btn-sm" type="submit" disabled={savingEntity}>
                    {savingEntity
                      ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Saving…</>
                      : <><Save size={13} /> {editingId ? 'Update Entity' : 'Create Entity'}</>
                    }
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          {/* Entity list */}
          {entitiesLoading ? (
            <div className="spinner" style={{ width: 20, height: 20 }} />
          ) : entities.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              <Globe size={28} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
              <p style={{ fontWeight: 500, marginBottom: '0.25rem' }}>No entities yet</p>
              <p style={{ fontSize: '0.75rem' }}>Add your first legal entity to enable entity-level tracking</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {entities.map((entity, i) => {
                const parent = entities.find(e => e.id === entity.parent_entity_id)
                return (
                  <div key={entity.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.875rem 1rem',
                    borderBottom: i < entities.length - 1 ? '1px solid var(--border-dim)' : 'none',
                  }}>
                    <div style={{ width: 34, height: 34, borderRadius: 'var(--r-md)', background: 'rgba(0,200,160,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Building2 size={15} color="var(--teal)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{entity.name}</div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                        {entity.functional_currency}
                        {entity.jurisdiction ? ` · ${entity.jurisdiction}` : ''}
                        {parent ? ` · under ${parent.name}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(entity)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem' }}>
                        <Pencil size={12} /> Edit
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDeactivate(entity.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem', color: 'var(--red, #ef4444)' }}>
                        <X size={12} /> Remove
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {savedEntity && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--green)', fontSize: '0.875rem' }}>
              <CheckCircle size={14} /> Entity saved
            </div>
          )}

          {/* ── Bulk Assignment (Option C) ───────────────────────────────── */}
          {entities.length > 0 && (
            <div className="card" style={{ border: '1px solid rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.04)' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem' }}>Bulk Data Assignment</div>

              {/* Counts */}
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                {(['exposures', 'positions'] as const).map(type => (
                  <div key={type} style={{ flex: 1, padding: '0.625rem', background: 'var(--sidebar-hover)', borderRadius: 'var(--r-md)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.125rem', fontWeight: 700, color: unassigned[type] > 0 ? '#f59e0b' : 'var(--teal)' }}>
                      {unassigned[type].toLocaleString()}
                    </div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                      unassigned {type === 'exposures' ? 'exposures' : 'hedge positions'}
                    </div>
                  </div>
                ))}
              </div>

              {/* Unmatched entity strings from CSVs */}
              {unassignedStrings.length > 0 && (
                <div style={{ marginBottom: '1rem', padding: '0.625rem', background: 'var(--sidebar-hover)', borderRadius: 'var(--r-md)' }}>
                  <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    Unmatched entity strings in your CSV data
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                    {unassignedStrings.map(({ entity, count }) => (
                      <span key={entity} style={{ fontSize: '0.6875rem', padding: '0.2rem 0.5rem', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 999, color: '#f59e0b' }}>
                        {entity} <span style={{ opacity: 0.7 }}>×{count}</span>
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Tip: rename an entity above to exactly match one of these strings, then re-run the auto-match SQL.
                  </div>
                </div>
              )}

              {/* Bulk assign controls */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                <div>
                  <label className="label">Assign ALL untagged records to</label>
                  <select className="input" value={bulkTargetId} onChange={e => setBulkTargetId(e.target.value)}>
                    <option value="">— Select entity —</option>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.name} ({e.functional_currency})</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button className="btn btn-sm" disabled={!bulkTargetId || assigning === 'exposures' || unassigned.exposures === 0}
                    onClick={() => handleBulkAssign('exposures')}
                    style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)', color: '#f59e0b' }}>
                    {assigning === 'exposures'
                      ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Assigning…</>
                      : `Assign ${unassigned.exposures.toLocaleString()} exposures →`}
                  </button>
                  <button className="btn btn-sm" disabled={!bulkTargetId || assigning === 'positions' || unassigned.positions === 0}
                    onClick={() => handleBulkAssign('positions')}
                    style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)', color: '#f59e0b' }}>
                    {assigning === 'positions'
                      ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Assigning…</>
                      : `Assign ${unassigned.positions.toLocaleString()} positions →`}
                  </button>
                </div>
                {unassigned.exposures === 0 && unassigned.positions === 0 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <CheckCircle size={13} /> All records are assigned to an entity
                  </div>
                )}
                {assignDone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--green)', fontSize: '0.8125rem' }}>
                    <CheckCircle size={13} /> {assignDone}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Organisation ──────────────────────────────────────────────────── */}
      {tab === 'organisation' && (() => {
        const tierInfo = TIER_DISPLAY[orgPlan] ?? TIER_DISPLAY.exposure
        const upgradeTier = getUpgradeTier(orgPlan)
        const upgradeFeatures = getUpgradeFeatures(orgPlan)
        const badgeBg = tierInfo.badgeStyle === 'outline' ? 'transparent'
          : tierInfo.badgeStyle === 'solid-teal' ? '#00C2A8' : '#0A0F1E'
        const badgeColor = tierInfo.badgeStyle === 'outline' ? '#00C2A8' : '#fff'
        const badgeBorder = tierInfo.badgeStyle === 'outline' ? '1px solid #00C2A8' : 'none'

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <Building2 size={16} color="var(--teal)" />
                <h3 style={{ fontWeight: 600 }}>Organisation Details</h3>
              </div>
              <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-dim)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Organisation Name</span>
                  <span style={{ fontWeight: 500 }}>{user?.organisation?.name ?? '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-dim)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Plan</span>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                    padding: '0.2rem 0.625rem', borderRadius: 999,
                    fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em',
                    background: badgeBg, color: badgeColor, border: badgeBorder,
                  }}>
                    {tierInfo.badge}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-dim)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Account Email</span>
                  <span style={{ fontWeight: 500 }}>{user?.email ?? '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-dim)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Your Role</span>
                  <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{user?.profile?.role ?? '—'}</span>
                </div>
              </div>
            </div>

            {/* Tier comparison card */}
            {upgradeTier && (
              <div className="card" style={{ border: '1px solid rgba(0,194,168,0.2)', background: 'rgba(0,194,168,0.03)' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: '#0A0F1E', marginBottom: '0.75rem' }}>
                  Unlock more with {TIER_DISPLAY[upgradeTier].name}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.25rem' }}>
                  {upgradeFeatures.map(f => (
                    <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <CheckCircle size={13} color="#00C2A8" />
                      <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{f}</span>
                    </div>
                  ))}
                </div>
                <a
                  href="mailto:sales@orbitfx.com?subject=Upgrade%20Inquiry"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                    padding: '0.5rem 1rem',
                    background: '#00C2A8', color: '#fff', border: 'none', borderRadius: 'var(--r-md)',
                    fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none', cursor: 'pointer',
                  }}
                >
                  Contact Sales <ArrowUpRight size={13} />
                </a>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Security ──────────────────────────────────────────────────────── */}
      {tab === 'security' && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <ShieldCheck size={16} color="var(--teal)" />
            <h3 style={{ fontWeight: 600 }}>Two-Factor Authentication</h3>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Add an extra layer of security to your account. Once enabled, you'll need your authenticator app to sign in.
          </p>

          {mfaLoading ? (
            <div className="spinner" style={{ width: 20, height: 20 }} />
          ) : mfaFactors.length > 0 ? (
            /* MFA is enrolled */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {mfaFactors.map(factor => (
                <div key={factor.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1rem', background: 'rgba(0,200,160,0.06)', border: '1px solid rgba(0,200,160,0.2)', borderRadius: 'var(--r-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <CheckCircle size={16} color="var(--teal)" />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                        Two-Factor Authentication is active
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                        {factor.friendly_name} · {factor.factor_type.toUpperCase()}
                      </div>
                    </div>
                  </div>
                  <button
                    className="btn btn-sm"
                    disabled={mfaRemoving}
                    onClick={() => handleUnenroll(factor.id)}
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  >
                    {mfaRemoving
                      ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Removing…</>
                      : <><X size={12} /> Remove</>
                    }
                  </button>
                </div>
              ))}
            </div>
          ) : mfaFactorId ? (
            /* Enrollment in progress — show QR + verify form */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', marginBottom: '0.5rem', fontWeight: 500 }}>
                  Add this account in your authenticator app using the setup key below:
                </p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  We no longer send MFA setup secrets to any external QR code service. Enter the key manually in Google Authenticator, 1Password, Authy, or another TOTP app.
                </p>
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem' }}>Setup key</p>
                <code style={{ display: 'block', padding: '0.625rem 0.875rem', background: 'var(--sidebar-hover)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: '0.8rem', color: 'var(--text-primary)', wordBreak: 'break-all', userSelect: 'all', letterSpacing: '0.06em' }}>
                  {parsedTotp.secret || 'Setup key unavailable'}
                </code>
              </div>
              {(parsedTotp.issuer || parsedTotp.account) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem' }}>Issuer</p>
                    <div className="input" style={{ display: 'flex', alignItems: 'center', opacity: 0.85 }}>
                      {parsedTotp.issuer || 'Orbit'}
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem' }}>Account</p>
                    <div className="input" style={{ display: 'flex', alignItems: 'center', opacity: 0.85 }}>
                      {parsedTotp.account || (user?.email ?? 'Your account')}
                    </div>
                  </div>
                </div>
              )}
              <div>
                <label className="label">Enter the 6-digit code from your authenticator app</label>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  style={{ width: 200, textAlign: 'center', fontFamily: 'monospace', fontSize: '1.25rem', letterSpacing: '0.2em' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  className="btn btn-primary"
                  disabled={mfaVerifying || mfaCode.length !== 6}
                  onClick={handleVerify}
                >
                  {mfaVerifying
                    ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Verifying…</>
                    : <><ShieldCheck size={14} /> Verify &amp; Activate</>
                  }
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setMfaFactorId(''); setMfaTotpUri(''); setMfaCode(''); setMfaError(null) }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            /* Not enrolled */
            <button
              className="btn btn-primary"
              disabled={mfaEnrolling}
              onClick={handleEnroll}
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              {mfaEnrolling
                ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Setting up…</>
                : <><ShieldCheck size={14} /> Enable Two-Factor Auth</>
              }
            </button>
          )}

          {mfaSuccess && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--teal)', fontSize: '0.875rem', marginTop: '1rem' }}>
              <CheckCircle size={14} /> MFA enabled successfully
            </div>
          )}

          {mfaError && (
            <div style={{ marginTop: '0.875rem', padding: '0.625rem 0.875rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--r-md)', fontSize: '0.8125rem', color: '#ef4444' }}>
              {mfaError}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
