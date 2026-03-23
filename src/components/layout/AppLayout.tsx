import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import {
  LayoutDashboard, TrendingUp, Shield, BarChart3,
  FileText, Settings, LogOut, RefreshCw
} from 'lucide-react'

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/exposure',  icon: TrendingUp,      label: 'Exposure Ledger' },
  { to: '/hedges',    icon: Shield,          label: 'Hedge Positions' },
  { to: '/coverage',  icon: BarChart3,       label: 'Coverage Analysis' },
  { to: '/reports',   icon: FileText,        label: 'Reports' },
]

export function AppLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '0',
      }}>
        {/* Logo */}
        <div style={{
          padding: '1.25rem 1.25rem 1rem',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <OrbitLogo />
            <span style={{ fontWeight: 600, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>
              Orbit
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem', paddingLeft: '1.75rem' }}>
            {user?.organisation?.name ?? 'FX Intelligence'}
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '0.75rem 0.625rem', flex: 1 }}>
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '0.625rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--r-sm)',
                color: isActive ? 'var(--teal)' : 'var(--text-secondary)',
                background: isActive ? 'var(--teal-dim)' : 'transparent',
                fontWeight: isActive ? 500 : 400,
                fontSize: '0.875rem',
                marginBottom: '0.125rem',
                transition: 'all 0.12s',
                textDecoration: 'none',
              })}
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom */}
        <div style={{ padding: '0.75rem 0.625rem', borderTop: '1px solid var(--border)' }}>
          <NavLink
            to="/settings"
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: '0.625rem',
              padding: '0.5rem 0.75rem', borderRadius: 'var(--r-sm)',
              color: isActive ? 'var(--teal)' : 'var(--text-secondary)',
              background: isActive ? 'var(--teal-dim)' : 'transparent',
              fontSize: '0.875rem', textDecoration: 'none',
              marginBottom: '0.25rem',
            })}
          >
            <Settings size={15} />
            Settings
          </NavLink>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.5rem 0.75rem',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email}
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: '0.25rem',
                display: 'flex', borderRadius: 'var(--r-sm)',
                transition: 'color 0.12s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--bg-app)',
      }}>
        <Outlet />
      </main>
    </div>
  )
}

function OrbitLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="3.5" fill="#00c8a0" />
      <ellipse cx="11" cy="11" rx="9" ry="4.5"
        stroke="#00c8a0" strokeWidth="1.5" fill="none" opacity="0.6" />
      <ellipse cx="11" cy="11" rx="9" ry="4.5"
        stroke="#00c8a0" strokeWidth="1.5" fill="none" opacity="0.6"
        transform="rotate(60 11 11)" />
      <ellipse cx="11" cy="11" rx="9" ry="4.5"
        stroke="#00c8a0" strokeWidth="1.5" fill="none" opacity="0.6"
        transform="rotate(120 11 11)" />
    </svg>
  )
}
