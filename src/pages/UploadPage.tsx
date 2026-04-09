import { useState } from 'react'
import {
  Upload,
  CircleDollarSign, TrendingUp, UserCheck, ShoppingCart,
  Truck, Waves, Banknote, ArrowLeftRight, Building2, Users,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAuditLog } from '@/hooks/useAuditLog'
import { parseWorkdayCsv } from '@/lib/csvParser'
import { useUploadBatches } from '@/hooks/useData'
import { UploadWizard } from '@/components/upload/UploadWizard'
import { useBudgetRates } from '@/hooks/useBudgetRates'
import { useRevenueForecasts } from '@/hooks/useRevenueForecasts'
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders'
import { useCashFlows } from '@/hooks/useCashFlows'
import { useLoanSchedules } from '@/hooks/useLoanSchedules'
import { usePayroll } from '@/hooks/usePayroll'
import { useIntercompanyTransfers } from '@/hooks/useIntercompanyTransfers'
import { useCapex } from '@/hooks/useCapex'
import { useSupplierContracts } from '@/hooks/useSupplierContracts'
import { useCustomerContracts } from '@/hooks/useCustomerContracts'
import { BudgetRatesPage } from './BudgetRatesPage'
import { RevenueForecastsPage } from './RevenueForecastsPage'
import { PurchaseOrdersPage } from './PurchaseOrdersPage'
import { CashFlowPage } from './CashFlowPage'
import { LoanSchedulesPage } from './LoanSchedulesPage'
import { PayrollPage } from './PayrollPage'
import { IntercompanyPage } from './IntercompanyPage'
import { CapexPage } from './CapexPage'
import { SupplierContractsPage } from './SupplierContractsPage'
import { CustomerContractsPage } from './CustomerContractsPage'

// ── Card grid config ───────────────────────────────────────────────────────────

interface CardDef {
  id: string
  label: string
  desc: string
  icon: React.FC<any>
  color: string
}

interface GroupDef {
  section: string
  cards: CardDef[]
}

const CARD_GROUPS: GroupDef[] = [
  {
    section: 'FX & RATES',
    cards: [
      { id: 'exposures',    label: 'Exposures',       desc: 'Upload FX exposure data from your ERP or spreadsheets',                   icon: Upload,            color: '#0ea5e9' },
      { id: 'budget_rates', label: 'Budget FX Rates', desc: 'Manage budget FX rate assumptions by fiscal year and currency pair',       icon: CircleDollarSign,  color: '#8b5cf6' },
    ],
  },
  {
    section: 'REVENUE & RECEIVABLES',
    cards: [
      { id: 'revenue',            label: 'Revenue Forecasts',   desc: 'Track forecast revenue by currency, segment and region',                              icon: TrendingUp,   color: '#10b981' },
      { id: 'customer_contracts', label: 'Customer Contracts',  desc: 'Manage customer contracts, renewal dates and revenue by currency',                    icon: UserCheck,    color: '#06b6d4' },
    ],
  },
  {
    section: 'PAYABLES & PROCUREMENT',
    cards: [
      { id: 'purchase_orders',    label: 'Purchase Orders',     desc: 'Track purchase orders and accounts payable by currency and supplier',                 icon: ShoppingCart, color: '#f59e0b' },
      { id: 'supplier_contracts', label: 'Supplier Contracts',  desc: 'Manage supplier contracts, payment schedules and FX exposure',                        icon: Truck,        color: '#ef4444' },
    ],
  },
  {
    section: 'TREASURY & OPERATIONS',
    cards: [
      { id: 'cash_flow',    label: 'Cash Flow',               desc: 'Project and analyze treasury cash flows by currency and time horizon',                icon: Waves,          color: '#3b82f6' },
      { id: 'loans',        label: 'Loan & Debt Schedules',   desc: 'Track debt facilities, payment schedules and maturity profiles',                      icon: Banknote,       color: '#6366f1' },
      { id: 'intercompany', label: 'Intercompany Transfers',  desc: 'Schedule and track intercompany transfers between entities',                           icon: ArrowLeftRight, color: '#84cc16' },
      { id: 'capex',        label: 'Capital Expenditure',     desc: 'Manage capex plans, budgets and committed spend by currency',                          icon: Building2,      color: '#f97316' },
      { id: 'payroll',      label: 'Payroll by Currency',     desc: 'Track payroll costs by currency, entity and department',                               icon: Users,          color: '#a855f7' },
    ],
  },
]

