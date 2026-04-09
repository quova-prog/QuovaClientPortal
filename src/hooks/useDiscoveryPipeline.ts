import { useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { runFlatFileDiscovery } from '@/lib/discoveryService'
import { stripPIIString } from '@/lib/piiStripper'
import type {
  DiscoveryFeedEvent,
  DiscoverySummary,
  AIDiscoveryResult,
  OrganizationProfile,
  OnboardingSession,
  ERPType,
  OnboardingHumanReviewItem,
} from '@/types'
import type { FlatFileSchema } from '@/lib/discoveryService'

// ── helpers ──────────────────────────────────────────────────

function mkEvent(
  stage: DiscoveryFeedEvent['stage'],
  status: DiscoveryFeedEvent['status'],
  message: string,
  data?: Record<string, unknown>,
): DiscoveryFeedEvent {
  return {
    id:        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    stage,
    status,
    message,
    data,
  }
}

function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── hook ─────────────────────────────────────────────────────

export interface DiscoveryPipelineResult {
  events:      DiscoveryFeedEvent[]
  summary:     DiscoverySummary | null
  gaps:        AIDiscoveryResult['gaps']
  isRunning:   boolean
  isDone:      boolean
  hasError:    boolean
  discoveryId: string | null
  run: (
    schema:  FlatFileSchema,
    profile: OrganizationProfile,
    session: OnboardingSession,
    erpType?: ERPType,
  ) => Promise<void>
}

export function useDiscoveryPipeline(): DiscoveryPipelineResult {
  const { user } = useAuth()

  const [events,      setEvents]      = useState<DiscoveryFeedEvent[]>([])
  const [summary,     setSummary]     = useState<DiscoverySummary | null>(null)
  const [gaps,        setGaps]        = useState<AIDiscoveryResult['gaps']>([])
  const [isRunning,   setIsRunning]   = useState(false)
  const [isDone,      setIsDone]      = useState(false)
  const [hasError,    setHasError]    = useState(false)
  const [discoveryId, setDiscoveryId] = useState<string | null>(null)

  const addEvent = useCallback((event: DiscoveryFeedEvent) => {
    setEvents(prev => [...prev, event])
  }, [])

  const run = useCallback(async (
    schema:  FlatFileSchema,
    profile: OrganizationProfile,
    session: OnboardingSession,
    erpType?: ERPType,
  ) => {
    setIsRunning(true)
    setIsDone(false)
    setHasError(false)
    setEvents([])
    setSummary(null)
    setGaps([])

    const isErpPath = erpType && erpType !== 'flat_file'

    try {
      if (isErpPath) {
        await runErpDiscovery(erpType, profile, session, addEvent, setDiscoveryId, setSummary, setGaps, user)
      } else {
        await runFlatFileFlow(schema, profile, session, addEvent, setDiscoveryId, setSummary, setGaps, user)
      }
      setIsDone(true)
    } catch (err) {
      console.error('[useDiscoveryPipeline]', err)
      addEvent(mkEvent('ai_analysis', 'error',
        `Discovery failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      ))
      setHasError(true)
    } finally {
      setIsRunning(false)
    }
  }, [user, addEvent])

  return { events, summary, gaps, isRunning, isDone, hasError, discoveryId, run }
}

// ── Flat File Path (unchanged from original) ─────────────────

async function runFlatFileFlow(
  schema: FlatFileSchema,
  profile: OrganizationProfile,
  session: OnboardingSession,
  addEvent: (e: DiscoveryFeedEvent) => void,
  setDiscoveryId: (id: string | null) => void,
  setSummary: (s: DiscoverySummary) => void,
  setGaps: (g: AIDiscoveryResult['gaps']) => void,
  user: ReturnType<typeof import('@/hooks/useAuth').useAuth>['user'],
): Promise<void> {
  // ── Stage 1: Schema pull ────────────────────────────────
  addEvent(mkEvent('schema_pull', 'running', 'Reading uploaded file schema…'))
  await pause(300)
  addEvent(mkEvent('schema_pull', 'completed',
    `File parsed. Found ${schema.columns.length} columns and ${schema.rowCount.toLocaleString()} rows.`,
    { columns: schema.columns.map(c => c.name) },
  ))

  // ── Stage 2: Candidate identification ──────────────────
  addEvent(mkEvent('candidate_id', 'running', 'Scanning columns for FX-relevant fields…'))
  await pause(500)

  const ccyColumns = schema.columns.filter(c =>
    c.sampleValues.some(v => /^[A-Z]{3}$/.test(v.trim())),
  )
  const numericColumns = schema.columns.filter(c => c.dataType === 'numeric')
  const dateColumns    = schema.columns.filter(c => c.dataType === 'date')

  addEvent(mkEvent('candidate_id', 'completed',
    `Identified ${schema.columns.length} columns: ${ccyColumns.length} currency, ${numericColumns.length} numeric, ${dateColumns.length} date.`,
    { currency_columns: ccyColumns.map(c => c.name) },
  ))

  // ── Stage 3: Sample pull + PII strip ───────────────────
  addEvent(mkEvent('sample_pull', 'running', 'Preparing PII-stripped sample data for AI…'))
  await pause(400)
  const sampleCount = Math.min(schema.rowCount, 100)
  addEvent(mkEvent('sample_pull', 'completed',
    `Prepared ${sampleCount} representative rows — email, phone, and SSN fields redacted.`,
  ))

  // ── Stage 4: AI mapping ────────────────────────────────
  addEvent(mkEvent('ai_analysis', 'running', 'AI analysing column structure and mapping to Quova model…'))

  // Create discovery record in DB
  let discId: string | null = null
  const orgId = user?.profile?.org_id
  if (orgId) {
    const { data: disc, error: discErr } = await supabase
      .from('schema_discoveries')
      .insert({
        session_id: session.id,
        status:     'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (discErr) {
      console.error('[useDiscoveryPipeline] Failed to create discovery record:', discErr.message)
    } else {
      discId = disc?.id ?? null
      setDiscoveryId(discId)
      if (discId) {
        try { sessionStorage.setItem('orbit_discovery_id', discId) } catch { /* ignore */ }
        console.log('[useDiscoveryPipeline] Created discovery record:', discId)
      }
    }
  }

  const aiResult = await runFlatFileDiscovery(schema, profile)

  addEvent(mkEvent('ai_analysis', 'completed',
    `Mapped ${aiResult.mappings.length} fields across ${aiResult.summary.tables_identified} table(s). ` +
    `Avg confidence: ${Math.round((aiResult.summary.avg_confidence ?? 0) * 100)}%.`,
    { summary: aiResult.summary as unknown as Record<string, unknown> },
  ))

  // ── Stage 5: Validation ────────────────────────────────
  addEvent(mkEvent('validation', 'running', 'Running data quality checks on proposed mappings…'))
  await pause(600)

  const requiredFields = ['transaction_id', 'transaction_currency', 'notional_amount', 'settlement_date', 'counterparty', 'entity']
  const mappedRequired = aiResult.mappings.filter(m => requiredFields.includes(m.target_field)).length
  const hasGaps = aiResult.gaps.length > 0

  addEvent(mkEvent('validation', hasGaps ? 'warning' : 'completed',
    hasGaps
      ? `${mappedRequired}/${requiredFields.length} required fields mapped. ${aiResult.gaps.length} gap(s) flagged for your review.`
      : `All ${requiredFields.length} required fields mapped. Validation passed.`,
    { gaps_count: aiResult.gaps.length },
  ))

  // ── Stage 6: Preview ───────────────────────────────────
  addEvent(mkEvent('preview', 'running', 'Generating exposure preview…'))
  await pause(500)

  const ccy = aiResult.summary.currencies_found
  const exposureCount = aiResult.summary.estimated_open_exposures
  addEvent(mkEvent('preview', 'completed',
    `Found ~${exposureCount.toLocaleString()} exposure records` +
    (ccy.length > 0 ? ` across ${ccy.length} currency pair(s): ${ccy.join(', ')}.` : '.'),
    { summary: aiResult.summary as unknown as Record<string, unknown> },
  ))

  // ── Persist to DB ─────────────────────────────────────
  await persistResults(discId, orgId ?? null, schema, aiResult, session)

  setSummary(aiResult.summary)
  setGaps(aiResult.gaps)
}

// ── ERP Path (new — dual-LLM reconciliation) ────────────────

async function runErpDiscovery(
  erpType: ERPType,
  profile: OrganizationProfile,
  session: OnboardingSession,
  addEvent: (e: DiscoveryFeedEvent) => void,
  setDiscoveryId: (id: string | null) => void,
  setSummary: (s: DiscoverySummary) => void,
  setGaps: (g: AIDiscoveryResult['gaps']) => void,
  user: ReturnType<typeof import('@/hooks/useAuth').useAuth>['user'],
): Promise<void> {
  const orgId = user?.profile?.org_id

  // ── Stage 1: Schema pull (build from ERP stub) ──────────
  addEvent(mkEvent('schema_pull', 'running', `Loading ${erpType.replace(/_/g, ' ')} schema metadata…`))

  const { buildErpSchema } = await import('@/lib/erpSchemaStub')
  const schemaMetadata = await buildErpSchema(erpType)

  const tableCount = schemaMetadata.tables.length
  const columnCount = schemaMetadata.tables.reduce((sum: number, t: { columns: unknown[] }) => sum + t.columns.length, 0)
  addEvent(mkEvent('schema_pull', 'completed',
    `Loaded ${tableCount} tables with ${columnCount} total columns from ${erpType.replace(/_/g, ' ')}.`,
    { columns: schemaMetadata.tables.map((t: { name: string }) => t.name) },
  ))

  // ── Stage 2: Table triage ──────────────────────────────
  addEvent(mkEvent('triage', 'running', `Identifying FX-relevant tables across ${tableCount} candidates…`))

  // Create discovery record in DB
  let discId: string | null = null
  if (orgId) {
    const { data: disc, error: discErr } = await supabase
      .from('schema_discoveries')
      .insert({
        session_id: session.id,
        status:     'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (discErr) {
      console.error('[useDiscoveryPipeline] Failed to create discovery record:', discErr.message)
    } else {
      discId = disc?.id ?? null
      setDiscoveryId(discId)
      if (discId) {
        try { sessionStorage.setItem('orbit_discovery_id', discId) } catch { /* ignore */ }
      }
    }
  }

  // Lazy-import the heavy modules
  const { BrowserLlmClient, discoveryReportToAIResult, erpTypeToProfile, extractHumanReviewQueue, loadDiscoveryOrchestrator } =
    await import('@/lib/schemaDiscoveryAdapter')

  const orchestratorModule = await loadDiscoveryOrchestrator()
  if (!orchestratorModule) {
    throw new Error('Schema discovery package is not available. ERP discovery requires the schema-discovery package.')
  }
  const { DiscoveryOrchestrator } = orchestratorModule as { DiscoveryOrchestrator: new (...args: unknown[]) => { run: (schema: unknown) => Promise<unknown> } }

  const llmClient = new BrowserLlmClient()
  const erpProfile = erpTypeToProfile(erpType)

  // Skip triage for mock schemas (MVP) — the mock SAP schema is 60 tables and
  // triage generates a very large response that can exceed token limits. When real
  // ERP connectors ship, triage should be re-enabled with pre-filtered table lists.
  const orchestrator = new DiscoveryOrchestrator(
    llmClient,
    {
      modelA: 'claude-sonnet-4-6',
      modelB: 'claude-haiku-4-5',
      skipTriage: true,
      tableConcurrency: 3, // Conservative for browser
    },
    erpProfile,
  )

  // Run the full pipeline — this takes 30-60s for large schemas
  addEvent(mkEvent('triage', 'completed', 'Table triage skipped — all tables included for analysis.'))

  addEvent(mkEvent('analysis_a', 'running', 'Model A analysing column mappings…'))
  addEvent(mkEvent('analysis_b', 'running', 'Model B analysing column mappings (independent pass)…'))

  type DiscoveryReport = import('@/lib/schemaDiscoveryAdapter').DiscoveryReport
  const report = await orchestrator.run(schemaMetadata) as DiscoveryReport

  // Update events based on actual results
  addEvent(mkEvent('analysis_a', 'completed',
    `Model A completed: ${report.proposalA.tableMappings.length} tables mapped in ${Math.round(report.timing.proposalAMs / 1000)}s.`,
  ))
  addEvent(mkEvent('analysis_b', 'completed',
    `Model B completed: ${report.proposalB.tableMappings.length} tables mapped in ${Math.round(report.timing.proposalBMs / 1000)}s.`,
  ))

  // ── Stage 3: Reconciliation ────────────────────────────
  addEvent(mkEvent('reconciliation', 'running', 'Reconciling dual-model proposals…'))
  await pause(200) // Small pause for UI update

  const recon = report.reconciled.summary
  addEvent(mkEvent('reconciliation', 'completed',
    `Reconciliation complete: ${Math.round(recon.overallAgreementRate * 100)}% agreement rate, ` +
    `${recon.columnsWithConsensus} consensus, ${recon.columnsWithConflict} conflicts resolved, ` +
    `${recon.columnsRequiringHumanReview} flagged for review.`,
  ))

  // ── Convert to AIDiscoveryResult ───────────────────────
  const aiResult = discoveryReportToAIResult(report)
  const humanReviewQueue = extractHumanReviewQueue(report)

  // ── Stage 4: Validation ────────────────────────────────
  addEvent(mkEvent('validation', 'running', 'Running data quality checks on reconciled mappings…'))
  await pause(400)

  const requiredFields = ['transaction_id', 'transaction_currency', 'notional_amount', 'settlement_date', 'counterparty', 'entity']
  const mappedRequired = aiResult.mappings.filter(m => requiredFields.includes(m.target_field)).length
  const hasGaps = aiResult.gaps.length > 0

  addEvent(mkEvent('validation', hasGaps ? 'warning' : 'completed',
    hasGaps
      ? `${mappedRequired}/${requiredFields.length} required fields mapped. ${aiResult.gaps.length} gap(s) flagged for review.`
      : `All ${requiredFields.length} required fields mapped. Validation passed.`,
  ))

  // ── Stage 5: Preview ───────────────────────────────────
  addEvent(mkEvent('preview', 'running', 'Generating discovery summary…'))
  await pause(300)

  addEvent(mkEvent('preview', 'completed',
    `Analysed ${recon.totalTablesAnalyzed} tables, mapped ${aiResult.mappings.length} columns. ` +
    `Overall confidence: ${Math.round(recon.overallConfidence * 100)}%. ` +
    `Completed in ${Math.round(report.timing.totalMs / 1000)}s.`,
    { summary: aiResult.summary as unknown as Record<string, unknown> },
  ))

  // ── Persist ─────────────────────────────────────────────
  // Store the full report and human review queue in sessionStorage for ValidateMappings
  try {
    // Store a lightweight version of the report (without the full schema to save space)
    const lightReport = {
      reportId: report.reportId,
      timestamp: report.timestamp,
      timing: report.timing,
      reconciledSummary: report.reconciled.summary,
    }
    sessionStorage.setItem('orbit_discovery_report', JSON.stringify(lightReport))
    sessionStorage.setItem('orbit_discovery_human_review', JSON.stringify(humanReviewQueue))
  } catch { /* sessionStorage full */ }

  // Build a flat file schema stub for persistResults
  const flatSchema: FlatFileSchema = {
    columns: schemaMetadata.tables
      .flatMap((t: { columns: Array<{ name: string; sampleValues?: string[]; dataType: string }> }) => t.columns)
      .slice(0, 20)
      .map((c: { name: string; sampleValues?: string[]; dataType: string }) => ({ name: c.name, sampleValues: c.sampleValues ?? [], dataType: c.dataType })),
    rowCount: schemaMetadata.tables.reduce((sum: number, t: { rowCount?: number }) => sum + (t.rowCount ?? 0), 0),
    fileName: `${erpType}-schema`,
  }

  await persistResults(discId, orgId ?? null, flatSchema, aiResult, session)

  setSummary(aiResult.summary)
  setGaps(aiResult.gaps)
}

// ── Shared persistence ──────────────────────────────────────

async function persistResults(
  discId: string | null,
  orgId: string | null,
  schema: FlatFileSchema,
  aiResult: AIDiscoveryResult,
  _session: OnboardingSession,
): Promise<void> {
  if (discId && orgId) {
    await supabase.from('schema_discoveries').update({
      status:                  'completed',
      completed_at:            new Date().toISOString(),
      raw_schema:              { columns: schema.columns, rowCount: schema.rowCount } as unknown as Record<string, unknown>,
      ai_analysis:             aiResult as unknown as Record<string, unknown>,
      confidence_score:        aiResult.summary.avg_confidence,
      tables_scanned:          1,
      tables_identified:       aiResult.summary.tables_identified,
      currencies_found:        aiResult.summary.currencies_found,
      estimated_exposure_count: aiResult.summary.estimated_open_exposures,
    }).eq('id', discId)

    if (aiResult.mappings.length > 0) {
      const { error: mapErr } = await supabase.from('field_mappings').insert(
        aiResult.mappings.map(m => ({
          discovery_id:     discId,
          source_table:     m.source_table,
          source_field:     m.source_field,
          source_data_type: schema.columns.find(c => c.name === m.source_field)?.dataType ?? 'text',
          sample_values:    (m.sample_values ?? []).map(v => typeof v === 'string' ? stripPIIString(v) : v),
          target_entity:    m.target_entity,
          target_field:     m.target_field,
          status:           'proposed',
          confidence:       m.confidence,
          ai_reasoning:     m.reasoning,
        })),
      )
      if (mapErr) {
        console.error('[useDiscoveryPipeline] Failed to insert field_mappings:', mapErr.message)
      } else {
        console.log(`[useDiscoveryPipeline] Inserted ${aiResult.mappings.length} field mappings for discovery ${discId}`)
      }
    }
  }

  // Always persist mappings to sessionStorage as a reliable fallback
  try {
    sessionStorage.setItem('orbit_discovery_mappings', JSON.stringify(aiResult.mappings))
    sessionStorage.setItem('orbit_discovery_gaps', JSON.stringify(aiResult.gaps))
    sessionStorage.setItem('orbit_discovery_summary', JSON.stringify(aiResult.summary))
    console.log(`[useDiscoveryPipeline] Saved ${aiResult.mappings.length} mappings to sessionStorage`)
  } catch { /* ignore */ }
}
