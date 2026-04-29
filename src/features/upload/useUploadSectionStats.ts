import { useUploadBatches } from '@/hooks/useData'
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
import type { UploadSectionId } from './uploadCatalog'

type UploadedItem = { uploaded_at: string }

function latestUpload(items: UploadedItem[]): string | null {
  if (items.length === 0) return null
  return items.reduce((latest, item) =>
    item.uploaded_at > latest.uploaded_at ? item : latest
  ).uploaded_at
}

export function useUploadSectionStats(): {
  counts: Record<UploadSectionId, number>
  lastUploads: Record<UploadSectionId, string | null>
} {
  const { batches } = useUploadBatches()
  const { rates } = useBudgetRates()
  const { forecasts } = useRevenueForecasts()
  const { orders } = usePurchaseOrders()
  const { flows } = useCashFlows()
  const { loans } = useLoanSchedules()
  const { entries: payrollEntries } = usePayroll()
  const { transfers } = useIntercompanyTransfers()
  const { entries: capexEntries } = useCapex()
  const { contracts: supplierContracts } = useSupplierContracts()
  const { contracts: customerContracts } = useCustomerContracts()

  const counts: Record<UploadSectionId, number> = {
    exposures: batches.length,
    budget_rates: rates.length,
    revenue: forecasts.length,
    customer_contracts: customerContracts.length,
    purchase_orders: orders.length,
    supplier_contracts: supplierContracts.length,
    cash_flow: flows.length,
    loans: loans.length,
    intercompany: transfers.length,
    capex: capexEntries.length,
    payroll: payrollEntries.length,
  }

  const lastUploads: Record<UploadSectionId, string | null> = {
    exposures: batches[0]?.created_at ?? null,
    budget_rates: latestUpload(rates),
    revenue: latestUpload(forecasts),
    customer_contracts: latestUpload(customerContracts),
    purchase_orders: latestUpload(orders),
    supplier_contracts: latestUpload(supplierContracts),
    cash_flow: latestUpload(flows),
    loans: latestUpload(loans),
    intercompany: latestUpload(transfers),
    capex: latestUpload(capexEntries),
    payroll: latestUpload(payrollEntries),
  }

  return { counts, lastUploads }
}
