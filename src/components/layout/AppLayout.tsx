import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useDashboardMetrics, useUploadBatches, useHedgePolicy } from '@/hooks/useData'
import { useErpConnections } from '@/hooks/useErpConnections'
import { useLiveFxRates } from '@/hooks/useLiveFxRates'
import { useEntity } from '@/context/EntityContext'
import { RatesTicker } from '@/components/RatesTicker'
import { useAlerts } from '@/hooks/useAlerts'
import { UpgradeModal } from '@/components/ui/UpgradeModal'
import { canAccess, TIER_DISPLAY, FEATURE_MIN_TIER, normalizePlan } from '@/lib/tierService'
import type { TierPlan, TierFeature } from '@/types'
import {
  LayoutDashboard, Inbox, Upload, TrendingUp, Lightbulb, Brain,
  Shield, ArrowLeftRight, Users, BarChart2, Landmark, Plug,
  Settings, LogOut, Search, X, CheckCircle2, Building2, ChevronDown, Globe, ShieldCheck,
  Lock,
} from 'lucide-react'
import { useState, useMemo, useRef, useEffect } from 'react'

type NavItem = { label: string; path: string; icon: React.FC<any>; feature?: TierFeature } | { section: string }

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',            path: '/dashboard',      icon: LayoutDashboard },
  { label: 'Inbox',                path: '/inbox',          icon: Inbox },
  { section: 'INSIGHTS' },
  { label: 'Upload',               path: '/upload',         icon: Upload },
  { label: 'Exposure',             path: '/exposure',       icon: TrendingUp },
  { label: 'Strategy & Policy',    path: '/strategy',       icon: Lightbulb,      feature: 'policy_compliance' },
  { label: 'Hedge Advisor',        path: '/advisor',        icon: Brain,           feature: 'ai_recommendations' },
  { section: 'TRADE' },
  { label: 'Hedge',                path: '/hedge',          icon: Shield,          feature: 'hedge_tracking' },
  { label: 'Trade',                path: '/trade',          icon: ArrowLeftRight,  feature: 'hedge_tracking' },
  { label: 'Counterparties',       path: '/counterparties', icon: Users,           feature: 'hedge_tracking' },
  { section: 'FLOW' },
  { label: 'Analytics & Reporting',path: '/analytics',      icon: BarChart2,       feature: 'board_reporting' },
  { label: 'Bank Accounts',        path: '/bank-accounts',  icon: Landmark },
  { label: 'Integrations',         path: '/integrations',   icon: Plug },
  { section: 'COMPLIANCE' },
  { label: 'Audit Log',            path: '/audit-log',      icon: ShieldCheck,     feature: 'audit_trail' },
]

// Flat nav labels for searching
const NAV_SEARCHABLE = NAV_ITEMS.filter((i): i is { label: string; path: string; icon: React.FC<any>; feature?: TierFeature } => 'label' in i)

