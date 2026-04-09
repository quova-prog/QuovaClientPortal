import { useMemo } from 'react'
import { useHedgePolicy } from './useData'
import { usePurchaseOrders } from './usePurchaseOrders'
import { useRevenueForecasts } from './useRevenueForecasts'
import { useCustomerContracts } from './useCustomerContracts'
import { useSupplierContracts } from './useSupplierContracts'
import { useCashFlows } from './useCashFlows'
import { usePayroll } from './usePayroll'
import { useLoanSchedules } from './useLoanSchedules'
import { useCapex } from './useCapex'
import { useIntercompanyTransfers } from './useIntercompanyTransfers'

export type DerivedExposureSource =
  | 'purchase_order'
  | 'revenue_forecast'
  | 'customer_contract'
  | 'supplier_contract'
  | 'cash_flow'
  | 'payroll'
  | 'loan'
  | 'capex'
  | 'intercompany'

export interface DerivedExposure {
  id: string
  source: DerivedExposureSource
  source_label: string
  currency_pair: string
  base_currency: string
  quote_currency: string
  direction: 'receivable' | 'payable'
  notional_base: number
  settlement_date: string
  entity_id?: string | null
}

// Returns ISO date for last day of a quarter within a fiscal year
function quarterEndDate(period: string, fiscalYear: number): string | null {
  const p = period.trim().toUpperCase()
  if (p === 'Q1') return `${fiscalYear}-03-31`
  if (p === 'Q2') return `${fiscalYear}-06-30`
  if (p === 'Q3') return `${fiscalYear}-09-30`
  if (p === 'Q4') return `${fiscalYear}-12-31`
  return null
}

// Returns ISO date for last day of a named month within a year
function monthEndDate(period: string, fiscalYear: number): string | null {
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9,
    oct: 10, nov: 11, dec: 12,
  }
  const key = period.trim().toLowerCase()
  const m = months[key]
  if (!m) return null
  // Last day of month: day 0 of next month
  const d = new Date(fiscalYear, m, 0)
  return d.toISOString().slice(0, 10)
}

function deriveForecastDate(period: string, fiscalYear: number): string | null {
  const quarterDate = quarterEndDate(period, fiscalYear)
  if (quarterDate) return quarterDate
  return monthEndDate(period, fiscalYear)
}

function todayPlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function useDerivedExposures(): { derivedExposures: DerivedExposure[]; loading: boolean } {
  const { policy, loading: polLoading } = useHedgePolicy()
  const { orders, loading: poLoading } = usePurchaseOrders()
  const { forecasts, loading: rfLoading } = useRevenueForecasts()
  const { contracts: customerContracts, loading: ccLoading } = useCustomerContracts()
  const { contracts: supplierContracts, loading: scLoading } = useSupplierContracts()
  const { flows, loading: cfLoading } = useCashFlows()
  const { entries: payrollEntries, loading: prLoading } = usePayroll()
  const { loans, loading: lnLoading } = useLoanSchedules()
  const { entries: capexEntries, loading: cxLoading } = useCapex()
  const { transfers, loading: icLoading } = useIntercompanyTransfers()

  const loading =
    polLoading || poLoading || rfLoading || ccLoading || scLoading ||
    cfLoading || prLoading || lnLoading || cxLoading || icLoading

  const baseCurrency = policy?.base_currency ?? 'USD'

  const derivedExposures = useMemo<DerivedExposure[]>(() => {
    if (loading) return []

    const result: DerivedExposure[] = []

    function addExposure(e: DerivedExposure) {
      if (!e.settlement_date) return
      result.push(e)
    }

    function makePair(itemCurrency: string): { currency_pair: string; base_currency: string; quote_currency: string } | null {
      if (itemCurrency === baseCurrency) return null
      return {
        currency_pair: `${itemCurrency}/${baseCurrency}`,
        base_currency: itemCurrency,
        quote_currency: baseCurrency,
      }
    }

    // ── Purchase Orders ────────────────────────────────────
    // Note: the PurchaseOrder type only allows 'open'|'approved'|'pending'|'paid'.
    // 'received' and 'cancelled' may appear as raw DB values; cast to string to be safe.
    for (const po of orders) {
      const poStatus = po.status as string
      if (poStatus === 'received' || poStatus === 'cancelled') continue
      const pair = makePair(po.currency)
      if (!pair) continue
      const settlement_date = po.due_date || todayPlusDays(30)
      addExposure({
        id: po.id,
        source: 'purchase_order',
        source_label: `${po.po_number} – ${po.supplier}`,
        ...pair,
        direction: 'payable',
        notional_base: po.amount,
        settlement_date,
        entity_id: (po as any).entity_id ?? null,
      })
    }

    // ── Revenue Forecasts ──────────────────────────────────
    for (const rf of forecasts) {
      const pair = makePair(rf.currency)
      if (!pair) continue
      const settlement_date = deriveForecastDate(rf.period, rf.fiscal_year)
      if (!settlement_date) continue
      addExposure({
        id: rf.id,
        source: 'revenue_forecast',
        source_label: `${rf.fiscal_year} ${rf.period} – ${rf.segment || 'Revenue'}`,
        ...pair,
        direction: 'receivable',
        notional_base: rf.amount,
        settlement_date,
        entity_id: (rf as any).entity_id ?? null,
      })
    }

    // ── Customer Contracts ─────────────────────────────────
    // CustomerContract.status is 'active'|'expired'|'pending'; 'cancelled' may appear as raw DB value.
    for (const cc of customerContracts) {
      const ccStatus = cc.status as string
      if (ccStatus === 'expired' || ccStatus === 'cancelled') continue
      const pair = makePair(cc.currency)
      if (!pair) continue
      if (!cc.next_payment_date) continue
      addExposure({
        id: cc.id,
        source: 'customer_contract',
        source_label: cc.customer_name,
        ...pair,
        direction: 'receivable',
        notional_base: cc.payment_amount,
        settlement_date: cc.next_payment_date,
        entity_id: (cc as any).entity_id ?? null,
      })
    }

    // ── Supplier Contracts ─────────────────────────────────
    // SupplierContract.status is 'active'|'expired'|'pending'; 'cancelled' may appear as raw DB value.
    for (const sc of supplierContracts) {
      const scStatus = sc.status as string
      if (scStatus === 'expired' || scStatus === 'cancelled') continue
      const pair = makePair(sc.currency)
      if (!pair) continue
      if (!sc.next_payment_date) continue
      addExposure({
        id: sc.id,
        source: 'supplier_contract',
        source_label: sc.supplier_name,
        ...pair,
        direction: 'payable',
        notional_base: sc.payment_amount,
        settlement_date: sc.next_payment_date,
        entity_id: (sc as any).entity_id ?? null,
      })
    }

    // ── Cash Flows ─────────────────────────────────────────
    for (const cf of flows) {
      const pair = makePair(cf.currency)
      if (!pair) continue
      let direction: 'receivable' | 'payable'
      if (cf.flow_type === 'inflow' || (cf.flow_type === 'net' && cf.amount > 0)) {
        direction = 'receivable'
      } else if (cf.flow_type === 'outflow' || (cf.flow_type === 'net' && cf.amount < 0)) {
        direction = 'payable'
      } else {
        // net with amount === 0, skip
        continue
      }
      const counterpartyPart = cf.counterparty || cf.entity || ''
      addExposure({
        id: cf.id,
        source: 'cash_flow',
        source_label: `${cf.category || 'Cash Flow'} – ${counterpartyPart}`.replace(/ – $/, ''),
        ...pair,
        direction,
        notional_base: Math.abs(cf.amount),
        settlement_date: cf.flow_date,
        entity_id: cf.entity_id ?? null,
      })
    }

    // ── Payroll ────────────────────────────────────────────
    for (const pr of payrollEntries) {
      const pair = makePair(pr.currency)
      if (!pair) continue
      addExposure({
        id: pr.id,
        source: 'payroll',
        source_label: `${pr.entity || 'Payroll'} – ${pr.pay_period || ''}`.replace(/ – $/, ''),
        ...pair,
        direction: 'payable',
        notional_base: pr.gross_amount,
        settlement_date: pr.pay_date,
        entity_id: (pr as any).entity_id ?? null,
      })
    }

    // ── Loan Schedules ─────────────────────────────────────
    for (const ln of loans) {
      if (!ln.payment_amount) continue
      const pair = makePair(ln.currency)
      if (!pair) continue
      const settlement_date = ln.payment_date || ln.maturity_date
      if (!settlement_date) continue
      addExposure({
        id: ln.id,
        source: 'loan',
        source_label: `${ln.loan_id} – ${ln.lender}`,
        ...pair,
        direction: 'payable',
        notional_base: ln.payment_amount,
        settlement_date,
        entity_id: (ln as any).entity_id ?? null,
      })
    }

    // ── CapEx ──────────────────────────────────────────────
    // CapexEntry.status is 'planned'|'approved'|'committed'|'completed'; 'cancelled' may appear as raw DB value.
    for (const cx of capexEntries) {
      const cxStatus = cx.status as string
      if (cxStatus === 'cancelled') continue
      const pair = makePair(cx.currency)
      if (!pair) continue
      if (!cx.payment_date) continue
      const notional_base = cx.committed_amount > 0 ? cx.committed_amount : cx.budget_amount
      addExposure({
        id: cx.id,
        source: 'capex',
        source_label: cx.project_name,
        ...pair,
        direction: 'payable',
        notional_base,
        settlement_date: cx.payment_date,
        entity_id: (cx as any).entity_id ?? null,
      })
    }

    // ── Intercompany Transfers ─────────────────────────────
    for (const ic of transfers) {
      if (ic.status === 'completed') continue
      const pair = makePair(ic.currency)
      if (!pair) continue
      addExposure({
        id: ic.id,
        source: 'intercompany',
        source_label: `${ic.reference || ic.transfer_type} – ${ic.to_entity}`,
        ...pair,
        direction: 'payable',
        notional_base: ic.amount,
        settlement_date: ic.transfer_date,
        entity_id: (ic as any).entity_id ?? null,
      })
    }

    return result
  }, [
    loading, baseCurrency,
    orders, forecasts, customerContracts, supplierContracts,
    flows, payrollEntries, loans, capexEntries, transfers,
  ])

  return { derivedExposures, loading }
}
