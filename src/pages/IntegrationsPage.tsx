import { useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { useUploadBatches } from '@/hooks/useData'
import { useAuth } from '@/hooks/useAuth'
import { useErpConnections } from '@/hooks/useErpConnections'
import type { ErpConnection } from '@/hooks/useErpConnections'
import {
  IntegrationSetupModal,
} from '@/components/integrations/IntegrationSetupModal'
import type { ConnectorType } from '@/components/integrations/IntegrationSetupModal'
import { formatDate } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = 'apps' | 'synclog' | 'console'

interface ConnectorCatalogEntry {
  type: ConnectorType | string
  name: string
  description: string
  logo: string
  color: string
  category: 'erp' | 'tms' | 'accounting'
  comingSoon?: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BANK_TILES = [
  { name: 'BMO', abbr: 'B', color: '#c41d1d' },
  { name: 'TD', abbr: 'TD', color: '#2d8d34' },
  { name: 'CIBC', abbr: 'CI', color: '#7b1c2e' },
  { name: 'RBC', abbr: 'R', color: '#005daa' },
]

const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  // ERP
  {
    type: 'sap_s4_cloud',
    name: 'SAP S/4HANA Cloud',
    description:
      'Connect SAP S/4HANA Cloud Public Edition via OAuth 2.0. Sync AR/AP open items, purchase orders, sales orders, and exchange rates.',
    logo: 'S4',
    color: '#00aae4',
    category: 'erp',
  },
  {
    type: 'sap_s4_onprem',
    name: 'SAP S/4HANA On-Premise',
    description:
      'Connect SAP S/4HANA running on-premise or in private cloud via OData APIs. Supports direct HTTPS and SAP BTP Cloud Connector routing.',
    logo: 'S4',
    color: '#1a6496',
    category: 'erp',
  },
  {
    type: 'sap_ecc',
    name: 'SAP ECC 6.0',
    description:
      'Legacy SAP ERP Central Component. Connects via BAPI/RFC (requires SAP JCo) or HTTP/OData through SAP PI/PO or SAP Integration Suite.',
    logo: 'ECC',
    color: '#0071b9',
    category: 'erp',
  },
  {
    type: 'oracle_fusion',
    name: 'Oracle Fusion Cloud',
    description:
      'Oracle Fusion Cloud Financials. REST API integration for AR invoices, AP invoices, purchase orders, and currency rates.',
    logo: 'OF',
    color: '#c74634',
    category: 'erp',
  },
  {
    type: 'netsuite',
    name: 'NetSuite',
    description:
      'Oracle NetSuite ERP. Token-based or OAuth 2.0 authentication. Uses SuiteQL for efficient bulk extraction of foreign-currency transactions.',
    logo: 'NS',
    color: '#0066cc',
    category: 'erp',
  },
  {
    type: 'ms_dynamics',
    name: 'Microsoft Dynamics 365',
    description:
      'Dynamics 365 Finance. Connect via Dataverse REST API or OData endpoints for AR/AP and treasury data.',
    logo: 'D365',
    color: '#00a4ef',
    category: 'erp',
    comingSoon: true,
  },
  {
    type: 'workday',
    name: 'Workday',
    description:
      'Workday Financial Management. Connect via Workday REST APIs for financial exposure and cash flow data.',
    logo: 'WD',
    color: '#0052cc',
    category: 'erp',
    comingSoon: true,
  },
  // TMS
  {
    type: 'kyriba',
    name: 'Kyriba',
    description:
      'Kyriba Treasury Management System. REST API integration for FX exposures, hedge transactions, cash positions, and optional bidirectional sync.',
    logo: 'K',
    color: '#e63c3c',
    category: 'tms',
  },
  {
    type: 'ion_wallstreet',
    name: 'ION Wallstreet Suite',
    description:
      'ION Group Wallstreet Suite TMS. File/SFTP-based integration with ISO 20022 and SWIFT MT message support.',
    logo: 'ION',
    color: '#2c2c2c',
    category: 'tms',
    comingSoon: true,
  },
  {
    type: 'bloomberg_btrs',
    name: 'Bloomberg BTRS',
    description:
      'Bloomberg Treasury and Risk Solutions. SFTP file-based integration for position reports and FX exposure exports.',
    logo: 'BBG',
    color: '#ff6900',
    category: 'tms',
    comingSoon: true,
  },
  {
    type: 'fis_quantum',
    name: 'FIS Quantum',
    description:
      'FIS Treasury and Risk Manager. Cloud Edition REST API integration (2025+). Legacy on-premise via SFTP or database read.',
    logo: 'FIS',
    color: '#005eb8',
    category: 'tms',
    comingSoon: true,
  },
  // Accounting
  {
    type: 'quickbooks',
    name: 'QuickBooks Online',
    description:
      'Intuit QuickBooks Online. OAuth 2.0 integration for invoices, bills, and bank transactions in foreign currencies.',
    logo: 'QB',
    color: '#2ca01c',
    category: 'accounting',
  },
  {
    type: 'xero',
    name: 'Xero',
    description:
      'Xero accounting. OAuth 2.0 API for AR/AP, bank feeds, and foreign currency transactions.',
    logo: 'XE',
    color: '#1ab0d5',
    category: 'accounting',
    comingSoon: true,
  },
]

const CONSOLE_LOGS = [
  { time: '09:15:23', level: 'INFO', message: 'NetSuite sync started — fetching AR data from period Jun 2025' },
  { time: '09:15:28', level: 'INFO', message: '847 records fetched from NetSuite API' },
  { time: '09:15:30', level: 'INFO', message: 'Data validation passed — 847/847 records valid' },
  { time: '09:15:37', level: 'INFO', message: 'Processing exposure updates: EUR/CAD $245,000' },
  { time: '09:15:39', level: 'WARN', message: 'Currency pair GBP/JPY not in active policy — skipping 2 records' },
  { time: '09:15:41', level: 'INFO', message: '23 exposures updated, 824 unchanged' },
  { time: '09:15:47', level: 'SUCCESS', message: 'NetSuite AR Sync completed successfully in 2m 14s' },
  { time: '09:10:02', level: 'INFO', message: 'Kyriba Cash Flow sync initiated by scheduler' },
  { time: '09:10:45', level: 'WARN', message: 'Rate stale for USD/SEK — using cached rate from 2025-06-02' },
  { time: '09:11:10', level: 'SUCCESS', message: 'Kyriba Cash Flow sync completed — 312 records processed' },
]

function logLevelColor(level: string) {
  return (
    { INFO: '#64748b', WARN: '#d97706', ERROR: '#dc2626', SUCCESS: '#059669' }[level] ?? '#64748b'
  )
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─── Connector Card ───────────────────────────────────────────────────────────

interface ConnectorCardProps {
  entry: ConnectorCatalogEntry
  connections: ErpConnection[]
  canManage: boolean
  onSetup: (type: ConnectorType) => void
  onManage: (conn: ErpConnection) => void
}

function ConnectorCard({ entry, connections, canManage, onSetup, onManage }: ConnectorCardProps) {
  const matched = connections.filter(c => c.connector_type === entry.type)

  const logoFontSize =
    entry.logo.length > 3 ? '0.625rem' : entry.logo.length > 2 ? '0.6875rem' : '0.875rem'

  // Show existing connections
  const rows = matched.map(conn => (
    <div
      key={conn.id}
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--r-md)',
          background: entry.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 700,
          fontSize: logoFontSize,
          flexShrink: 0,
          letterSpacing: '-0.02em',
        }}
      >
        {entry.logo}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{conn.display_name}</span>
          <span className="badge badge-green">Connected</span>
        </div>
        <p
          style={{
            fontSize: '0.8125rem',
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.description}
        </p>
        {conn.last_synced_at && (
          <p style={{ fontSize: '0.75rem', color: 'var(--teal)', marginTop: '0.2rem' }}>
            Last synced: {formatTimeAgo(conn.last_synced_at)}
          </p>
        )}
      </div>
      <button
        className="btn btn-ghost btn-sm"
        disabled={!canManage}
        onClick={() => onManage(conn)}
      >
        Manage
      </button>
    </div>
  ))

  // Show "Add" card for this connector type if it can be set up
  const addCard = !entry.comingSoon && (
    <div
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--r-md)',
          background: entry.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 700,
          fontSize: logoFontSize,
          flexShrink: 0,
          letterSpacing: '-0.02em',
        }}
      >
        {entry.logo}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{entry.name}</span>
        </div>
        <p
          style={{
            fontSize: '0.8125rem',
            color: 'var(--text-muted)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {entry.description}
        </p>
      </div>
      {matched.length > 0 ? (
        <button
          className="btn btn-ghost btn-sm"
          disabled={!canManage}
          onClick={() => onSetup(entry.type as ConnectorType)}
          style={{ whiteSpace: 'nowrap' }}
        >
          <Plus size={13} /> Add
        </button>
      ) : (
        <button
          className="btn btn-primary btn-sm"
          disabled={!canManage}
          onClick={() => onSetup(entry.type as ConnectorType)}
        >
          Setup
        </button>
      )}
    </div>
  )

  const comingSoonCard = entry.comingSoon && (
    <div
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: 0.7 }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--r-md)',
          background: entry.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 700,
          fontSize: logoFontSize,
          flexShrink: 0,
          letterSpacing: '-0.02em',
        }}
      >
        {entry.logo}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{entry.name}</span>
          <span className="badge badge-gray">Coming Soon</span>
        </div>
        <p
          style={{
            fontSize: '0.8125rem',
            color: 'var(--text-muted)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {entry.description}
        </p>
      </div>
    </div>
  )

  return (
    <>
      {rows}
      {addCard}
      {comingSoonCard}
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function IntegrationsPage() {
  const { user } = useAuth()
  const canManage = user?.profile?.role !== 'viewer'

  const [tab, setTab] = useState<TabKey>('apps')
  const [syncingAll, setSyncingAll] = useState(false)
  const [syncedAll, setSyncedAll] = useState(false)
  const { batches, refresh: refreshBatches } = useUploadBatches()
  const { connections, upsertConnection, reload } = useErpConnections()

  const [setupModal, setSetupModal] = useState<{
    open: boolean
    connectorType: ConnectorType | null
    existing: ErpConnection | null
  }>({ open: false, connectorType: null, existing: null })

  async function handleSyncAll() {
    setSyncingAll(true)
    setSyncedAll(false)
    await refreshBatches()
    await new Promise(r => setTimeout(r, 1200))
    setSyncingAll(false)
    setSyncedAll(true)
    setTimeout(() => setSyncedAll(false), 4000)
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'apps', label: 'Apps' },
    { key: 'synclog', label: 'Sync Log' },
    { key: 'console', label: 'Console' },
  ]

  const erpConnectors = CONNECTOR_CATALOG.filter(c => c.category === 'erp')
  const tmsConnectors = CONNECTOR_CATALOG.filter(c => c.category === 'tms')
  const accountingConnectors = CONNECTOR_CATALOG.filter(c => c.category === 'accounting')

  return (
    <div className="fade-in">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Integrations
          </h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
            Connect and manage your data sources
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          {syncedAll && (
            <span style={{ fontSize: '0.8125rem', color: 'var(--green)' }}>&#10003; Synced</span>
          )}
          <button
            className="btn btn-ghost btn-sm"
            disabled={syncingAll}
            onClick={handleSyncAll}
          >
            <RefreshCw
              size={13}
              style={{ animation: syncingAll ? 'spin 1s linear infinite' : 'none' }}
            />
            {syncingAll ? 'Syncing…' : 'Sync All'}
          </button>
        </div>
      </div>

      <div style={{ padding: '1.5rem 1.5rem 0' }}>
        <div className="tab-bar">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 1.5rem 1.5rem' }}>

        {/* APPS TAB */}
        {tab === 'apps' && (
          <div>

            {/* ERP Systems */}
            <div style={{ marginBottom: '2rem' }}>
              <div className="section-label">ERP Systems</div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                {erpConnectors.map(entry => (
                  <ConnectorCard
                    key={entry.type}
                    entry={entry}
                    connections={connections}
                    canManage={canManage}
                    onSetup={type =>
                      setSetupModal({ open: true, connectorType: type, existing: null })
                    }
                    onManage={conn =>
                      setSetupModal({ open: true, connectorType: conn.connector_type as ConnectorType, existing: conn })
                    }
                  />
                ))}
              </div>
            </div>

            {/* Treasury Management Systems */}
            <div style={{ marginBottom: '2rem' }}>
              <div className="section-label">Treasury Management Systems</div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                {tmsConnectors.map(entry => (
                  <ConnectorCard
                    key={entry.type}
                    entry={entry}
                    connections={connections}
                    canManage={canManage}
                    onSetup={type =>
                      setSetupModal({ open: true, connectorType: type, existing: null })
                    }
                    onManage={conn =>
                      setSetupModal({ open: true, connectorType: conn.connector_type as ConnectorType, existing: conn })
                    }
                  />
                ))}
              </div>
            </div>

            {/* Accounting */}
            <div style={{ marginBottom: '2rem' }}>
              <div className="section-label">Accounting</div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                {accountingConnectors.map(entry => (
                  <ConnectorCard
                    key={entry.type}
                    entry={entry}
                    connections={connections}
                    canManage={canManage}
                    onSetup={type =>
                      setSetupModal({ open: true, connectorType: type, existing: null })
                    }
                    onManage={conn =>
                      setSetupModal({ open: true, connectorType: conn.connector_type as ConnectorType, existing: conn })
                    }
                  />
                ))}
              </div>
            </div>

            {/* Bank Account Integrations */}
            <div style={{ marginBottom: '2rem' }}>
              <div className="section-label">Bank Account Integrations</div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {BANK_TILES.map(bank => (
                  <div
                    key={bank.name}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.5rem',
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 'var(--r-lg)',
                        background: bank.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: '1rem',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                      }}
                    >
                      {bank.abbr}
                    </div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                      {bank.name}
                    </span>
                  </div>
                ))}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 'var(--r-lg)',
                      background: 'var(--bg-surface)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px dashed var(--border)',
                    }}
                  >
                    <Plus size={20} color="var(--text-muted)" />
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                    Add Bank
                  </span>
                </div>
              </div>
            </div>

            {/* Custom API Card */}
            <div
              style={{
                background: 'linear-gradient(135deg, #0b1526 0%, #1a2e47 100%)',
                borderRadius: 'var(--r-lg)',
                padding: '1.5rem',
                border: '1px solid #00c8a030',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: 'var(--teal)',
                      }}
                    />
                    <span style={{ color: '#e2e8f0', fontWeight: 700 }}>
                      Custom API Integration
                    </span>
                  </div>
                  <p style={{ color: '#94a3b8', fontSize: '0.8125rem' }}>
                    Build your own integration using the Orbit REST API. Access real-time exposure
                    data, hedge positions, and analytics programmatically.
                  </p>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ flexShrink: 0 }}
                >
                  Setup API
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SYNC LOG TAB */}
        {tab === 'synclog' && (
          <div className="card" style={{ padding: 0 }}>
            <div
              style={{
                padding: '1rem 1.25rem',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Sync Log</span>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--teal)',
                }}
                onClick={() => refreshBatches()}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {batches.length === 0 ? (
              <div className="empty-state" style={{ padding: '3rem' }}>
                <RefreshCw size={28} />
                <p>No uploads yet. Upload a CSV file to see sync history here.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>File</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th className="text-right">Records</th>
                    <th>Batch ID</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b, i) => (
                    <tr key={i}>
                      <td
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '0.8125rem',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatDate(b.created_at)}
                      </td>
                      <td
                        style={{
                          fontWeight: 500,
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {b.filename}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                        CSV Import
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            b.status === 'complete'
                              ? 'badge-green'
                              : b.status === 'failed'
                              ? 'badge-red'
                              : 'badge-teal'
                          }`}
                        >
                          {b.status === 'complete'
                            ? 'Complete'
                            : b.status === 'failed'
                            ? 'Failed'
                            : 'Processing'}
                        </span>
                      </td>
                      <td
                        className="text-right"
                        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
                      >
                        {b.row_count.toLocaleString()}
                      </td>
                      <td
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {b.id.slice(0, 8).toUpperCase()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* CONSOLE TAB */}
        {tab === 'console' && (
          <div>
            <div
              style={{
                background: '#0b1526',
                borderRadius: 'var(--r-lg)',
                padding: '1rem',
                border: '1px solid #1a2e47',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8125rem',
                maxHeight: 500,
                overflowY: 'auto',
              }}
            >
              <div style={{ color: '#94a3b8', marginBottom: '0.75rem', fontSize: '0.75rem' }}>
                Orbit Integration Console —{' '}
                {new Date().toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
              {CONSOLE_LOGS.map((log, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: '1rem',
                    marginBottom: '0.25rem',
                    alignItems: 'baseline',
                  }}
                >
                  <span style={{ color: '#475569', flexShrink: 0 }}>{log.time}</span>
                  <span
                    style={{
                      color: logLevelColor(log.level),
                      fontWeight: 700,
                      flexShrink: 0,
                      minWidth: 60,
                    }}
                  >
                    [{log.level}]
                  </span>
                  <span style={{ color: '#cbd5e1' }}>{log.message}</span>
                </div>
              ))}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginTop: '0.75rem',
                }}
              >
                <span style={{ color: '#94a3b8' }}>$</span>
                <span
                  style={{
                    color: '#e2e8f0',
                    borderRight: '2px solid var(--teal)',
                    paddingRight: '2px',
                    animation: 'blink 1s infinite',
                  }}
                >
                  &nbsp;
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Setup Modal */}
      {setupModal.open && setupModal.connectorType && (
        <IntegrationSetupModal
          connectorType={setupModal.connectorType}
          existing={setupModal.existing}
          onClose={() => setSetupModal({ open: false, connectorType: null, existing: null })}
          onSaved={() => {
            reload()
            setSetupModal({ open: false, connectorType: null, existing: null })
          }}
          upsertConnection={upsertConnection}
        />
      )}
    </div>
  )
}