// ── Helper ─────────────────────────────────────────────────────────────────────

function latestDate(items: { uploaded_at: string }[]): string | null {
  if (!items.length) return null
  return items.reduce((a, b) => (a.uploaded_at > b.uploaded_at ? a : b)).uploaded_at
}

function formatLastUpload(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Main component ─────────────────────────────────────────────────────────────

export function UploadPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null)

  // All data hooks — called unconditionally at the top
  const { batches }                              = useUploadBatches()
  const { rates }                                = useBudgetRates()
  const { forecasts }                            = useRevenueForecasts()
  const { orders }                               = usePurchaseOrders()
  const { flows }                                = useCashFlows()
  const { loans }                                = useLoanSchedules()
  const { entries: payrollEntries }              = usePayroll()
  const { transfers }                            = useIntercompanyTransfers()
  const { entries: capexEntries }                = useCapex()
  const { contracts: supplierContracts }         = useSupplierContracts()
  const { contracts: customerContracts }         = useCustomerContracts()

  const counts: Record<string, number> = {
    exposures:          batches.length,
    budget_rates:       rates.length,
    revenue:            forecasts.length,
    purchase_orders:    orders.length,
    cash_flow:          flows.length,
    loans:              loans.length,
    payroll:            payrollEntries.length,
    intercompany:       transfers.length,
    capex:              capexEntries.length,
    supplier_contracts: supplierContracts.length,
    customer_contracts: customerContracts.length,
  }

  const lastUploads: Record<string, string | null> = {
    exposures:          batches.length ? (batches[batches.length - 1]?.created_at ?? null) : null,
    budget_rates:       latestDate(rates),
    revenue:            latestDate(forecasts),
    purchase_orders:    latestDate(orders),
    cash_flow:          latestDate(flows),
    loans:              latestDate(loans),
    payroll:            latestDate(payrollEntries),
    intercompany:       latestDate(transfers),
    capex:              latestDate(capexEntries),
    supplier_contracts: latestDate(supplierContracts),
    customer_contracts: latestDate(customerContracts),
  }

  // ── Drill-down view ──────────────────────────────────────────────────────────

  if (activeSection !== null) {
    return (
      <div className="fade-in">
        <div style={{ padding: '1rem 1.5rem 0' }}>
          <button
            onClick={() => setActiveSection(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.375rem',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--teal)', fontSize: '0.875rem', padding: 0, marginBottom: '0.5rem',
            }}
          >
            ← Back to Data Management
          </button>
        </div>

        {activeSection === 'exposures'          && <ExposuresContent />}
        {activeSection === 'budget_rates'       && <BudgetRatesPage />}
        {activeSection === 'revenue'            && <RevenueForecastsPage />}
        {activeSection === 'purchase_orders'    && <PurchaseOrdersPage />}
        {activeSection === 'cash_flow'          && <CashFlowPage />}
        {activeSection === 'loans'              && <LoanSchedulesPage />}
        {activeSection === 'payroll'            && <PayrollPage />}
        {activeSection === 'intercompany'       && <IntercompanyPage />}
        {activeSection === 'capex'              && <CapexPage />}
        {activeSection === 'supplier_contracts' && <SupplierContractsPage />}
        {activeSection === 'customer_contracts' && <CustomerContractsPage />}
      </div>
    )
  }

  // ── Card grid view ───────────────────────────────────────────────────────────

  return (
    <div className="fade-in">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Data Management</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
            Upload, manage and analyze all your treasury and FX data
          </p>
        </div>
      </div>

      <div className="page-content">
        {CARD_GROUPS.map(group => (
          <div key={group.section} style={{ marginBottom: '0.625rem' }}>
            <div className="section-label" style={{ marginBottom: '0.25rem' }}>{group.section}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.375rem' }}>
              {group.cards.map(card => {
                const Icon = card.icon
                const count = counts[card.id] ?? 0
                const lastUpload = formatLastUpload(lastUploads[card.id] ?? null)
                return (
                  <div
                    key={card.id}
                    onClick={() => setActiveSection(card.id)}
                    style={{
                      background: 'var(--card-bg)',
                      border: `1.5px solid ${card.color}40`,
                      borderRadius: 'var(--r-md)',
                      padding: '0.375rem 0.5rem',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLElement
                      el.style.transform = 'translateY(-1px)'
                      el.style.borderColor = card.color + 'aa'
                      el.style.boxShadow = `0 2px 8px ${card.color}22`
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLElement
                      el.style.transform = ''
                      el.style.borderColor = card.color + '40'
                      el.style.boxShadow = ''
                    }}
                  >
                    {/* Top row: icon + badge */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%',
                        backgroundColor: card.color + '22',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <Icon size={9} color={card.color} />
                      </div>
                      {count > 0 ? (
                        <span style={{
                          fontSize: '0.5625rem', fontWeight: 600, padding: '0.0625rem 0.25rem',
                          borderRadius: 999, background: '#dcfce7', color: '#16a34a',
                        }}>
                          {count}
                        </span>
                      ) : (
                        <span style={{
                          fontSize: '0.5625rem', fontWeight: 600, padding: '0.0625rem 0.25rem',
                          borderRadius: 999, background: 'var(--bg-surface)', color: 'var(--text-muted)',
                          border: '1px solid var(--border)',
                        }}>
                          —
                        </span>
                      )}
                    </div>

                    {/* Name */}
                    <div style={{
                      fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-primary)',
                      lineHeight: 1.2, marginBottom: '0.125rem',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {card.label}
                    </div>

                    {/* Last upload or empty nudge */}
                    <div style={{ fontSize: '0.5625rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {lastUpload ?? 'No data yet'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Exposures content (upload wizard) ─────────────────────────────────────────

function ExposuresContent() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()

  async function parseExposures(file: File) {
    const result = await parseWorkdayCsv(file)
    return { data: result.rows, errors: result.errors, warnings: result.warnings }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Upload Exposures</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Import FX exposure data from your ERP or spreadsheets</p>
        </div>
      </div>
      <div className="page-content">
        <UploadWizard
          label="Exposures"
          icon={Upload}
          color="#0ea5e9"
          accept=".csv"
          parse={parseExposures}
          columns={[
            { key: 'entity',          label: 'Entity' },
            { key: 'currency_pair',   label: 'Currency Pair' },
            { key: 'direction',       label: 'Direction' },
            { key: 'notional_base',   label: 'Notional', format: (v) => v?.toLocaleString() ?? '—' },
            { key: 'settlement_date', label: 'Settlement Date' },
            { key: 'description',     label: 'Description' },
          ]}
          onImport={async (rows, entityId) => {
            if (!user?.profile?.org_id) return { error: 'Not authenticated' }
            try {
              const { data: batch, error: batchErr } = await db
                .from('upload_batches')
                .insert({
                  org_id: user.profile.org_id,
                  uploaded_by: user.id,
                  filename: 'exposure-upload.csv',
                  row_count: rows.length,
                  status: 'processing',
                })
                .select().single()
              if (batchErr) throw new Error(batchErr.message)
              const insertRows = rows.map(r => ({
                ...r,
                org_id: user.profile!.org_id,
                entity_id: entityId ?? null,
                upload_batch_id: batch?.id ?? null,
                status: 'open' as const,
              }))
              const { error: rowsErr } = await db.from('fx_exposures').insert(insertRows)
              if (rowsErr) {
                if (batch) await db.from('upload_batches').update({ status: 'failed', error_message: rowsErr.message }).eq('id', batch.id)
                await log({
                  action: 'upload',
                  resource: 'fx_exposures',
                  resource_id: batch?.id,
                  summary: 'Exposure upload failed',
                  metadata: { filename: 'exposure-upload.csv', row_count: rows.length, error: rowsErr.message },
                })
                return { error: rowsErr.message }
              }
              if (batch) await db.from('upload_batches').update({ status: 'complete' }).eq('id', batch.id)
              await log({
                action: 'upload',
                resource: 'fx_exposures',
                resource_id: batch?.id,
                summary: `Uploaded ${rows.length} exposure rows`,
                metadata: { filename: 'exposure-upload.csv', row_count: rows.length, entity_id: entityId ?? null },
              })
              return { error: null }
            } catch (err: any) {
              return { error: err?.message ?? 'Upload failed' }
            }
          }}
        />
      </div>
    </div>
  )
}
