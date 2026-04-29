import { lazy, Suspense } from 'react'
import type { UploadSectionId } from './uploadCatalog'

const ExposuresUploadSection = lazy(() =>
  import('./ExposuresUploadSection').then(m => ({ default: m.ExposuresUploadSection }))
)
const BudgetRatesPage = lazy(() =>
  import('@/pages/BudgetRatesPage').then(m => ({ default: m.BudgetRatesPage }))
)
const RevenueForecastsPage = lazy(() =>
  import('@/pages/RevenueForecastsPage').then(m => ({ default: m.RevenueForecastsPage }))
)
const PurchaseOrdersPage = lazy(() =>
  import('@/pages/PurchaseOrdersPage').then(m => ({ default: m.PurchaseOrdersPage }))
)
const CashFlowPage = lazy(() =>
  import('@/pages/CashFlowPage').then(m => ({ default: m.CashFlowPage }))
)
const LoanSchedulesPage = lazy(() =>
  import('@/pages/LoanSchedulesPage').then(m => ({ default: m.LoanSchedulesPage }))
)
const PayrollPage = lazy(() =>
  import('@/pages/PayrollPage').then(m => ({ default: m.PayrollPage }))
)
const IntercompanyPage = lazy(() =>
  import('@/pages/IntercompanyPage').then(m => ({ default: m.IntercompanyPage }))
)
const CapexPage = lazy(() =>
  import('@/pages/CapexPage').then(m => ({ default: m.CapexPage }))
)
const SupplierContractsPage = lazy(() =>
  import('@/pages/SupplierContractsPage').then(m => ({ default: m.SupplierContractsPage }))
)
const CustomerContractsPage = lazy(() =>
  import('@/pages/CustomerContractsPage').then(m => ({ default: m.CustomerContractsPage }))
)

interface UploadSectionDetailProps {
  sectionId: UploadSectionId
  onBack: () => void
}

function SectionFallback() {
  return (
    <div className="fade-in" style={{ padding: '1rem 1.5rem' }}>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minHeight: 160 }}>
        <div className="spinner" style={{ width: 20, height: 20 }} />
        <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Loading data section…</div>
      </div>
    </div>
  )
}

export function UploadSectionDetail({
  sectionId,
  onBack,
}: UploadSectionDetailProps) {
  return (
    <div className="fade-in">
      <div style={{ padding: '1rem 1.5rem 0' }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--teal)',
            fontSize: '0.875rem',
            padding: 0,
            marginBottom: '0.5rem',
          }}
        >
          ← Back to Data Management
        </button>
      </div>

      <Suspense fallback={<SectionFallback />}>
        {sectionId === 'exposures' && <ExposuresUploadSection />}
        {sectionId === 'budget_rates' && <BudgetRatesPage />}
        {sectionId === 'revenue' && <RevenueForecastsPage />}
        {sectionId === 'customer_contracts' && <CustomerContractsPage />}
        {sectionId === 'purchase_orders' && <PurchaseOrdersPage />}
        {sectionId === 'supplier_contracts' && <SupplierContractsPage />}
        {sectionId === 'cash_flow' && <CashFlowPage />}
        {sectionId === 'loans' && <LoanSchedulesPage />}
        {sectionId === 'intercompany' && <IntercompanyPage />}
        {sectionId === 'capex' && <CapexPage />}
        {sectionId === 'payroll' && <PayrollPage />}
      </Suspense>
    </div>
  )
}
