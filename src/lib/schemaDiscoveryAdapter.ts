// =============================================================================
// Schema Discovery Adapter
//
// Bridges the schema-discovery package into the orbit-mvp onboarding flow:
//   1. BrowserLlmClient — LlmClient for browser-side Anthropic API calls
//   2. discoveryReportToAIResult — converts DiscoveryReport → AIDiscoveryResult
//   3. erpTypeToProfile — maps ERPType → ErpProfile
//
// All imports from schema-discovery are dynamic with try/catch so the build
// succeeds on Vercel where the package isn't available.
// =============================================================================

import type {
  ERPType,
  AIDiscoveryResult,
  ReconciliationSignalSummary,
  OnboardingHumanReviewItem,
} from '@/types'

// ── Inline type definitions (mirrored from schema-discovery) ─────────────────
// Duplicated here so orbit-mvp can build standalone.

export interface LlmClient {
  complete(params: {
    systemPrompt: string
    userPrompt: string
    modelId: string
    temperature?: number
  }): Promise<{ text: string; modelId: string }>
}

export interface ErpProfile {
  erpType: string
  displayName: string
  fieldNamingConventions: Record<string, string>
  commonTableNames: string[]
  dataTypeMap: Record<string, string>
}

/** Minimal shape of DiscoveryReport we consume */
export interface DiscoveryReport {
  reportId: string
  timestamp: string
  timing: { proposalAMs: number; proposalBMs: number; totalMs: number }
  proposalA: { tableMappings: unknown[] }
  proposalB: { tableMappings: unknown[] }
  reconciled: {
    summary: {
      totalTablesAnalyzed: number
      overallAgreementRate: number
      overallConfidence: number
      columnsWithConsensus: number
      columnsWithConflict: number
      columnsRequiringHumanReview: number
    }
    tables: Array<{
      sourceTable: string
      columns: Array<{
        sourceColumn: string
        acceptedMapping: { orbitField: string; evidenceSamples?: string[]; confidence?: number } | null
        finalConfidence: number
        reconciliationReasoning: string
        verdict: string
        requiresHumanReview: boolean
        signals: Array<{ type: string; weight: number; description: string }>
        humanReviewPrompt?: string
        proposalA?: { orbitField: string; confidence: number } | null
        proposalB?: { orbitField: string; confidence: number } | null
      }>
    }>
    humanReviewQueue: Array<{
      priority: 'critical' | 'high' | 'medium' | 'low'
      sourceTable: string
      sourceColumn: string
      question: string
      options: Array<{ label: string; description: string; proposedBy: 'A' | 'B' | 'both' | 'system' }>
      context: string
    }>
  }
}

interface ColumnReconciliation {
  verdict: string
  finalConfidence: number
}

// ── SAP S/4HANA Profile (inline) ─────────────────────────────────────────────

const SAP_S4HANA_PROFILE: ErpProfile = {
  erpType: 'sap_s4hana',
  displayName: 'SAP S/4HANA',
  fieldNamingConventions: {
    WRBTR: 'Document currency amount',
    DMBTR: 'Local currency amount',
    WAERS: 'Document currency',
    HWAER: 'Local currency',
    BUKRS: 'Company code',
    BELNR: 'Document number',
    GJAHR: 'Fiscal year',
    BUDAT: 'Posting date',
    BLDAT: 'Document date',
    LIFNR: 'Vendor number',
    KUNNR: 'Customer number',
    NETWR: 'Net value',
    EBELN: 'Purchase order number',
    VBELN: 'Sales document number',
  },
  commonTableNames: ['BSEG', 'BKPF', 'EKKO', 'EKPO', 'VBRK', 'VBRP', 'T001', 'TCURR', 'LFA1', 'KNA1'],
  dataTypeMap: {
    CURR: 'DECIMAL',
    CUKY: 'VARCHAR(3)',
    DATS: 'DATE',
    NUMC: 'INTEGER',
    CHAR: 'VARCHAR',
  },
}

// ── BrowserLlmClient ─────────────────────────────────────────────────────────

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined

/**
 * Implements the schema-discovery LlmClient interface using direct browser
 * fetch to the Anthropic Messages API. Same pattern as discoveryService.ts.
 */
