import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useAuditLog } from '@/hooks/useAuditLog'
import { useEntity } from '@/context/EntityContext'
import { useMfa } from '@/hooks/useMfa'
import type { Entity } from '@/types'
import { Save, CheckCircle, User, Bell, Building2, Lock, Plus, Pencil, X, Globe, ShieldCheck, ArrowUpRight, Mail, Users, Trash2, Send, ChevronDown, Zap } from 'lucide-react'
import { TIER_DISPLAY, getUpgradeTier, getUpgradeFeatures, normalizePlan } from '@/lib/tierService'
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences'
import { useTeamMembers } from '@/hooks/useTeamMembers'
import { useTeamNotificationSummary } from '@/hooks/useTeamNotificationSummary'
import { useEmailLogs } from '@/hooks/useEmailLogs'

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

  // ── Notification prefs (DB-backed) ───────────────────────────────────────
  const { prefs: notifPrefs, loading: notifLoading, saving: savingNotif, error: notifError, isGated: notifGated, update: updateNotifPrefs } = useNotificationPreferences()
  const [savedNotif, setSavedNotif] = useState(false)

  async function handleSaveNotifications() {
    if (!notifPrefs) return
    const ok = await updateNotifPrefs({
      email_urgent: notifPrefs.email_urgent,
      email_digest: notifPrefs.email_digest,
      digest_frequency: notifPrefs.digest_frequency,
      digest_time: notifPrefs.digest_time,
      alert_types: notifPrefs.alert_types,
    })
    if (ok) { setSavedNotif(true); setTimeout(() => setSavedNotif(false), 3000) }
  }

  // ── Test Email ──────────────────────────────────────────────────────────
  const [testEmailSending, setTestEmailSending] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleSendTestEmail() {
    if (!user?.profile?.org_id || !db) return
    setTestEmailSending(true)
    setTestEmailResult(null)
    try {
      const orgId = user.profile.org_id
      // Insert a test urgent alert
      const { data: alert, error: insertErr } = await db.from('alerts').insert({
        org_id: orgId,
        alert_key: `test_email_${Date.now()}`,
        type: 'policy_breach',
        severity: 'urgent',
        title: 'Test Alert — SendGrid Integration',
        body: 'This is a test email from Quova to verify your SendGrid integration is working correctly. No action required.',
        href: '/inbox',
      }).select('id').single()

      if (insertErr || !alert) {
        setTestEmailResult({ ok: false, message: insertErr?.message ?? 'Failed to create test alert' })
        setTestEmailSending(false)
        return
      }

      // Call the Edge Function
      const { data, error: fnErr } = await db.functions.invoke('send-urgent-email', {
        body: { alert_id: alert.id, org_id: orgId },
      })

      if (fnErr) {
        // Extract the actual response body from FunctionsHttpError
        let detail = fnErr.message
        try {
          if ('context' in fnErr) {
            const ctx = (fnErr as any).context
            if (ctx instanceof Response) {
              const body = await ctx.json()
              detail = JSON.stringify(body)
            }
          }
        } catch { /* ignore parse errors */ }
        setTestEmailResult({ ok: false, message: detail })
      } else if (data?.sent > 0) {
        setTestEmailResult({ ok: true, message: `Test email sent to ${data.sent} recipient(s). Check your inbox!` })
      } else {
        setTestEmailResult({ ok: false, message: data?.message ?? 'No emails sent — check notification preferences and org plan' })
      }
    } catch (err) {
      setTestEmailResult({ ok: false, message: String(err) })
    }
    setTestEmailSending(false)
  }

  // ── Team Members ─────────────────────────────────────────────────────────
  const {
    members: teamMembers, invites: teamInvites, loading: teamLoading,
    error: teamError, isAdmin,
    invite: inviteTeamMember, revokeInvite, updateRole, removeMember,
  } = useTeamMembers()
  const { entries: teamNotifEntries, loading: teamNotifLoading, noOneHasUrgent } = useTeamNotificationSummary()
  const {
    logs: emailLogs, loading: emailLogsLoading, total: emailLogsTotal,
    page: emailLogsPage, setPage: setEmailLogsPage, typeFilter: emailTypeFilter,
    setTypeFilter: setEmailTypeFilter, totalPages: emailLogsTotalPages,
  } = useEmailLogs()
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('editor')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteError(null)
    const result = await inviteTeamMember(inviteEmail, inviteRole)
    setInviting(false)
    if (result.error) { setInviteError(result.error); return }
    setShowInviteModal(false)
    setInviteEmail('')
    setInviteRole('editor')
  }

  async function handleRemoveMember(userId: string) {
    const result = await removeMember(userId)
    if (result.error) setDbError(result.error)
    setConfirmRemove(null)
  }

  async function handleRoleChange(userId: string, newRole: 'admin' | 'editor' | 'viewer') {
    const result = await updateRole(userId, newRole)
    if (result.error) setDbError(result.error)
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

  const ALERT_TYPE_OPTIONS: { key: string; label: string; desc: string }[] = [
    { key: 'policy_breach',      label: 'Policy Breaches',       desc: 'Coverage falls outside policy range' },
    { key: 'maturing_position',  label: 'Maturing Positions',    desc: 'Hedge position matures within 7–30 days' },
    { key: 'cash_flow_due',      label: 'Cash Flows Due',        desc: 'Large cash flow settlement approaching' },
    { key: 'unhedged_exposure',  label: 'Unhedged Exposure',     desc: 'Currency pair below minimum hedge coverage' },
  ]

  const DIGEST_HOURS = Array.from({ length: 24 }, (_, i) => {
    const h = i % 12 || 12
    const ampm = i < 12 ? 'AM' : 'PM'
    return { value: i, label: `${h}:00 ${ampm}` }
  })

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Tier gating banner */}
          {notifGated && (
            <div className="card" style={{ border: '1px solid rgba(0,194,168,0.2)', background: 'rgba(0,194,168,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Mail size={16} color="var(--teal)" />
                <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Email Notifications</span>
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Email notifications for urgent alerts and daily digests are available on Pro and Enterprise plans.
              </p>
              <a
                href="mailto:sales@orbitfx.com?subject=Upgrade%20Inquiry"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                  padding: '0.5rem 1rem',
                  background: '#00C2A8', color: '#fff', border: 'none', borderRadius: 'var(--r-md)',
                  fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none', cursor: 'pointer',
                }}
              >
                Upgrade to Pro <ArrowUpRight size={13} />
              </a>
            </div>
          )}

          {/* Email notification settings */}
          <div className="card" style={{ opacity: notifGated ? 0.5 : 1, pointerEvents: notifGated ? 'none' : 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <Bell size={16} color="var(--teal)" />
              <h3 style={{ fontWeight: 600 }}>Email Notifications</h3>
            </div>

            {notifLoading ? (
              <div className="spinner" style={{ width: 20, height: 20 }} />
            ) : notifPrefs ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Urgent email toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 0', borderBottom: '1px solid var(--border-dim)' }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '0.125rem' }}>Urgent Alert Emails</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Send immediate email when an urgent alert fires</div>
                  </div>
                  <button
                    onClick={() => updateNotifPrefs({ email_urgent: !notifPrefs.email_urgent })}
                    style={{
                      width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: notifPrefs.email_urgent ? 'var(--teal)' : '#cbd5e1',
                      position: 'relative', transition: 'background 0.2s',
                    }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%', background: '#fff',
                      position: 'absolute', top: 3,
                      left: notifPrefs.email_urgent ? 21 : 3,
                      transition: 'left 0.2s',
                    }} />
                  </button>
                </div>

                {/* Digest email toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 0', borderBottom: '1px solid var(--border-dim)' }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '0.125rem' }}>Daily / Weekly Digest</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Receive a summary PDF with KPIs, alerts, and upcoming actions</div>
                  </div>
                  <button
                    onClick={() => updateNotifPrefs({ email_digest: !notifPrefs.email_digest })}
                    style={{
                      width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: notifPrefs.email_digest ? 'var(--teal)' : '#cbd5e1',
                      position: 'relative', transition: 'background 0.2s',
                    }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%', background: '#fff',
                      position: 'absolute', top: 3,
                      left: notifPrefs.email_digest ? 21 : 3,
                      transition: 'left 0.2s',
                    }} />
                  </button>
                </div>

                {/* Digest options (visible when digest enabled) */}
                {notifPrefs.email_digest && (
                  <div style={{ padding: '1rem 0', borderBottom: '1px solid var(--border-dim)', display: 'flex', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <label className="label">Frequency</label>
                      <select
                        className="input"
                        value={notifPrefs.digest_frequency}
                        onChange={e => updateNotifPrefs({ digest_frequency: e.target.value as 'daily' | 'weekly' })}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="label">Delivery Time (UTC)</label>
                      <select
                        className="input"
                        value={notifPrefs.digest_time}
                        onChange={e => updateNotifPrefs({ digest_time: parseInt(e.target.value) })}
                      >
                        {DIGEST_HOURS.map(h => (
                          <option key={h.value} value={h.value}>{h.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Alert types */}
                <div style={{ padding: '1rem 0' }}>
                  <div style={{ fontWeight: 500, fontSize: '0.8125rem', color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
                    Alert Types to Include in Emails
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {ALERT_TYPE_OPTIONS.map(opt => {
                      const isChecked = notifPrefs.alert_types.includes(opt.key)
                      return (
                        <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              const next = isChecked
                                ? notifPrefs.alert_types.filter(t => t !== opt.key)
                                : [...notifPrefs.alert_types, opt.key]
                              updateNotifPrefs({ alert_types: next })
                            }}
                            style={{ accentColor: 'var(--teal)' }}
                          />
                          <div>
                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{opt.label}</div>
                            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{opt.desc}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {notifError && (
              <div className="error-banner" style={{ padding: '0.625rem 0.875rem', marginTop: '0.75rem' }}>
                {notifError}
              </div>
            )}

            {savedNotif && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--green)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
                <CheckCircle size={14} /> Preferences saved
              </div>
            )}

            {/* Send Test Email */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleSendTestEmail}
                  disabled={testEmailSending || notifGated}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
                >
                  {testEmailSending ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Zap size={14} />}
                  {testEmailSending ? 'Sending...' : 'Send Test Email'}
                </button>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Creates a test urgent alert and emails all opted-in users
                </span>
              </div>
              {testEmailResult && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.375rem',
                  fontSize: '0.8125rem', marginTop: '0.5rem',
                  color: testEmailResult.ok ? 'var(--green)' : 'var(--red)',
                }}>
                  {testEmailResult.ok ? <CheckCircle size={14} /> : <X size={14} />}
                  {testEmailResult.message}
                </div>
              )}
            </div>
          </div>

          {/* ── Team Notification Summary (admin only) ──────────────────── */}
          {isAdmin && !notifGated && (
            <>
              {noOneHasUrgent && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.75rem 1rem', borderRadius: 'var(--r-md)',
                  background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
                  fontSize: '0.8125rem', color: '#92400e',
                }}>
                  <Bell size={14} color="#f59e0b" />
                  <span><strong>Warning:</strong> No team member has urgent email alerts enabled. Critical alerts may go unnoticed.</span>
                </div>
              )}

              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                  <Users size={16} color="var(--teal)" />
                  <h3 style={{ fontWeight: 600 }}>Team Notification Summary</h3>
                </div>

                {teamNotifLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
                    <div className="spinner" style={{ width: 20, height: 20 }} />
                  </div>
                ) : teamNotifEntries.length === 0 ? (
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    No team members have notification preferences configured yet.
                  </p>
                ) : (
                  <table className="data-table" style={{ fontSize: '0.8125rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Member</th>
                        <th style={{ textAlign: 'left' }}>Role</th>
                        <th style={{ textAlign: 'center' }}>Urgent Emails</th>
                        <th style={{ textAlign: 'center' }}>Digest</th>
                        <th style={{ textAlign: 'center' }}>Frequency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamNotifEntries.map(entry => (
                        <tr key={entry.user_id}>
                          <td style={{ fontWeight: 500 }}>
                            {entry.full_name || '(No name)'}
                            {entry.user_id === user?.id && (
                              <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginLeft: '0.375rem' }}>(you)</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${entry.role === 'admin' ? 'badge-teal' : entry.role === 'editor' ? 'badge-blue' : 'badge-gray'}`}
                              style={{ textTransform: 'capitalize', fontSize: '0.6875rem' }}>
                              {entry.role}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                              background: entry.email_urgent ? 'var(--green)' : '#cbd5e1',
                            }} />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                              background: entry.email_digest ? 'var(--green)' : '#cbd5e1',
                            }} />
                          </td>
                          <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                            {entry.email_digest ? (entry.digest_frequency === 'daily' ? 'Daily' : 'Weekly') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* ── Email History ──────────────────────────────────────── */}
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Mail size={16} color="var(--teal)" />
                    <h3 style={{ fontWeight: 600 }}>Email History</h3>
                    {emailLogsTotal > 0 && (
                      <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>{emailLogsTotal}</span>
                    )}
                  </div>
                  <select
                    className="input"
                    value={emailTypeFilter}
                    onChange={e => { setEmailTypeFilter(e.target.value); setEmailLogsPage(0) }}
                    style={{ width: 'auto', fontSize: '0.8125rem' }}
                  >
                    <option value="all">All Types</option>
                    <option value="urgent_alert">Urgent Alerts</option>
                    <option value="daily_digest">Daily Digest</option>
                    <option value="weekly_digest">Weekly Digest</option>
                  </select>
                </div>

                {emailLogsLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
                    <div className="spinner" style={{ width: 20, height: 20 }} />
                  </div>
                ) : emailLogs.length === 0 ? (
                  <div className="empty-state" style={{ padding: '2rem 0' }}>
                    <Mail size={24} color="var(--text-muted)" />
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                      No emails sent yet. Emails will appear here once alerts fire or digests are delivered.
                    </p>
                  </div>
                ) : (
                  <>
                    <table className="data-table" style={{ fontSize: '0.8125rem' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>Date</th>
                          <th style={{ textAlign: 'left' }}>Recipient</th>
                          <th style={{ textAlign: 'left' }}>Type</th>
                          <th style={{ textAlign: 'left' }}>Subject</th>
                          <th style={{ textAlign: 'center' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emailLogs.map(log => (
                          <tr key={log.id}>
                            <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                              {new Date(log.sent_at).toLocaleDateString()}{' '}
                              <span style={{ fontSize: '0.6875rem' }}>
                                {new Date(log.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </td>
                            <td>{log.recipient}</td>
                            <td>
                              <span className={`badge ${
                                log.email_type === 'urgent_alert' ? 'badge-red' :
                                log.email_type === 'daily_digest' ? 'badge-teal' : 'badge-blue'
                              }`} style={{ fontSize: '0.6875rem' }}>
                                {log.email_type === 'urgent_alert' ? 'Urgent' :
                                 log.email_type === 'daily_digest' ? 'Daily' : 'Weekly'}
                              </span>
                            </td>
                            <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {log.subject}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {log.status === 'sent' ? (
                                <CheckCircle size={13} color="var(--green)" />
                              ) : (
                                <span className="badge badge-red" title={log.error ?? ''} style={{ fontSize: '0.6875rem', cursor: log.error ? 'help' : 'default' }}>
                                  {log.status}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Pagination */}
                    {emailLogsTotalPages > 1 && (
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', fontSize: '0.8125rem' }}>
                        <button className="btn btn-sm btn-ghost" disabled={emailLogsPage === 0}
                          onClick={() => setEmailLogsPage(p => p - 1)}>
                          ← Prev
                        </button>
                        <span style={{ color: 'var(--text-muted)' }}>
                          Page {emailLogsPage + 1} of {emailLogsTotalPages}
                        </span>
                        <button className="btn btn-sm btn-ghost" disabled={emailLogsPage >= emailLogsTotalPages - 1}
                          onClick={() => setEmailLogsPage(p => p + 1)}>
                          Next →
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
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

            {/* ── Team Members ─────────────────────────────────────────── */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Users size={16} color="var(--teal)" />
                  <h3 style={{ fontWeight: 600 }}>Team Members</h3>
                  <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>
                    {teamMembers.length}
                  </span>
                </div>
                {isAdmin && (
                  <button className="btn btn-primary btn-sm" onClick={() => setShowInviteModal(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Plus size={13} /> Invite
                  </button>
                )}
              </div>

              {teamError && <div className="error-banner" style={{ marginBottom: '1rem' }}>{teamError}</div>}

              {teamLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
                  <div className="spinner" style={{ width: 20, height: 20 }} />
                </div>
              ) : (
                <table className="data-table" style={{ fontSize: '0.8125rem' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Name</th>
                      <th style={{ textAlign: 'left' }}>Role</th>
                      <th style={{ textAlign: 'left' }}>Joined</th>
                      {isAdmin && <th style={{ textAlign: 'right' }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {teamMembers.map(m => (
                      <tr key={m.id}>
                        <td>
                          <div style={{ fontWeight: 500 }}>
                            {m.full_name || '(No name)'}
                            {m.id === user?.id && (
                              <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginLeft: '0.375rem' }}>(you)</span>
                            )}
                          </div>
                          {m.email && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.email}</div>}
                        </td>
                        <td>
                          {isAdmin && m.id !== user?.id ? (
                            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                              <select
                                value={m.role}
                                onChange={e => handleRoleChange(m.id, e.target.value as any)}
                                style={{
                                  appearance: 'none', background: 'transparent', border: '1px solid var(--border)',
                                  borderRadius: 'var(--r-sm)', padding: '0.25rem 1.5rem 0.25rem 0.5rem',
                                  fontSize: '0.8125rem', fontWeight: 500, textTransform: 'capitalize',
                                  cursor: 'pointer', color: 'var(--text-primary)',
                                }}
                              >
                                <option value="admin">Admin</option>
                                <option value="editor">Editor</option>
                                <option value="viewer">Viewer</option>
                              </select>
                              <ChevronDown size={12} style={{ position: 'absolute', right: '0.375rem', pointerEvents: 'none', color: 'var(--text-muted)' }} />
                            </div>
                          ) : (
                            <span className={`badge ${m.role === 'admin' ? 'badge-teal' : m.role === 'editor' ? 'badge-blue' : 'badge-gray'}`}
                              style={{ textTransform: 'capitalize', fontSize: '0.6875rem' }}>
                              {m.role}
                            </span>
                          )}
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>
                          {new Date(m.created_at).toLocaleDateString()}
                        </td>
                        {isAdmin && (
                          <td style={{ textAlign: 'right' }}>
                            {m.id !== user?.id && (
                              confirmRemove === m.id ? (
                                <div style={{ display: 'inline-flex', gap: '0.375rem', alignItems: 'center' }}>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Remove?</span>
                                  <button className="btn btn-sm" onClick={() => handleRemoveMember(m.id)}
                                    style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.75rem' }}>
                                    Yes
                                  </button>
                                  <button className="btn btn-sm" onClick={() => setConfirmRemove(null)}
                                    style={{ fontSize: '0.75rem' }}>
                                    No
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="btn btn-sm btn-ghost"
                                  onClick={() => setConfirmRemove(m.id)}
                                  title="Remove member"
                                  style={{ color: 'var(--text-muted)' }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              )
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Pending Invites */}
              {isAdmin && teamInvites.length > 0 && (
                <div style={{ marginTop: '1.25rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    Pending Invites
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {teamInvites.map(inv => (
                      <div key={inv.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '0.625rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--r-sm)',
                        border: '1px solid var(--border)',
                      }}>
                        <div>
                          <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{inv.email}</div>
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                            Invited as <span style={{ textTransform: 'capitalize' }}>{inv.role}</span> · Expires {new Date(inv.expires_at).toLocaleDateString()}
                          </div>
                        </div>
                        <button className="btn btn-sm btn-ghost" onClick={() => revokeInvite(inv.id)}
                          title="Revoke invite" style={{ color: 'var(--text-muted)' }}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Invite Modal */}
            {showInviteModal && (
              <div style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', zIndex: 1000,
              }}
              onClick={e => { if (e.target === e.currentTarget) setShowInviteModal(false) }}>
                <div className="card" style={{ width: 420, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ fontWeight: 600 }}>Invite Team Member</h3>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setShowInviteModal(false); setInviteError(null) }}>
                      <X size={16} />
                    </button>
                  </div>
                  <form onSubmit={handleInvite}>
                    {inviteError && <div className="error-banner" style={{ marginBottom: '0.75rem' }}>{inviteError}</div>}
                    <label className="label">Email Address</label>
                    <input
                      className="input"
                      type="email"
                      placeholder="colleague@company.com"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      required
                      autoFocus
                      style={{ marginBottom: '0.75rem' }}
                    />
                    <label className="label">Role</label>
                    <select
                      className="input"
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value as any)}
                      style={{ marginBottom: '0.5rem' }}
                    >
                      <option value="admin">Admin — Full access, manage team</option>
                      <option value="editor">Editor — Create & modify data</option>
                      <option value="viewer">Viewer — Read-only access</option>
                    </select>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                      The invite link will be valid for 7 days. The user will need to sign up with this email address to join.
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                      <button type="button" className="btn btn-sm" onClick={() => { setShowInviteModal(false); setInviteError(null) }}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary btn-sm" disabled={inviting}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        {inviting ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Sending…</> : <><Send size={13} /> Send Invite</>}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

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
                      {parsedTotp.issuer || 'Quova'}
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
