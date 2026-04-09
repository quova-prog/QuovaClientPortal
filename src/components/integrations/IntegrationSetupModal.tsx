import React, { useState, useEffect } from 'react'
import {
  Check,
  X,
  ChevronRight,
  Eye,
  EyeOff,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import type { ErpConnection, ErpConnectionUpsert } from '../../hooks/useErpConnections'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectorType =
  | 'sap_s4_cloud'
  | 'sap_s4_onprem'
  | 'sap_ecc'
  | 'oracle_fusion'
  | 'netsuite'
  | 'kyriba'
  | 'quickbooks'

interface WizardField {
  key: string
  label: string
  type: 'text' | 'password' | 'url' | 'select' | 'radio' | 'checkbox_group' | 'oauth_button'
  placeholder?: string
  hint?: string
  required?: boolean
  options?: { value: string; label: string; description?: string }[]
  showWhen?: { key: string; values: string[] }
}

interface ScopeOption {
  value: string
  label: string
  description: string
  defaultChecked: boolean
}

type Step = 'configure' | 'test' | 'scope' | 'done'

interface Props {
  connectorType: ConnectorType
  existing?: ErpConnection | null
  onClose: () => void
  onSaved: () => void
  upsertConnection: (payload: ErpConnectionUpsert) => Promise<void>
}

// ─── Connector Configs ────────────────────────────────────────────────────────

const PASSWORD_FIELDS = new Set([
  'client_secret',
  'password',
  'consumer_secret',
  'token_secret',
  'oauth_client_secret',
])

interface ConnectorConfig {
  name: string
  logo: string
  color: string
  authFields: WizardField[]
  scopeOptions: ScopeOption[]
  testDetail: string
}

const DEFAULT_CHECKED: Record<string, boolean> = {
  ar: true,
  ap: true,
  po: true,
  so: false,
  gl: false,
  fx_rates: true,
  hedges: true,
  cash: false,
  exposures: true,
}

const CONNECTOR_CONFIGS: Record<ConnectorType, ConnectorConfig> = {
  sap_s4_cloud: {
    name: 'SAP S/4HANA Cloud',
    logo: 'S4',
    color: '#00aae4',
    testDetail:
      'Company: Quova Demo GmbH · Release: SAP S/4HANA 2023 FPS02 · 12 company codes available',
    authFields: [
      {
        key: 'host_url',
        label: 'Instance URL',
        type: 'url',
        placeholder: 'https://your-tenant.s4hana.ondemand.com',
        hint: 'Your SAP S/4HANA Cloud tenant URL from BTP Cockpit',
        required: true,
      },
      {
        key: 'token_url',
        label: 'OAuth Token URL',
        type: 'url',
        placeholder:
          'https://your-subaccount.authentication.eu10.hana.ondemand.com/oauth/token',
        hint: 'OAuth token endpoint from your SAP BTP service key',
        required: true,
      },
      {
        key: 'client_id',
        label: 'Client ID',
        type: 'text',
        hint: 'OAuth client ID from the BTP XSUAA service binding',
        required: true,
      },
      {
        key: 'client_secret',
        label: 'Client Secret',
        type: 'password',
        required: true,
      },
    ],
    scopeOptions: [
      { value: 'ar', label: 'AR Open Items', description: 'Real-time open receivables in foreign currencies (API_OPLACCTGDOCITEMGL_SRV)', defaultChecked: DEFAULT_CHECKED.ar },
      { value: 'ap', label: 'AP Open Items', description: 'Open payables in foreign currencies', defaultChecked: DEFAULT_CHECKED.ap },
      { value: 'po', label: 'Purchase Orders', description: 'Open POs in non-functional currencies (API_PURCHASEORDER_PROCESS_SRV)', defaultChecked: DEFAULT_CHECKED.po },
      { value: 'so', label: 'Sales Orders', description: 'Open SOs in foreign currencies (API_SALES_ORDER_SRV)', defaultChecked: DEFAULT_CHECKED.so },
      { value: 'gl', label: 'General Ledger', description: 'Universal Journal entries with full multi-currency detail (ACDOCA)', defaultChecked: DEFAULT_CHECKED.gl },
      { value: 'fx_rates', label: 'Exchange Rates', description: 'SAP rate table TCURR for mark-to-market valuation', defaultChecked: DEFAULT_CHECKED.fx_rates },
    ],
  },
  sap_s4_onprem: {
    name: 'SAP S/4HANA On-Premise',
    logo: 'S4',
    color: '#1a6496',
    testDetail: 'System: PRD · Release: 756 (ABAP 7.56) · 8 company codes available',
    authFields: [
      {
        key: 'connection_method',
        label: 'Connection Method',
        type: 'radio',
        required: true,
        options: [
          { value: 'direct', label: 'Direct HTTPS', description: 'Direct connection to SAP host (requires network access)' },
          { value: 'cloud_connector', label: 'SAP BTP Cloud Connector', description: 'Route through SAP Cloud Connector agent (recommended for on-premise behind firewall)' },
        ],
      },
      {
        key: 'host_url',
        label: 'SAP Host URL',
        type: 'url',
        placeholder: 'https://sap-server.internal:8443',
        hint: 'HTTPS base URL of your SAP NetWeaver server',
        required: true,
      },
      {
        key: 'system_id',
        label: 'System ID (SID)',
        type: 'text',
        placeholder: 'PRD',
        hint: '3-character SAP system identifier, e.g. PRD, QAS, DEV',
        required: true,
      },
      {
        key: 'client_number',
        label: 'Client Number',
        type: 'text',
        placeholder: '100',
        hint: 'SAP client / mandant number (typically 3 digits)',
        required: true,
      },
      {
        key: 'auth_method',
        label: 'Authentication',
        type: 'radio',
        options: [
          { value: 'basic', label: 'Basic Authentication', description: 'Username + password (service user)' },
          { value: 'oauth', label: 'OAuth 2.0', description: 'Requires SAP API Management or compatible OAuth server' },
        ],
      },
      {
        key: 'username',
        label: 'Service User',
        type: 'text',
        hint: 'Dedicated SAP service user with read-only role',
        showWhen: { key: 'auth_method', values: ['basic', ''] },
      },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        showWhen: { key: 'auth_method', values: ['basic', ''] },
      },
      {
        key: 'oauth_client_id',
        label: 'OAuth Client ID',
        type: 'text',
        showWhen: { key: 'auth_method', values: ['oauth'] },
      },
      {
        key: 'oauth_client_secret',
        label: 'OAuth Client Secret',
        type: 'password',
        showWhen: { key: 'auth_method', values: ['oauth'] },
      },
      {
        key: 'oauth_token_url',
        label: 'OAuth Token URL',
        type: 'url',
        showWhen: { key: 'auth_method', values: ['oauth'] },
      },
    ],
    scopeOptions: [
      { value: 'ar', label: 'AR Open Items', description: 'Real-time open receivables in foreign currencies (API_OPLACCTGDOCITEMGL_SRV)', defaultChecked: DEFAULT_CHECKED.ar },
      { value: 'ap', label: 'AP Open Items', description: 'Open payables in foreign currencies', defaultChecked: DEFAULT_CHECKED.ap },
      { value: 'po', label: 'Purchase Orders', description: 'Open POs in non-functional currencies (API_PURCHASEORDER_PROCESS_SRV)', defaultChecked: DEFAULT_CHECKED.po },
      { value: 'so', label: 'Sales Orders', description: 'Open SOs in foreign currencies (API_SALES_ORDER_SRV)', defaultChecked: DEFAULT_CHECKED.so },
      { value: 'gl', label: 'General Ledger', description: 'Universal Journal entries with full multi-currency detail (ACDOCA)', defaultChecked: DEFAULT_CHECKED.gl },
      { value: 'fx_rates', label: 'Exchange Rates', description: 'SAP rate table TCURR for mark-to-market valuation', defaultChecked: DEFAULT_CHECKED.fx_rates },
    ],
  },
  sap_ecc: {
    name: 'SAP ECC 6.0',
    logo: 'ECC',
    color: '#0071b9',
    testDetail: 'System: ECC · Release: 6.0 EHP8 · 5 company codes available',
    authFields: [
      {
        key: 'host_url',
        label: 'SAP ECC Host URL',
        type: 'url',
        placeholder: 'https://ecc-server.internal:8443',
        required: true,
      },
      {
        key: 'system_id',
        label: 'System ID (SID)',
        type: 'text',
        placeholder: 'ECC',
      },
      {
        key: 'client_number',
        label: 'Client Number',
        type: 'text',
        placeholder: '100',
        required: true,
      },
      {
        key: 'username',
        label: 'Service User',
        type: 'text',
        hint: 'RFC-enabled service user. Required role: S_RFC, plus read access to BAPI function groups.',
        required: true,
      },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        required: true,
      },
      {
        key: 'rfc_system_number',
        label: 'RFC System Number',
        type: 'text',
        placeholder: '00',
        hint: 'Instance number for RFC/JCo connections (00-99). Leave blank if using only HTTP/OData.',
      },
    ],
    scopeOptions: [
      { value: 'ar', label: 'AR Open Items', description: 'Real-time open receivables in foreign currencies (API_OPLACCTGDOCITEMGL_SRV)', defaultChecked: DEFAULT_CHECKED.ar },
      { value: 'ap', label: 'AP Open Items', description: 'Open payables in foreign currencies', defaultChecked: DEFAULT_CHECKED.ap },
      { value: 'po', label: 'Purchase Orders', description: 'Open POs in non-functional currencies (API_PURCHASEORDER_PROCESS_SRV)', defaultChecked: DEFAULT_CHECKED.po },
      { value: 'so', label: 'Sales Orders', description: 'Open SOs in foreign currencies (API_SALES_ORDER_SRV)', defaultChecked: DEFAULT_CHECKED.so },
      { value: 'gl', label: 'General Ledger', description: 'Universal Journal entries with full multi-currency detail (ACDOCA)', defaultChecked: DEFAULT_CHECKED.gl },
      { value: 'fx_rates', label: 'Exchange Rates', description: 'SAP rate table TCURR for mark-to-market valuation', defaultChecked: DEFAULT_CHECKED.fx_rates },
    ],
  },
  oracle_fusion: {
    name: 'Oracle Fusion Cloud',
    logo: 'OF',
    color: '#c74634',
    testDetail: 'Instance: Oracle Fusion 24D · 3 business units · Ledger: USD Ledger',
    authFields: [
      {
        key: 'host_url',
        label: 'Oracle Fusion Host URL',
        type: 'url',
        placeholder: 'https://your-company.fa.us2.oraclecloud.com',
        hint: 'Your Oracle Fusion Cloud instance URL',
        required: true,
      },
      {
        key: 'identity_domain_url',
        label: 'Identity Domain (IDCS) URL',
        type: 'url',
        placeholder: 'https://your-idcs.identity.oraclecloud.com',
        hint: 'Oracle Identity Cloud Service / Identity Domain URL — found in Oracle Cloud Console',
        required: true,
      },
      {
        key: 'client_id',
        label: 'Client ID',
        type: 'text',
        hint: 'Application Client ID from Oracle Identity Domain console',
        required: true,
      },
      {
        key: 'client_secret',
        label: 'Client Secret',
        type: 'password',
        required: true,
      },
    ],
    scopeOptions: [
      { value: 'ar', label: 'AR Invoices', description: 'Open receivables invoices (/receivablesInvoices)', defaultChecked: DEFAULT_CHECKED.ar },
      { value: 'ap', label: 'AP Invoices', description: 'Open payables invoices (/invoices)', defaultChecked: DEFAULT_CHECKED.ap },
      { value: 'po', label: 'Purchase Orders', description: 'Open purchase orders (/purchaseOrders)', defaultChecked: DEFAULT_CHECKED.po },
      { value: 'fx_rates', label: 'Currency Rates', description: 'Exchange rates from Oracle (/currencyRates)', defaultChecked: DEFAULT_CHECKED.fx_rates },
      { value: 'hedges', label: 'Treasury Deals', description: 'Oracle Treasury FX deals (if Treasury module is active)', defaultChecked: DEFAULT_CHECKED.hedges },
    ],
  },
  netsuite: {
    name: 'NetSuite',
    logo: 'NS',
    color: '#0066cc',
    testDetail:
      'Account: Quova Demo LLC · 4 subsidiaries · SuiteQL governance: 15 concurrent',
    authFields: [
      {
        key: 'account_id',
        label: 'Account ID',
        type: 'text',
        placeholder: '1234567',
        hint: 'Your NetSuite account number. Found in Setup → Company → Company Information.',
        required: true,
      },
      {
        key: 'is_sandbox',
        label: 'Environment',
        type: 'radio',
        options: [
          { value: 'false', label: 'Production' },
          { value: 'true', label: 'Sandbox' },
        ],
      },
      {
        key: 'auth_method',
        label: 'Authentication Method',
        type: 'radio',
        required: true,
        options: [
          { value: 'tba', label: 'Token-Based Auth (TBA)', description: 'HMAC-SHA256 signed requests — best for server-to-server' },
          { value: 'oauth2', label: 'OAuth 2.0', description: 'Authorization Code flow — requires one-time browser authorization' },
        ],
      },
      {
        key: 'consumer_key',
        label: 'Consumer Key',
        type: 'text',
        hint: 'From Integration Record in NetSuite',
        showWhen: { key: 'auth_method', values: ['tba'] },
      },
      {
        key: 'consumer_secret',
        label: 'Consumer Secret',
        type: 'password',
        showWhen: { key: 'auth_method', values: ['tba'] },
      },
      {
        key: 'token_id',
        label: 'Token ID',
        type: 'text',
        hint: 'From Setup → Users/Roles → Access Tokens',
        showWhen: { key: 'auth_method', values: ['tba'] },
      },
      {
        key: 'token_secret',
        label: 'Token Secret',
        type: 'password',
        showWhen: { key: 'auth_method', values: ['tba'] },
      },
      {
        key: 'oauth_client_id',
        label: 'Client ID',
        type: 'text',
        hint: 'From Integration Record — OAuth 2.0 section',
        showWhen: { key: 'auth_method', values: ['oauth2'] },
      },
      {
        key: 'oauth_client_secret',
        label: 'Client Secret',
        type: 'password',
        showWhen: { key: 'auth_method', values: ['oauth2'] },
      },
    ],
    scopeOptions: [
      { value: 'ar', label: 'Invoices (AR)', description: 'Open customer invoices in foreign currencies (SuiteQL: transaction type=invoice)', defaultChecked: DEFAULT_CHECKED.ar },
      { value: 'ap', label: 'Vendor Bills (AP)', description: 'Open vendor bills (SuiteQL: type=vendorbill)', defaultChecked: DEFAULT_CHECKED.ap },
      { value: 'po', label: 'Purchase Orders', description: 'Open purchase orders', defaultChecked: DEFAULT_CHECKED.po },
      { value: 'so', label: 'Sales Orders', description: 'Open sales orders', defaultChecked: DEFAULT_CHECKED.so },
      { value: 'fx_rates', label: 'Currency Rates', description: 'NetSuite currency rate table', defaultChecked: DEFAULT_CHECKED.fx_rates },
    ],
  },
  kyriba: {
    name: 'Kyriba',
    logo: 'K',
    color: '#e63c3c',
    testDetail:
      'Environment: Production · 6 entities · Last position update: today 09:15',
    authFields: [
      {
        key: 'environment',
        label: 'Environment',
        type: 'radio',
        options: [
          { value: 'production', label: 'Production', description: 'https://api.kyriba.com' },
          { value: 'sandbox', label: 'Sandbox / Demo', description: 'https://api.kyribastage.com' },
        ],
      },
      {
        key: 'client_id',
        label: 'Client ID',
        type: 'text',
        hint: 'OAuth Client ID from Kyriba Administration → API Configuration',
        required: true,
      },
      {
        key: 'client_secret',
        label: 'Client Secret',
        type: 'password',
        required: true,
      },
      {
        key: 'sync_direction',
        label: 'Sync Direction',
        type: 'radio',
        options: [
          { value: 'read', label: 'Read-only', description: 'Import FX exposures, hedge positions, cash data into Quova' },
          { value: 'bidirectional', label: 'Bidirectional', description: 'Also write Quova hedge recommendations back to Kyriba as deals' },
        ],
      },
    ],
    scopeOptions: [
      { value: 'exposures', label: 'FX Exposures', description: 'Aggregated FX exposure positions from Kyriba (/v1/fx/exposures)', defaultChecked: DEFAULT_CHECKED.exposures },
      { value: 'hedges', label: 'Hedge Transactions', description: 'FX forwards, options, swaps (/v1/hedges)', defaultChecked: DEFAULT_CHECKED.hedges },
      { value: 'cash', label: 'Cash Positions', description: 'Bank account balances by currency (/v1/cashpositions)', defaultChecked: DEFAULT_CHECKED.cash },
      { value: 'ar', label: 'Transactions', description: 'Foreign currency cash transactions (/v1/transactions)', defaultChecked: DEFAULT_CHECKED.ar },
    ],
  },
  quickbooks: {
    name: 'QuickBooks Online',
    logo: 'QB',
    color: '#2ca01c',
    testDetail: 'Company: Quova Demo Company · Country: US · Fiscal year: January',
    authFields: [
      {
        key: 'realm_id',
        label: 'Realm ID',
        type: 'text',
        hint: 'Your QuickBooks company/realm ID (auto-populated after OAuth)',
      },
      {
        key: 'oauth_button',
        label: 'Connect with QuickBooks',
        type: 'oauth_button',
      },
    ],
    scopeOptions: [
      { value: 'ar', label: 'Invoices', description: 'Customer invoices in foreign currencies', defaultChecked: DEFAULT_CHECKED.ar },
      { value: 'ap', label: 'Bills', description: 'Vendor bills in foreign currencies', defaultChecked: DEFAULT_CHECKED.ap },
      { value: 'cash', label: 'Bank Transactions', description: 'Bank account transactions', defaultChecked: DEFAULT_CHECKED.cash },
    ],
  },
}