export class BrowserLlmClient implements LlmClient {
  async complete(params: {
    systemPrompt: string
    userPrompt: string
    modelId: string
    temperature?: number
  }): Promise<{ text: string; modelId: string }> {
    if (!ANTHROPIC_KEY) {
      throw new Error('VITE_ANTHROPIC_API_KEY is not set — cannot run ERP schema discovery')
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: params.modelId,
        max_tokens: 16384,
        temperature: params.temperature ?? 0,
        system: params.systemPrompt,
        messages: [{ role: 'user', content: params.userPrompt }],
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`)
    }

    const data = await res.json() as { content?: Array<{ type: string; text: string }> }
    const text = data.content?.find(c => c.type === 'text')?.text ?? ''

    return { text, modelId: params.modelId }
  }
}

// ── Type converters ──────────────────────────────────────────────────────────

/**
 * Converts a DiscoveryReport from the schema-discovery package into the
 * AIDiscoveryResult shape expected by the onboarding pipeline + DB persistence.
 *
 * Enriches each mapping with reconciliation data (verdict, signals, reasoning)
 * that the upgraded ValidateMappings UI can display.
 */
export function discoveryReportToAIResult(report: DiscoveryReport): AIDiscoveryResult {
  const mappings: AIDiscoveryResult['mappings'] = []
  const currenciesFound = new Set<string>()
  let totalConfidence = 0

  for (const table of report.reconciled.tables) {
    for (const col of table.columns) {
      if (!col.acceptedMapping) continue

      const mapping: AIDiscoveryResult['mappings'][number] & {
        verdict?: string
        reconciliation_reasoning?: string
        signals?: ReconciliationSignalSummary[]
        human_review_prompt?: string
        human_review_priority?: string
        proposal_a_field?: string
        proposal_b_field?: string
        proposal_a_confidence?: number
        proposal_b_confidence?: number
      } = {
        source_table: table.sourceTable,
        source_field: col.sourceColumn,
        target_entity: 'exposure',
        target_field: mapOrbitFieldToTargetField(col.acceptedMapping.orbitField),
        confidence: col.finalConfidence,
        reasoning: col.reconciliationReasoning,
        sample_values: col.acceptedMapping.evidenceSamples ?? [],
        // Reconciliation enrichment
        verdict: col.verdict,
        reconciliation_reasoning: col.reconciliationReasoning,
        signals: col.signals.map((s: { type: string; weight: number; description: string }) => ({
          type: s.type,
          weight: s.weight,
          description: s.description,
        })),
        human_review_prompt: col.humanReviewPrompt,
        human_review_priority: col.requiresHumanReview
          ? getReviewPriority(col)
          : undefined,
        proposal_a_field: col.proposalA ? mapOrbitFieldToTargetField(col.proposalA.orbitField) : undefined,
        proposal_b_field: col.proposalB ? mapOrbitFieldToTargetField(col.proposalB.orbitField) : undefined,
        proposal_a_confidence: col.proposalA?.confidence,
        proposal_b_confidence: col.proposalB?.confidence,
      }

      mappings.push(mapping)
      totalConfidence += col.finalConfidence

      // Detect currency fields
      if (col.acceptedMapping.orbitField === 'exposure_currency' || col.acceptedMapping.orbitField === 'functional_currency') {
        for (const sample of col.acceptedMapping.evidenceSamples ?? []) {
          if (/^[A-Z]{3}$/.test(sample)) currenciesFound.add(sample)
        }
      }
    }
  }

  // Build gaps from human review queue items that are critical/high
  const gaps = report.reconciled.humanReviewQueue
    .filter((item: { priority: string }) => item.priority === 'critical' || item.priority === 'high')
    .map((item: { sourceColumn: string; question: string; context: string }) => ({
      expected_source: item.sourceColumn,
      description: item.question,
      question_for_customer: item.context,
    }))

  return {
    mappings,
    gaps,
    summary: {
      tables_identified: report.reconciled.tables.length,
      total_mappings: mappings.length,
      avg_confidence: mappings.length > 0 ? totalConfidence / mappings.length : 0,
      currencies_found: [...currenciesFound],
      estimated_open_exposures: 0, // Cannot estimate without actual data
      estimated_total_notional_usd: 0,
    },
  }
}

/**
 * Extracts the human review queue from a DiscoveryReport into the
 * simplified type used by the onboarding UI.
 */
export function extractHumanReviewQueue(report: DiscoveryReport): OnboardingHumanReviewItem[] {
  return report.reconciled.humanReviewQueue.map((item) => ({
    priority: item.priority,
    sourceTable: item.sourceTable,
    sourceColumn: item.sourceColumn,
    question: item.question,
    options: item.options.map((o) => ({
      label: o.label,
      description: o.description,
      proposedBy: o.proposedBy,
    })),
    context: item.context,
  }))
}

// ── ERP profile resolution ───────────────────────────────────────────────────

/**
 * Maps an orbit-mvp ERPType to the appropriate schema-discovery ErpProfile.
 * Returns undefined for ERPs without a knowledge profile (graceful degradation).
 */
export function erpTypeToProfile(erpType: ERPType): ErpProfile | undefined {
  switch (erpType) {
    case 'sap_s4hana_cloud':
    case 'sap_s4hana_onprem':
    case 'sap_ecc':
      return SAP_S4HANA_PROFILE
    // Future: add Oracle, NetSuite, etc. profiles as they're built
    default:
      return undefined
  }
}

/**
 * Dynamically loads the DiscoveryOrchestrator from the schema-discovery package.
 * Returns null if the package isn't available (Vercel build without the monorepo).
 */
export async function loadDiscoveryOrchestrator(): Promise<{ DiscoveryOrchestrator: unknown } | null> {
  try {
    return await import(/* @vite-ignore */ 'schema-discovery/src/discovery/orchestrator')
  } catch {
    console.warn('[schemaDiscoveryAdapter] schema-discovery package not available — ERP discovery will use fallback')
    return null
  }
}

/**
 * Maps the schema-discovery field naming convention back to orbit-mvp's
 * canonical field names used in discoveryService.ts ORBIT_TARGET_FIELDS.
 */
function mapOrbitFieldToTargetField(orbitField: string): string {
  const fieldMap: Record<string, string> = {
    exposure_amount:      'notional_amount',
    exposure_currency:    'transaction_currency',
    functional_currency:  'functional_currency',
    settlement_date:      'settlement_date',
    posting_date:         'posting_date',
    entity_id:            'entity',
    cost_center_id:       'cost_center',
    counterparty_id:      'counterparty',
    transaction_type:     'transaction_type',
    source_document_id:   'transaction_id',
    status:               'status',
    is_intercompany:      'is_intercompany',
    exposure_direction:   'direction',
    gross_amount:         'gross_amount',
    tax_amount:           'tax_amount',
  }
  return fieldMap[orbitField] ?? orbitField
}

function getReviewPriority(col: ColumnReconciliation): 'critical' | 'high' | 'medium' | 'low' {
  if (col.verdict === 'CONFLICT' && col.finalConfidence < 0.5) return 'critical'
  if (col.verdict === 'CONFLICT') return 'high'
  if (col.verdict === 'BOTH_UNCERTAIN') return 'medium'
  return 'low'
}
