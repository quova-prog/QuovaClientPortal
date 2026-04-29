import {
  Upload,
  CircleDollarSign,
  TrendingUp,
  UserCheck,
  ShoppingCart,
  Truck,
  Waves,
  Banknote,
  ArrowLeftRight,
  Building2,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type UploadSectionId =
  | 'exposures'
  | 'budget_rates'
  | 'revenue'
  | 'customer_contracts'
  | 'purchase_orders'
  | 'supplier_contracts'
  | 'cash_flow'
  | 'loans'
  | 'intercompany'
  | 'capex'
  | 'payroll'

export interface UploadCardDef {
  id: UploadSectionId
  label: string
  desc: string
  icon: LucideIcon
  color: string
}

export interface UploadCardGroup {
  section: string
  cards: UploadCardDef[]
}

export const UPLOAD_CARD_GROUPS: UploadCardGroup[] = [
  {
    section: 'FX & RATES',
    cards: [
      {
        id: 'exposures',
        label: 'Exposures',
        desc: 'Upload FX exposure data from your ERP or spreadsheets',
        icon: Upload,
        color: '#0ea5e9',
      },
      {
        id: 'budget_rates',
        label: 'Budget FX Rates',
        desc: 'Manage budget FX rate assumptions by fiscal year and currency pair',
        icon: CircleDollarSign,
        color: '#8b5cf6',
      },
    ],
  },
  {
    section: 'REVENUE & RECEIVABLES',
    cards: [
      {
        id: 'revenue',
        label: 'Revenue Forecasts',
        desc: 'Track forecast revenue by currency, segment and region',
        icon: TrendingUp,
        color: '#10b981',
      },
      {
        id: 'customer_contracts',
        label: 'Customer Contracts',
        desc: 'Manage customer contracts, renewal dates and revenue by currency',
        icon: UserCheck,
        color: '#06b6d4',
      },
    ],
  },
  {
    section: 'PAYABLES & PROCUREMENT',
    cards: [
      {
        id: 'purchase_orders',
        label: 'Purchase Orders',
        desc: 'Track purchase orders and accounts payable by currency and supplier',
        icon: ShoppingCart,
        color: '#f59e0b',
      },
      {
        id: 'supplier_contracts',
        label: 'Supplier Contracts',
        desc: 'Manage supplier contracts, payment schedules and FX exposure',
        icon: Truck,
        color: '#ef4444',
      },
    ],
  },
  {
    section: 'TREASURY & OPERATIONS',
    cards: [
      {
        id: 'cash_flow',
        label: 'Cash Flow',
        desc: 'Project and analyze treasury cash flows by currency and time horizon',
        icon: Waves,
        color: '#3b82f6',
      },
      {
        id: 'loans',
        label: 'Loan & Debt Schedules',
        desc: 'Track debt facilities, payment schedules and maturity profiles',
        icon: Banknote,
        color: '#6366f1',
      },
      {
        id: 'intercompany',
        label: 'Intercompany Transfers',
        desc: 'Schedule and track intercompany transfers between entities',
        icon: ArrowLeftRight,
        color: '#84cc16',
      },
      {
        id: 'capex',
        label: 'Capital Expenditure',
        desc: 'Manage capex plans, budgets and committed spend by currency',
        icon: Building2,
        color: '#f97316',
      },
      {
        id: 'payroll',
        label: 'Payroll by Currency',
        desc: 'Track payroll costs by currency, entity and department',
        icon: Users,
        color: '#a855f7',
      },
    ],
  },
]

export function formatUploadDate(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