export function AppLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [entityOpen, setEntityOpen] = useState(false)
  const [upgradeModal, setUpgradeModal] = useState<{ feature: string } | null>(null)
  const orgPlan = normalizePlan(user?.organisation?.plan)
  const tierInfo = TIER_DISPLAY[orgPlan] ?? TIER_DISPLAY.exposure
  const entityDropdownRef = useRef<HTMLDivElement>(null)

  const { entities, currentEntityId, setCurrentEntityId, currentEntity, isConsolidated } = useEntity()

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (entityDropdownRef.current && !entityDropdownRef.current.contains(e.target as Node)) {
        setEntityOpen(false)
      }
    }
    if (entityOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [entityOpen])

  const { unreadCount } = useAlerts()

  // Hooks for dynamic onboarding progress
  const { metrics }     = useDashboardMetrics()
  const { batches }     = useUploadBatches()
  const { policy }      = useHedgePolicy()
  const { connections } = useErpConnections()

  // Live FX rates — fetched once at layout level, available to all pages via Supabase
  const { rates: liveRates, loading: ratesLoading, error: ratesError, lastUpdated: ratesUpdated, refresh: refreshRates } = useLiveFxRates()

  // ── Onboarding steps ─────────────────────────────────────────────────────
  const steps = useMemo(() => [
    { label: 'Set hedge policy',       done: !!policy },
    { label: 'Upload exposures',       done: batches.length > 0 },
    { label: 'Add hedge position',     done: (metrics?.active_hedge_count ?? 0) > 0 },
    { label: 'Review dashboard',       done: true },
    { label: 'Connect an integration', done: connections.length > 0 },
  ], [policy, batches, metrics, connections])

  const donePct = Math.round((steps.filter(s => s.done).length / steps.length) * 100)
  const allDone = steps.every(s => s.done)

  // ── Search filter ─────────────────────────────────────────────────────────
  const searchLower = search.toLowerCase()
  const filteredNav = searchLower
    ? NAV_SEARCHABLE.filter(i => i.label.toLowerCase().includes(searchLower))
    : null  // null = show full nav

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-app)' }}>
      <nav style={{ width: 220, minWidth: 220, background: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)', display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0, overflowY: 'auto' }}>

        {/* Logo */}
        <div style={{ padding: '1rem 0.875rem 0.625rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} onClick={() => navigate('/dashboard')}>
          <QuovaLogo />
          <span style={{ color: 'var(--sidebar-text-active)', fontWeight: 700, fontSize: '1rem' }}>Quova</span>
        </div>

        {/* Entity Switcher */}
        <div ref={entityDropdownRef} style={{ padding: '0 0.625rem 0.5rem', position: 'relative' }}>
          <button
            onClick={() => setEntityOpen(o => !o)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: '0.375rem',
              padding: '0.375rem 0.5rem',
              background: entityOpen ? 'rgba(0,200,160,0.12)' : 'var(--sidebar-hover)',
              border: `1px solid ${entityOpen ? 'rgba(0,200,160,0.35)' : 'var(--sidebar-border)'}`,
              borderRadius: 'var(--r-md)', cursor: 'pointer', textAlign: 'left',
            }}
          >
            {isConsolidated
              ? <Globe size={12} color="var(--teal)" style={{ flexShrink: 0 }} />
              : <Building2 size={12} color="var(--teal)" style={{ flexShrink: 0 }} />
            }
            <span style={{ flex: 1, fontSize: '0.75rem', fontWeight: 500, color: 'var(--sidebar-text-active)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isConsolidated ? 'Consolidated' : (currentEntity?.name ?? '—')}
            </span>
            {currentEntity && (
              <span style={{ fontSize: '0.625rem', color: 'var(--teal)', fontWeight: 600, flexShrink: 0 }}>
                {currentEntity.functional_currency}
              </span>
            )}
            <ChevronDown size={10} color="#94a3b8" style={{ flexShrink: 0, transform: entityOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          </button>

          {entityOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: '0.625rem', right: '0.625rem', zIndex: 50,
              background: 'var(--sidebar-bg)', border: '1px solid var(--sidebar-border)',
              borderRadius: 'var(--r-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              overflow: 'hidden',
            }}>
              {/* Consolidated option */}
              <button
                onClick={() => { setCurrentEntityId(null); setEntityOpen(false) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.5rem 0.625rem', background: isConsolidated ? 'rgba(0,200,160,0.1)' : 'transparent',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  borderBottom: entities.length > 0 ? '1px solid var(--sidebar-border)' : 'none',
                }}
              >
                <Globe size={12} color="var(--teal)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 500, color: isConsolidated ? 'var(--teal)' : 'var(--sidebar-text-active)' }}>Consolidated</div>
                  <div style={{ fontSize: '0.625rem', color: '#64748b' }}>All entities · rolled up</div>
                </div>
                {isConsolidated && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)', flexShrink: 0 }} />}
              </button>

              {/* Individual entities */}
              {entities.map(entity => {
                const isCurrent = currentEntityId === entity.id
                return (
                  <button
                    key={entity.id}
                    onClick={() => { setCurrentEntityId(entity.id); setEntityOpen(false) }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
                      padding: '0.5rem 0.625rem', background: isCurrent ? 'rgba(0,200,160,0.1)' : 'transparent',
                      border: 'none', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <Building2 size={12} color={isCurrent ? 'var(--teal)' : '#64748b'} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 500, color: isCurrent ? 'var(--teal)' : 'var(--sidebar-text-active)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entity.name}</div>
                      <div style={{ fontSize: '0.625rem', color: '#64748b' }}>{entity.functional_currency}{entity.jurisdiction ? ` · ${entity.jurisdiction}` : ''}</div>
                    </div>
                    {isCurrent && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)', flexShrink: 0 }} />}
                  </button>
                )
              })}

              {entities.length === 0 && (
                <div style={{ padding: '0.625rem 0.75rem', fontSize: '0.6875rem', color: '#64748b' }}>
                  No entities configured — add them in Settings
                </div>
              )}
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ padding: '0 0.625rem 0.625rem' }}>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: '0.5rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--sidebar-text)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pages"
              style={{ width: '100%', padding: '0.375rem 0.5rem 0.375rem 1.75rem', background: 'var(--sidebar-hover)', border: '1px solid var(--sidebar-border)', borderRadius: 'var(--r-md)', color: 'var(--sidebar-text-active)', fontSize: '0.8125rem', outline: 'none', boxSizing: 'border-box' }} />
            {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: '0.375rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sidebar-text)', padding: 0 }}><X size={11} /></button>}
          </div>
        </div>

        {/* Nav — either search results or full grouped nav */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredNav ? (
            // Search results — flat list, no sections
            filteredNav.length === 0 ? (
              <div style={{ padding: '1rem 0.875rem', fontSize: '0.75rem', color: 'var(--sidebar-text)' }}>No pages found</div>
            ) : filteredNav.map(item => {
              const Icon = item.icon
              return (
                <NavLink key={item.path} to={item.path} onClick={() => setSearch('')}
                  style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.4rem 0.75rem', color: isActive ? '#e2e8f0' : '#94a3b8',
                    background: isActive ? 'var(--sidebar-active)' : 'transparent',
                    borderRadius: 'var(--r-md)', margin: '0.0625rem 0.375rem',
                    fontSize: '0.8125rem', fontWeight: isActive ? 500 : 400,
                    textDecoration: 'none', transition: 'all 0.15s',
                  })}>
                  <Icon size={14} />{item.label}
                  {item.path === '/inbox' && unreadCount > 0 && (
                    <span style={{
                      marginLeft: 'auto',
                      background: 'var(--red, #ef4444)',
                      color: '#fff',
                      borderRadius: '999px',
                      fontSize: '0.625rem',
                      fontWeight: 700,
                      minWidth: 16,
                      height: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 4px',
                    }}>
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </NavLink>
              )
            })
          ) : (
            // Full grouped nav
            NAV_ITEMS.map((item, i) => {
              if ('section' in item) {
                return <div key={i} style={{ padding: '0.625rem 0.875rem 0.125rem', fontSize: '0.625rem', fontWeight: 700, color: '#3a5068', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{item.section}</div>
              }
              const Icon = item.icon!
              const isLocked = item.feature ? !canAccess(orgPlan, item.feature) : false
              const minTier = item.feature ? FEATURE_MIN_TIER[item.feature] : null

              if (isLocked) {
                return (
                  <button key={item.path}
                    onClick={() => setUpgradeModal({ feature: item.label })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
                      padding: '0.4rem 0.75rem', color: '#4a5568', opacity: 0.65,
                      background: 'transparent',
                      borderRadius: 'var(--r-md)', margin: '0.0625rem 0.375rem',
                      fontSize: '0.8125rem', fontWeight: 400,
                      textDecoration: 'none', transition: 'all 0.15s',
                      border: 'none', cursor: 'pointer', textAlign: 'left',
                    }}>
                    <Icon size={14} />{item.label}
                    <span style={{
                      marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.25rem',
                      fontSize: '0.5625rem', fontWeight: 600, color: '#00C2A8', opacity: 0.8,
                      letterSpacing: '0.04em',
                    }}>
                      <Lock size={9} />
                      {minTier ? TIER_DISPLAY[minTier].badge : 'PRO'}
                    </span>
                  </button>
                )
              }

              return (
                <NavLink key={item.path} to={item.path!}
                  style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.4rem 0.75rem', color: isActive ? '#e2e8f0' : '#94a3b8',
                    background: isActive ? 'var(--sidebar-active)' : 'transparent',
                    borderRadius: 'var(--r-md)', margin: '0.0625rem 0.375rem',
                    fontSize: '0.8125rem', fontWeight: isActive ? 500 : 400,
                    textDecoration: 'none', transition: 'all 0.15s',
                  })}
                  onMouseEnter={e => { if (!e.currentTarget.getAttribute('aria-current')) (e.currentTarget as HTMLElement).style.color = '#cbd5e1' }}
                  onMouseLeave={e => { if (!e.currentTarget.getAttribute('aria-current')) (e.currentTarget as HTMLElement).style.color = '' }}>
                  <Icon size={14} />{item.label}
                  {item.path === '/inbox' && unreadCount > 0 && (
                    <span style={{
                      marginLeft: 'auto',
                      background: 'var(--red, #ef4444)',
                      color: '#fff',
                      borderRadius: '999px',
                      fontSize: '0.625rem',
                      fontWeight: 700,
                      minWidth: 16,
                      height: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 4px',
                    }}>
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </NavLink>
              )
            })
          )}
        </div>

        {/* Onboarding progress — dynamic */}
        {!allDone && (
          <div style={{ padding: '0.625rem', borderTop: '1px solid var(--sidebar-border)' }}>
            <div style={{ background: 'var(--sidebar-hover)', borderRadius: 'var(--r-md)', padding: '0.625rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                <span style={{ fontSize: '0.6875rem', color: 'var(--sidebar-text)', fontWeight: 500 }}>Onboarding</span>
                <span style={{ fontSize: '0.625rem', color: 'var(--teal)', fontWeight: 600 }}>{donePct}%</span>
              </div>
              <div style={{ height: 3, background: 'var(--sidebar-border)', borderRadius: 999, marginBottom: '0.5rem' }}>
                <div style={{ height: '100%', width: `${donePct}%`, background: 'var(--teal)', borderRadius: 999, transition: 'width 0.6s ease' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {steps.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    {s.done
                      ? <CheckCircle2 size={10} color="var(--teal)" style={{ flexShrink: 0 }} />
                      : <div style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid #3a5068', flexShrink: 0 }} />
                    }
                    <span style={{ fontSize: '0.625rem', color: s.done ? '#94a3b8' : 'var(--sidebar-text-active)', textDecoration: s.done ? 'line-through' : 'none' }}>
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tier badge + Settings + User */}
        <div style={{ borderTop: '1px solid var(--sidebar-border)' }}>
          {/* Tier badge */}
          <div style={{ padding: '0.5rem 0.875rem 0.125rem' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '0.175rem 0.5rem', borderRadius: 999,
              fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.08em',
              ...(tierInfo.badgeStyle === 'outline'
                ? { background: 'transparent', color: '#00C2A8', border: '1px solid rgba(0,194,168,0.5)' }
                : tierInfo.badgeStyle === 'solid-teal'
                  ? { background: '#00C2A8', color: '#fff', border: 'none' }
                  : { background: '#0A0F1E', color: '#fff', border: '1px solid #1e293b' }
              ),
            }}>
              {tierInfo.badge}
            </span>
          </div>
          <NavLink to="/settings" style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.875rem', color: isActive ? '#e2e8f0' : '#94a3b8', textDecoration: 'none', fontSize: '0.8125rem', background: isActive ? 'var(--sidebar-active)' : 'transparent' })}>
            <Settings size={14} /> Settings
          </NavLink>
          <div style={{ padding: '0.5rem 0.875rem 0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#fff' }}>{user?.profile?.full_name?.[0]?.toUpperCase() ?? 'U'}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 500, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.profile?.full_name ?? 'User'}</div>
              <div style={{ fontSize: '0.6875rem', color: '#94a3b8', textTransform: 'capitalize' }}>{user?.profile?.role ?? 'Member'}</div>
            </div>
            <button onClick={handleSignOut} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '0.25rem' }} title="Sign out"><LogOut size={13} /></button>
          </div>
        </div>

      </nav>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Rates ticker — only shown when authenticated */}
        {user && (
          <RatesTicker
            rates={liveRates}
            loading={ratesLoading}
            error={ratesError}
            lastUpdated={ratesUpdated}
            onRefresh={refreshRates}
          />
        )}
        <Outlet />
      </div>
      {upgradeModal && (
        <UpgradeModal
          currentTier={orgPlan}
          featureName={upgradeModal.feature}
          onClose={() => setUpgradeModal(null)}
        />
      )}
    </div>
  )
}

function QuovaLogo() {
  return (
    <img
      src="/quova-icon.png"
      alt="Quova"
      width={26}
      height={26}
      style={{ objectFit: 'contain' }}
    />
  )
}
