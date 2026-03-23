// ============================================================
// ORBIT MVP — Core TypeScript Types
// ============================================================

// ── Database Types ────────────────────────────────────────

export interface Organisation {
  id: string
  name: string
  domain: string | null
  plan: 'trial' | 'starter' | 'growth'
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  org_id: string
  full_name: string | null
  role: 'admin' | 'editor' | 'viewer'
  created_at: string
  updated_at: string
}

export interface HedgePolicy {
  id: string
  org_id: string
  name: string
  min_coverage_pct: number
  max_coverage_pct: number
  min_notional_threshold: number
  min_tenor_days: number
  base_currency: string
  active: boolean
  created_at: string
  updated_at: string
}

export interface FxExposure {
  id: string
  org_id: string
  upload_batch_id: string | null
  entity: string
  currency_pair: string
  base_currency: string
  quote_currency: string
  direction: 'receivable' | 'payable'
  notional_base: number
  notional_usd: number | null
  settlement_date: string
  description: string | null
  source_system: string
  status: 'open' | 'closed' | 'partially_hedged'
  created_at: string
  updated_at: string
}

export interface UploadBatch {
  id: string
  org_id: string
  uploaded_by: string | null
  filename: string
  row_count: number
  status: 'processing' | 'complete' | 'failed'
  error_message: string | null
  created_at: string
}

export interface HedgePosition {
  id: string
  org_id: string
  created_by: string | null
  instrument_type: 'forward' | 'swap' | 'option' | 'spot'
  currency_pair: string
  base_currency: string
  quote_currency: string
  direction: 'buy' | 'sell'
  notional_base: number
  notional_usd: number | null
  contracted_rate: number
  spot_rate_at_trade: number | null
  trade_date: string
  value_date: string
  counterparty_bank: string | null
  reference_number: string | null
  status: 'active' | 'expired' | 'cancelled'
  notes: string | null
  created_at: string
  updated_at: string
}

export interface FxRate {
  id: string
  currency_pair: string
  rate: number
  rate_date: string
  source: string
  created_at: string
}

// ── View Types ────────────────────────────────────────────

export interface ExposureSummary {
  org_id: string
  currency_pair: string
  base_currency: string
  quote_currency: string
  total_receivable: number
  total_payable: number
  net_exposure: number
  total_usd_equivalent: number
  exposure_count: number
  earliest_settlement: string
  latest_settlement: string
}

export interface HedgeCoverage {
  org_id: string
  currency_pair: string
  net_exposure: number
  total_hedged: number
  coverage_pct: number
  unhedged_amount: number
}

// ── UI / App Types ────────────────────────────────────────

export type CoverageStatus = 'compliant' | 'under_hedged' | 'over_hedged' | 'unhedged'

export interface CoverageWithStatus extends HedgeCoverage {
  status: CoverageStatus
  policy: HedgePolicy | null
}

export interface DashboardMetrics {
  total_exposure_usd: number
  total_hedged_usd: number
  overall_coverage_pct: number
  coverage_status: CoverageStatus
  currency_count: number
  open_exposure_count: number
  active_hedge_count: number
  exposures_by_currency: ExposureSummary[]
  coverage_by_currency: CoverageWithStatus[]
  upcoming_settlements: FxExposure[]
  maturing_hedges: HedgePosition[]
}

// ── CSV Upload Types ──────────────────────────────────────

export interface CsvExposureRow {
  entity?: string
  Entity?: string
  currency_pair?: string
  'Currency Pair'?: string
  CurrencyPair?: string
  direction?: string
  Direction?: string
  Type?: string
  notional?: string
  Notional?: string
  Amount?: string
  settlement_date?: string
  'Settlement Date'?: string
  SettlementDate?: string
  'Due Date'?: string
  description?: string
  Description?: string
  Reference?: string
  [key: string]: string | undefined
}

export interface ParsedExposure {
  entity: string
  currency_pair: string
  base_currency: string
  quote_currency: string
  direction: 'receivable' | 'payable'
  notional_base: number
  settlement_date: string
  description: string
}

export interface CsvParseResult {
  success: boolean
  rows: ParsedExposure[]
  errors: string[]
  warnings: string[]
}

// ── Form Types ────────────────────────────────────────────

export interface HedgePositionForm {
  instrument_type: 'forward' | 'swap' | 'option' | 'spot'
  currency_pair: string
  direction: 'buy' | 'sell'
  notional_base: number
  contracted_rate: number
  spot_rate_at_trade?: number
  trade_date: string
  value_date: string
  counterparty_bank?: string
  reference_number?: string
  notes?: string
}

export interface HedgePolicyForm {
  name: string
  min_coverage_pct: number
  max_coverage_pct: number
  min_notional_threshold: number
  min_tenor_days: number
  base_currency: string
}

// ── Auth Types ────────────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  profile: Profile | null
  organisation: Organisation | null
}
