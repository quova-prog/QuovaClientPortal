// ============================================================
// Discovery Service — AI-powered schema → field mapping
// Uses same direct Anthropic fetch pattern as claudeClient.ts
// No React dependencies — pure TypeScript.
// ============================================================

import type { AIDiscoveryResult, OrganizationProfile } from '@/types'
import { callAnthropicProxy } from './anthropicProxy'

export interface FlatFileColumn {
  name: string
  sampleValues: string[]
  dataType: string   // 'text' | 'numeric' | 'date' | 'currency_code'
}

export interface FlatFileSchema {
  columns: FlatFileColumn[]
  rowCount: number
  fileName: string
}

/** Quova canonical exposure model — all possible target fields */
export const ORBIT_TARGET_FIELDS: Array<{ entity: string; field: string; label: string; required: boolean }> = [
  { entity: 'exposure', field: 'transaction_id',       label: 'Transaction ID',        required: true  },
  { entity: 'exposure', field: 'transaction_type',     label: 'Transaction Type',      required: true  },
  { entity: 'exposure', field: 'transaction_currency', label: 'Transaction Currency',  required: true  },
  { entity: 'exposure', field: 'functional_currency',  label: 'Functional Currency',   required: false },
  { entity: 'exposure', field: 'notional_amount',      label: 'Notional Amount',       required: true  },
  { entity: 'exposure', field: 'functional_amount',    label: 'Functional Amount',     required: false },
  { entity: 'exposure', field: 'settlement_date',      label: 'Settlement Date',       required: true  },
  { entity: 'exposure', field: 'posting_date',         label: 'Posting Date',          required: false },
  { entity: 'exposure', field: 'counterparty',         label: 'Counterparty',          required: true  },
  { entity: 'exposure', field: 'entity',               label: 'Entity / Subsidiary',   required: true  },
  { entity: 'exposure', field: 'cost_center',          label: 'Cost Center',           required: false },
  { entity: 'exposure', field: 'business_unit',        label: 'Business Unit',         required: false },
  { entity: 'exposure', field: 'description',          label: 'Description',           required: false },
  { entity: 'exposure', field: 'status',               label: 'Status',                required: false },
]

function buildPrompt(schema: FlatFileSchema, profile: OrganizationProfile): string {
  return `You are an enterprise data mapping specialist for FX risk management.

Analyze a customer's uploaded flat file and map its columns to Quova's canonical exposure model.

## Customer Context
- Functional currency: ${profile.functional_currency}
- Transaction currencies of interest: ${profile.transaction_currencies.join(', ') || 'Not specified'}
- Legal entities: ${profile.entities.map(e => e.name).join(', ') || 'Not specified'}
- Total rows: ${schema.rowCount}
- File: ${schema.fileName}

## Quova Canonical Exposure Model (target fields)
${ORBIT_TARGET_FIELDS.map(f => `- exposure.${f.field} (${f.required ? 'REQUIRED' : 'optional'}): ${f.label}`).join('\n')}

## Customer File Columns (with sample values)
${schema.columns.map(c => `- "${c.name}" [${c.dataType}]: ${c.sampleValues.slice(0, 5).join(' | ')}`).join('\n')}

## Task
1. Map EACH customer column to the best matching Quova target field
2. Assign confidence 0.00–1.00 to each mapping
3. List required fields that are MISSING (gaps)
4. Summarize currencies found in the data

Respond ONLY with a valid JSON object — no markdown, no code fences, no extra text:
{
  "mappings": [
    {
      "source_table": "flat_file",
      "source_field": "<exact customer column name>",
      "target_entity": "exposure",
      "target_field": "<orbit field name>",
      "confidence": 0.95,
      "reasoning": "<brief reason>",
      "sample_values": ["<val1>", "<val2>", "<val3>"]
    }
  ],
  "gaps": [
    {
      "expected_source": "<missing orbit field>",
      "description": "<what we could not find>",
      "question_for_customer": "<question to ask>"
    }
  ],
  "summary": {
    "tables_identified": 1,
    "total_mappings": <integer>,
    "avg_confidence": <0.00–1.00>,
    "currencies_found": ["<3-letter ISO codes found>"],
    "estimated_open_exposures": <integer row count>,
    "estimated_total_notional_usd": 0
  }
}`
}

// Rule-based fallback mapping used when AI is unavailable.
// Patterns test the full column name (case-insensitive). Order matters — first match wins.
const MAPPING_RULES: Array<{ patterns: RegExp; target: string; confidence: number }> = [
  { patterns: /^transaction_id$|txn_id|invoice_no|invoice_number|po_no|po_number|^ref$|^reference$|^id$/i,                             target: 'transaction_id',       confidence: 0.85 },
  { patterns: /transaction_type|txn_type|^type$|^category$|document_type/i,                                                            target: 'transaction_type',     confidence: 0.80 },
  { patterns: /transaction_currency|^currency$|^ccy$|foreign_currency|txn_ccy|^curr$/i,                                               target: 'transaction_currency', confidence: 0.95 },
  { patterns: /notional_amount|notional|^amount$|^value$|^total$|invoice_amount|po_amount|gross_amount/i,                             target: 'notional_amount',      confidence: 0.88 },
  { patterns: /functional_amount|local_amount|home_amount|domestic_amount|base_amount/i,                                               target: 'functional_amount',    confidence: 0.83 },
  { patterns: /settlement_date|settlement|due_date|payment_date|value_date|maturity_date|^maturity$|^due$/i,                          target: 'settlement_date',      confidence: 0.90 },
  { patterns: /posting_date|post_date|invoice_date|transaction_date|^date$|^created$/i,                                               target: 'posting_date',         confidence: 0.82 },
  { patterns: /^counterparty$|^vendor$|^customer$|^supplier$|vendor_name|customer_name|supplier_name|counterparty_name|^party$/i,     target: 'counterparty',         confidence: 0.85 },
  { patterns: /^entity$|subsidiary|legal_entity|company_code|^bukrs$|entity_name/i,                                                   target: 'entity',               confidence: 0.87 },
  { patterns: /cost_center|cost_centre|^department$|^dept$|^division$/i,                                                              target: 'cost_center',          confidence: 0.83 },
  { patterns: /business_unit|^bu$|profit_center|^segment$/i,                                                                          target: 'business_unit',        confidence: 0.80 },
  { patterns: /^description$|^memo$|^notes$|^narration$|^text$|^detail$|^details$/i,                                                  target: 'description',          confidence: 0.80 },
  { patterns: /^status$|^state$|payment_status|open_closed/i,                                                                         target: 'status',               confidence: 0.85 },
]