const SYNC_FREQUENCIES = [
  { value: '15min', label: 'Every 15 minutes' },
  { value: 'hourly', label: 'Every hour' },
  { value: '4hour', label: 'Every 4 hours' },
  { value: 'daily', label: 'Daily (overnight)' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidUrl(val: string): boolean {
  try {
    new URL(val)
    return true
  } catch {
    return false
  }
}

function fieldVisible(field: WizardField, form: Record<string, string>): boolean {
  if (!field.showWhen) return true
  const val = form[field.showWhen.key] ?? ''
  return field.showWhen.values.includes(val)
}

function requiredFilled(fields: WizardField[], form: Record<string, string>): boolean {
  return fields
    .filter(f => f.required && fieldVisible(f, form))
    .every(f => {
      const v = form[f.key] ?? ''
      if (f.type === 'url') return isValidUrl(v)
      return v.trim().length > 0
    })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: WizardField
  value: string
  onChange: (val: string) => void
}) {
  const [showPw, setShowPw] = useState(false)

  if (field.type === 'radio') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {(field.options ?? []).map(opt => (
          <label
            key={opt.value}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.625rem',
              padding: '0.625rem 0.75rem',
              border: `1px solid ${value === opt.value ? 'var(--teal)' : 'var(--border)'}`,
              borderRadius: 'var(--r-md)',
              cursor: 'pointer',
              background: value === opt.value ? 'var(--teal-dim)' : 'var(--bg-surface)',
              transition: 'all 0.15s',
            }}
          >
            <input
              type="radio"
              name={field.key}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              style={{ marginTop: '0.15rem', accentColor: 'var(--teal)', flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                {opt.label}
              </div>
              {opt.description && (
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                  {opt.description}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>
    )
  }

  if (field.type === 'oauth_button') {
    return (
      <button
        type="button"
        className="btn btn-primary"
        style={{ width: '100%', justifyContent: 'center' }}
        onClick={() => {
          // In production this would open an OAuth popup
          alert('OAuth flow would open here in production.')
        }}
      >
        Connect with QuickBooks
      </button>
    )
  }

  if (field.type === 'password') {
    return (
      <div style={{ position: 'relative' }}>
        <input
          className="input"
          type={showPw ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder ?? ''}
          style={{ paddingRight: '2.5rem' }}
        />
        <button
          type="button"
          onClick={() => setShowPw(p => !p)}
          style={{
            position: 'absolute',
            right: '0.625rem',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label={showPw ? 'Hide' : 'Show'}
        >
          {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    )
  }

  return (
    <input
      className="input"
      type={field.type === 'url' ? 'url' : 'text'}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={field.placeholder ?? ''}
    />
  )
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

const STEPS: { key: Step; label: string }[] = [
  { key: 'configure', label: 'Configure' },
  { key: 'test', label: 'Test' },
  { key: 'scope', label: 'Scope' },
  { key: 'done', label: 'Done' },
]

function StepIndicator({ current }: { current: Step }) {
  const currentIdx = STEPS.findIndex(s => s.key === current)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0',
        padding: '0.875rem 1.5rem',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)',
      }}
    >
      {STEPS.map((s, i) => {
        const isDone = i < currentIdx
        const isActive = i === currentIdx
        return (
          <React.Fragment key={s.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background: isDone ? 'var(--green)' : isActive ? 'var(--teal)' : 'var(--bg-card)',
                  border: `2px solid ${isDone ? 'var(--green)' : isActive ? 'var(--teal)' : 'var(--border)'}`,
                  color: isDone || isActive ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.2s',
                  flexShrink: 0,
                }}
              >
                {isDone ? <Check size={12} /> : i + 1}
              </div>
              <span
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--text-primary)' : isDone ? 'var(--green)' : 'var(--text-muted)',
                }}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: i < currentIdx ? 'var(--green)' : 'var(--border)',
                  margin: '0 0.5rem',
                  transition: 'background 0.2s',
                }}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function IntegrationSetupModal({
  connectorType,
  existing,
  onClose,
  onSaved,
  upsertConnection,
}: Props) {
  const cfg = CONNECTOR_CONFIGS[connectorType]

  // Initialise form from existing connection config
  const initForm = (): Record<string, string> => {
    if (!existing) return {}
    const out: Record<string, string> = {}
    const config = existing.config as Record<string, string>
    cfg.authFields.forEach(f => {
      if (config[f.key] !== undefined) out[f.key] = String(config[f.key])
    })
    return out
  }

  const initModules = (): Set<string> => {
    if (existing?.sync_modules?.length) return new Set(existing.sync_modules)
    return new Set(cfg.scopeOptions.filter(s => s.defaultChecked).map(s => s.value))
  }

  const [step, setStep] = useState<Step>('configure')
  const [form, setForm] = useState<Record<string, string>>(initForm)
  const [selectedModules, setSelectedModules] = useState<Set<string>>(initModules)
  const [frequency, setFrequency] = useState(existing?.sync_frequency ?? 'hourly')
  const [displayName, setDisplayName] = useState(existing?.display_name ?? `${cfg.name} — Primary`)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testDetail, setTestDetail] = useState('')
  const [saving, setSaving] = useState(false)

  // Run test when entering test step
  useEffect(() => {
    if (step !== 'test') return
    simulateTest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  function setField(key: string, val: string) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  function toggleModule(val: string) {
    setSelectedModules(prev => {
      const next = new Set(prev)
      if (next.has(val)) next.delete(val)
      else next.add(val)
      return next
    })
  }

  async function simulateTest() {
    setTestStatus('testing')
    setTestDetail('')

    await new Promise(r => setTimeout(r, 1800))

    // Validate: check that url-type required fields are valid URLs
    const urlFieldsOk = cfg.authFields
      .filter(f => f.type === 'url' && f.required && fieldVisible(f, form))
      .every(f => isValidUrl(form[f.key] ?? ''))

    const textFieldsOk = cfg.authFields
      .filter(f => f.type === 'text' && f.required && fieldVisible(f, form))
      .every(f => (form[f.key] ?? '').trim().length > 0)

    if (urlFieldsOk && textFieldsOk) {
      setTestStatus('success')
      setTestDetail(cfg.testDetail)
    } else {
      setTestStatus('error')
      const badField = cfg.authFields.find(
        f =>
          f.required &&
          fieldVisible(f, form) &&
          (f.type === 'url'
            ? !isValidUrl(form[f.key] ?? '')
            : (form[f.key] ?? '').trim().length === 0)
      )
      setTestDetail(
        badField
          ? `Validation failed: "${badField.label}" is missing or invalid.`
          : 'Could not reach the configured host. Please check the URL and credentials.'
      )
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      // Strip password fields from config
      const config: Record<string, string> = {}
      cfg.authFields.forEach(f => {
        if (!PASSWORD_FIELDS.has(f.key) && f.type !== 'oauth_button') {
          const v = form[f.key]
          if (v !== undefined) config[f.key] = v
        }
      })

      const hasCredentials = cfg.authFields.some(
        f =>
          PASSWORD_FIELDS.has(f.key) &&
          fieldVisible(f, form) &&
          (form[f.key] ?? '').trim().length > 0
      )

      const payload: ErpConnectionUpsert = {
        ...(existing?.id ? { id: existing.id } : {}),
        connector_type: connectorType,
        display_name: displayName,
        status: 'connected',
        config,
        credentials_set: hasCredentials || (existing?.credentials_set ?? false),
        sync_modules: Array.from(selectedModules),
        sync_frequency: frequency,
        last_synced_at: existing?.last_synced_at ?? null,
        last_sync_status: existing?.last_sync_status ?? null,
        last_sync_count: existing?.last_sync_count ?? null,
        last_error: null,
      }

      await upsertConnection(payload)
      setStep('done')
    } finally {
      setSaving(false)
    }
  }

  const canProceedConfigure = requiredFilled(cfg.authFields, form) && displayName.trim().length > 0

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--r-xl)',
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.875rem',
            padding: '1.125rem 1.5rem',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 'var(--r-md)',
              background: cfg.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: cfg.logo.length > 2 ? '0.7rem' : '0.875rem',
              flexShrink: 0,
              letterSpacing: '-0.02em',
            }}
          >
            {cfg.logo}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
              {existing ? 'Edit' : 'Connect'} {cfg.name}
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              Integration setup wizard
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            style={{ padding: '0.25rem 0.5rem' }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} />

        {/* Body */}
        <div style={{ padding: '1.5rem', flex: 1 }}>
          {/* ── CONFIGURE ── */}
          {step === 'configure' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.125rem' }}>
              {/* Display name */}
              <div>
                <label className="label">Connection Name</label>
                <input
                  className="input"
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="e.g. SAP S/4HANA — EMEA"
                />
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.375rem' }}>
                  A friendly label for this integration, e.g. &apos;SAP S/4HANA — EMEA&apos;
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--border)' }} />

              {/* Auth fields */}
              {cfg.authFields.map(field => {
                if (!fieldVisible(field, form)) return null
                if (field.type === 'oauth_button') {
                  return (
                    <div key={field.key}>
                      <FieldRenderer
                        field={field}
                        value={form[field.key] ?? ''}
                        onChange={v => setField(field.key, v)}
                      />
                    </div>
                  )
                }
                return (
                  <div key={field.key}>
                    <label className="label">
                      {field.label}
                      {field.required && (
                        <span style={{ color: 'var(--red)', marginLeft: '0.25rem' }}>*</span>
                      )}
                    </label>
                    <FieldRenderer
                      field={field}
                      value={form[field.key] ?? ''}
                      onChange={v => setField(field.key, v)}
                    />
                    {field.hint && (
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.375rem' }}>
                        {field.hint}
                      </div>
                    )}
                  </div>
                )
              })}

              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.5rem' }}>
                <button
                  className="btn btn-primary"
                  disabled={!canProceedConfigure}
                  onClick={() => setStep('test')}
                >
                  Test Connection <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── TEST ── */}
          {step === 'test' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: '0.875rem 1rem',
                  fontSize: '0.8125rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ fontWeight: 500 }}>Verifying credentials with {cfg.name}</span>
                {form.host_url && (
                  <span style={{ color: 'var(--text-muted)' }}> at {form.host_url}</span>
                )}
              </div>

              <div
                style={{
                  minHeight: 100,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.75rem',
                  padding: '1.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  background: testStatus === 'success'
                    ? 'var(--green-bg)'
                    : testStatus === 'error'
                    ? 'var(--red-bg)'
                    : 'var(--bg-surface)',
                  transition: 'background 0.2s',
                }}
              >
                {testStatus === 'testing' && (
                  <>
                    <Loader2 size={28} style={{ color: 'var(--teal)', animation: 'spin 1s linear infinite' }} />
                    <span style={{ fontSize: '0.9375rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                      Testing connection…
                    </span>
                  </>
                )}
                {testStatus === 'success' && (
                  <>
                    <CheckCircle2 size={32} style={{ color: 'var(--green)' }} />
                    <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--green)' }}>
                      Connection successful
                    </span>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                      {testDetail}
                    </span>
                  </>
                )}
                {testStatus === 'error' && (
                  <>
                    <AlertCircle size={32} style={{ color: 'var(--red)' }} />
                    <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--red)' }}>
                      Connection failed
                    </span>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                      {testDetail}
                    </span>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                {testStatus === 'error' ? (
                  <button className="btn btn-ghost" onClick={() => setStep('configure')}>
                    Re-check Configuration
                  </button>
                ) : (
                  <button className="btn btn-ghost" onClick={() => setStep('configure')}>
                    Back
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  disabled={testStatus !== 'success'}
                  onClick={() => setStep('scope')}
                >
                  Continue to Scope <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── SCOPE ── */}
          {step === 'scope' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Data Modules */}
              <div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted)',
                    marginBottom: '0.75rem',
                  }}
                >
                  Data Modules
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {cfg.scopeOptions.map(opt => {
                    const checked = selectedModules.has(opt.value)
                    return (
                      <label
                        key={opt.value}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.625rem',
                          padding: '0.625rem 0.75rem',
                          border: `1px solid ${checked ? 'var(--teal)' : 'var(--border)'}`,
                          borderRadius: 'var(--r-md)',
                          cursor: 'pointer',
                          background: checked ? 'var(--teal-dim)' : 'var(--bg-surface)',
                          transition: 'all 0.15s',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleModule(opt.value)}
                          style={{ marginTop: '0.15rem', accentColor: 'var(--teal)', flexShrink: 0 }}
                        />
                        <div>
                          <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                            {opt.label}
                          </div>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                            {opt.description}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Sync Frequency */}
              <div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted)',
                    marginBottom: '0.75rem',
                  }}
                >
                  Sync Frequency
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {SYNC_FREQUENCIES.map(f => (
                    <label
                      key={f.value}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.625rem',
                        padding: '0.5625rem 0.75rem',
                        border: `1px solid ${frequency === f.value ? 'var(--teal)' : 'var(--border)'}`,
                        borderRadius: 'var(--r-md)',
                        cursor: 'pointer',
                        background: frequency === f.value ? 'var(--teal-dim)' : 'var(--bg-surface)',
                        transition: 'all 0.15s',
                      }}
                    >
                      <input
                        type="radio"
                        name="sync_frequency"
                        value={f.value}
                        checked={frequency === f.value}
                        onChange={() => setFrequency(f.value)}
                        style={{ accentColor: 'var(--teal)', flexShrink: 0 }}
                      />
                      <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {f.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn btn-ghost" onClick={() => setStep('test')}>
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  disabled={saving || selectedModules.size === 0}
                  onClick={handleSave}
                >
                  {saving ? (
                    <>
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                      Saving…
                    </>
                  ) : (
                    <>Save &amp; Connect <ChevronRight size={15} /></>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── DONE ── */}
          {step === 'done' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '1rem',
                padding: '1.5rem 0',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: 'var(--green-bg)',
                  border: '2px solid var(--green)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CheckCircle2 size={36} style={{ color: 'var(--green)' }} />
              </div>

              <div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                  Integration connected!
                </h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  {cfg.name} has been successfully configured.
                </p>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: '0.875rem 1.25rem',
                  width: '100%',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Connector</span>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-primary)' }}>{cfg.name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Name</span>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-primary)' }}>{displayName}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Modules</span>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--teal)' }}>
                    {selectedModules.size} selected
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Sync frequency</span>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {SYNC_FREQUENCIES.find(f => f.value === frequency)?.label ?? frequency}
                  </span>
                </div>
              </div>

              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', maxWidth: 380 }}>
                A historical sync will begin in the background. Data will appear in Quova within a few minutes.
              </p>

              <button
                className="btn btn-primary"
                style={{ marginTop: '0.5rem', minWidth: 120 }}
                onClick={() => { onSaved(); onClose() }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
