// ============================================================
// ORBIT MVP — Core TypeScript Types
// ============================================================

// ── Database Types ────────────────────────────────────────

export interface Organisation {
  id: string
  name: string
  domain: string | null
  plan: 'exposure' | 'pro' | 'enterprise'
  created_at: string
  updated_at: string
}

export type TierPlan = 'exposure' | 'pro' | 'enterprise'

export interface TierDefinition {
  id: TierPlan
  display_name: string
  description: string | null
  monthly_price_cents: number | null
  annual_price_cents: number | null
  feature_exposure_dashboard: boolean
  feature_hedge_tracking: boolean
  feature_coverage_analysis: boolean
  feature_policy_compliance: boolean
  feature_approval_workflows: boolean
  feature_audit_trail: boolean
  feature_board_reporting: boolean
  feature_ai_recommendations: boolean
  feature_trade_execution: boolean
  feature_multi_bank_rfq: boolean
  feature_api_access: boolean
  feature_sso: boolean
  feature_custom_integrations: boolean
  max_users: number | null
  support_level: string | null
  support_sla_hours: number | null
}

export type TierFeature =
  | 'exposure_dashboard'
  | 'hedge_tracking'
  | 'coverage_analysis'
  | 'policy_compliance'
  | 'approval_workflows'
  | 'audit_trail'
  | 'board_reporting'
  | 'ai_recommendations'
  | 'trade_execution'
  | 'multi_bank_rfq'
  | 'api_access'
  | 'sso'
  | 'custom_integrations'

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
  entity_id: string | null                 // null = org-level policy
  name: string
  min_coverage_pct: number
  max_coverage_pct: number
  target_hedge_ratio_pct: number | null    // explicit target; midpoint of min/max if null
  min_notional_threshold: number
  min_tenor_days: number
  max_tenor_months: number | null          // max tenor for new hedges; advisor estimates if null
  allowed_instruments: string[] | null     // ['forward','swap','option','spot']; all if null
  rebalance_frequency: 'monthly' | 'quarterly' | 'on_trigger'
  coverage_horizon_months: number          // rolling horizon in months: 3, 6, 12, 18, 24
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
  entity_id: string | null
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
  entity_id: string | null
  created_by: string | null
  instrument_type: 'forward' | 'swap' | 'option' | 'spot'
  hedge_type: 'cash_flow' | 'fair_value' | 'net_investment'  // ASC 815 designation
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
  base_currency: string
  quote_currency: string
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

// ── Bank Accounts ─────────────────────────────────────────

export interface BankAccount {
  id: string
  org_id: string
  bank_name: string
  account_name: string
  account_number_masked: string
  currency: string
  balance: number
  account_type: string
  status: 'active' | 'disconnected' | 'error'
  swift_bic: string | null
  iban: string | null
  notes: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface BankAccountForm {
  bank_name: string
  account_name: string
  account_number_masked: string
  currency: string
  balance: number
  account_type: string
  swift_bic: string
  iban: string
  notes: string
}

// ── Entity Types ──────────────────────────────────────────

export interface Entity {
  id: string
  org_id: string
  name: string
  functional_currency: string
  jurisdiction: string | null
  parent_entity_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// ── Auth Types ────────────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  profile: Profile | null
  organisation: Organisation | null
}

// ── Onboarding ─────────────────────────────────────────────

export type OnboardingStatus = 'setup' | 'connect' | 'discover' | 'validate' | 'live' | 'error'

export interface OnboardingSession {
  id: string
  org_id: string
  status: OnboardingStatus
  started_at: string
  completed_at: string | null
  current_step_started_at: string | null
  error_message: string | null
  metadata: Record<string, unknown>
  created_by: string
  updated_at: string
}

export interface OrganizationProfile {
  id: string
  org_id: string
  functional_currency: string
  reporting_currencies: string[]
  fiscal_year_end_month: number | null
  transaction_currencies: string[]
  entities: Array<{ name: string; country: string; functional_currency: string }>
  industry: string | null
  annual_revenue_band: string | null
  bank_relationships: string[]
  reporting_cadence: string | null
  fx_pain_points: string | null
  created_at: string
  updated_at: string
}

export type ERPType =
  | 'sap_s4hana_cloud'
  | 'sap_s4hana_onprem'
  | 'sap_ecc'
  | 'oracle_cloud_erp'
  | 'oracle_ebs'
  | 'netsuite'
  | 'dynamics_365'
  | 'workday'
  | 'flat_file'
  | 'api_custom'

export type DiscoveryStage =
  | 'schema_pull' | 'candidate_id' | 'sample_pull' | 'ai_analysis' | 'validation' | 'preview'
  // ERP path stages (dual-LLM reconciliation)
  | 'triage' | 'analysis_a' | 'analysis_b' | 'reconciliation'
export type DiscoveryEventStatus = 'running' | 'completed' | 'warning' | 'error'

export interface DiscoveryFeedEvent {
  id: string
  timestamp: string
  stage: DiscoveryStage
  status: DiscoveryEventStatus
  message: string
  data?: Record<string, unknown>
}

export type MappingStatus = 'proposed' | 'confirmed' | 'rejected' | 'modified'

export type ReconciliationVerdictType =
  | 'CONSENSUS'
  | 'CONSENSUS_WITH_NUANCE'
  | 'CONFLICT'
  | 'SINGLE_ONLY'
  | 'BOTH_UNCERTAIN'
  | 'RESOLVED_BY_RULES'

export interface ReconciliationSignalSummary {
  type: string
  weight: number
  description: string
}

export interface OnboardingHumanReviewItem {
  priority: 'critical' | 'high' | 'medium' | 'low'
  sourceTable: string
  sourceColumn: string
  question: string
  options: Array<{ label: string; description: string; proposedBy: 'A' | 'B' | 'both' | 'system' }>
  context: string
}

export interface FieldMapping {
  id: string
  discovery_id: string
  source_table: string
  source_field: string
  source_data_type: string | null
  sample_values: string[]
  target_entity: string
  target_field: string
  status: MappingStatus
  confidence: number
  ai_reasoning: string | null
  human_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string

  // Reconciliation enrichment (ERP path only — absent for flat file mappings)
  verdict?: ReconciliationVerdictType
  reconciliation_reasoning?: string
  signals?: ReconciliationSignalSummary[]
  human_review_prompt?: string
  human_review_priority?: 'critical' | 'high' | 'medium' | 'low'
  proposal_a_field?: string
  proposal_b_field?: string
  proposal_a_confidence?: number
  proposal_b_confidence?: number
}

export interface DiscoverySummary {
  tables_identified: number
  total_mappings: number
  avg_confidence: number
  currencies_found: string[]
  estimated_open_exposures: number
  estimated_total_notional_usd: number
}

export interface DiscoveryGap {
  expected_source: string
  description: string
  question_for_customer: string
}

export interface AIDiscoveryResult {
  mappings: Array<{
    source_table: string
    source_field: string
    target_entity: string
    target_field: string
    confidence: number
    reasoning: string
    sample_values?: string[]
  }>
  gaps: DiscoveryGap[]
  summary: DiscoverySummary
}