function fallbackMapping(schema: FlatFileSchema, profile: OrganizationProfile): AIDiscoveryResult {
  const mappings: AIDiscoveryResult['mappings'] = []
  const usedTargets = new Set<string>()

  for (const col of schema.columns) {
    for (const rule of MAPPING_RULES) {
      if (rule.patterns.test(col.name) && !usedTargets.has(rule.target)) {
        mappings.push({
          source_table: 'flat_file',
          source_field: col.name,
          target_entity: 'exposure',
          target_field: rule.target,
          confidence: rule.confidence,
          reasoning: `Column name matches common patterns for "${rule.target}"`,
          sample_values: col.sampleValues.slice(0, 5),
        })
        usedTargets.add(rule.target)
        break
      }
    }
  }

  const ISO_CCY = /^[A-Z]{3}$/
  const currencies_found: string[] = []
  for (const col of schema.columns) {
    for (const val of col.sampleValues) {
      if (ISO_CCY.test(val.trim()) && !currencies_found.includes(val.trim())) {
        currencies_found.push(val.trim())
      }
    }
  }

  const mappedTargets = new Set(mappings.map(m => m.target_field))
  const gaps: AIDiscoveryResult['gaps'] = ORBIT_TARGET_FIELDS
    .filter(f => f.required && !mappedTargets.has(f.field))
    .map(f => ({
      expected_source: f.field,
      description: `Could not find a column matching "${f.label}"`,
      question_for_customer: `Which column in your file contains ${f.label}?`,
    }))

  const avg = mappings.length > 0
    ? mappings.reduce((s, m) => s + m.confidence, 0) / mappings.length
    : 0

  return {
    mappings,
    gaps,
    summary: {
      tables_identified: 1,
      total_mappings: mappings.length,
      avg_confidence: Math.round(avg * 100) / 100,
      currencies_found: currencies_found.length > 0 ? currencies_found : profile.transaction_currencies,
      estimated_open_exposures: schema.rowCount,
      estimated_total_notional_usd: 0,
    },
  }
}

export async function runFlatFileDiscovery(
  schema: FlatFileSchema,
  profile: OrganizationProfile,
): Promise<AIDiscoveryResult> {
  // Always run rule-based mapping first — it's fast and reliable for known column names
  const ruleResult = fallbackMapping(schema, profile)

  // If rules already mapped all required fields, use the rule result directly.
  // AI adds value only when column names are non-standard.
  const requiredFields = ORBIT_TARGET_FIELDS.filter(f => f.required).map(f => f.field)
  const ruleTargets = new Set(ruleResult.mappings.map(m => m.target_field))
  const requiredCovered = requiredFields.filter(f => ruleTargets.has(f)).length

  if (requiredCovered >= requiredFields.length - 1) {
    // Rules covered most/all required fields — use as-is, bump confidence for exact matches
    console.log(`[discoveryService] Rule-based mapping covered ${requiredCovered}/${requiredFields.length} required fields — skipping AI`)
    return {
      ...ruleResult,
      mappings: ruleResult.mappings.map(m => ({
        ...m,
        confidence: Math.min(m.confidence + 0.05, 0.99), // boost confidence for rule matches
        reasoning: m.reasoning + ' (matched by column name)',
      })),
    }
  }

  // Column names are non-standard — call AI for help with unmapped columns
  try {
    const res = await callAnthropicProxy({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: buildPrompt(schema, profile) }],
    })

    if (!res.ok) throw new Error(`Anthropic API ${res.status}`)

    const data = await res.json() as { content?: Array<{ type: string; text: string }> }
    const rawText = data.content?.find(c => c.type === 'text')?.text ?? ''
    const text = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON object in Claude response')

    const parsed = JSON.parse(match[0]) as AIDiscoveryResult

    if (!Array.isArray(parsed.mappings) || !parsed.summary) {
      throw new Error('Invalid response structure from Claude')
    }

    // Merge: prefer rule-based mappings (reliable), add AI-only mappings for unmatched columns
    const ruleSourceFields = new Set(ruleResult.mappings.map(m => m.source_field))
    const aiOnlyMappings = parsed.mappings.filter(m => !ruleSourceFields.has(m.source_field))

    return {
      mappings: [...ruleResult.mappings, ...aiOnlyMappings],
      gaps: parsed.gaps.filter(g =>
        !ruleTargets.has(g.expected_source) // only keep gaps the rules didn't already cover
      ),
      summary: {
        ...parsed.summary,
        total_mappings: ruleResult.mappings.length + aiOnlyMappings.length,
      },
    }
  } catch (err) {
    console.warn('[discoveryService] AI call failed — using rule-based result:', err)
    return ruleResult
  }
}
