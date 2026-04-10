import type { RiskMetrics, Strategy, BacktestResult } from './advisorEngine'

export interface AiAnalysis {
  cfoCoverHeadline:        string
  riskExplanation:         string
  recommendationRationale: string
  actionPriority:          'immediate' | 'this_week' | 'monitor'
  keyRisk:                 string
  confidenceNote:          string
}

// SECURITY: Direct browser-to-Anthropic API calls are disabled.
// The advisor prompt contains sensitive portfolio data (exposure amounts, hedge ratios,
// VaR, settlement timing, strategy details) that must not leave the client without
// a server-side proxy. Uses deterministic fallback analysis until BFF is implemented.
const ANTHROPIC_KEY: string | undefined = undefined

export const isConfigured = !!ANTHROPIC_KEY

// Strip accidental leading/trailing quote characters that LLMs sometimes add.
// Covers ASCII quotes, curly quotes, guillemets, low-9 quotes, and angle quotes.
// Loops until stable to handle double-wrapped cases like ""value"".
function stripQuotes(s: unknown): string {
  if (typeof s !== 'string') return ''
  // U+0022 " U+0027 ' U+00AB « U+00BB » U+2018 ' U+2019 ' U+201A ‚ U+201B ‛
  // U+201C " U+201D " U+201E „ U+201F ‟ U+2039 ‹ U+203A ›
  const quoteRe = /^[\u0022\u0027\u00AB\u00BB\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2039\u203A]+|[\u0022\u0027\u00AB\u00BB\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2039\u203A]+$/g
  let result = s.trim()
  let prev: string
  do {
    prev = result
    result = result.replace(quoteRe, '').trim()
  } while (result !== prev)
  return result
}

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n)}`
}

export async function getAdvisorAnalysis(
  metrics: RiskMetrics,
  strategies: Strategy[],
  backtest: BacktestResult,
): Promise<AiAnalysis> {
  if (!ANTHROPIC_KEY) {
    return generateFallbackAnalysis(metrics)
  }

  const top = strategies[0]

  const prompt = `You are a senior FX risk advisor writing a concise executive summary for a corporate treasurer.

PORTFOLIO DATA:
- Total FX exposure: ${fmt(metrics.totalExposureUsd)} across ${metrics.currencyRisks.length} currency pairs
- Currently hedged: ${fmt(metrics.totalHedgedUsd)} (${metrics.currentHedgeRatioPct.toFixed(1)}% hedge ratio)
- Unhedged exposure: ${fmt(metrics.unhedgedUsd)}
- Policy target band: ${metrics.policyMinPct}%–${metrics.policyMaxPct}%
- Policy breached: ${metrics.policyBreached}
- P&L at Risk (95% VaR, 1-year): ${fmt(metrics.var95Usd)}
- Nearest settlement: ${metrics.nearestSettlementDays} days
- Top recommended strategy: ${top?.name ?? 'Forward Cover'} (policy score ${top?.policyComplianceScore ?? 100}/100)
- Backtest: hedging would have reduced volatility by ~${backtest.winRatePct.toFixed(0)}% of months over 2 years

Return ONLY a JSON object — no markdown fences, no commentary, no extra text — with exactly these six fields:

{
  "cfoCoverHeadline": "One punchy sentence summarising the risk position for a CFO",
  "riskExplanation": "Two to three sentences explaining the risk in plain English",
  "recommendationRationale": "Two to three sentences explaining why the top strategy is recommended",
  "actionPriority": "immediate",
  "keyRisk": "Brief phrase identifying the primary risk driver",
  "confidenceNote": "One sentence on data confidence and what would improve it"
}

Rules:
- actionPriority must be exactly one of: immediate, this_week, monitor
- Use specific numbers from the data above
- Do NOT wrap any string value in extra quotation marks
- Do NOT use markdown code fences or any formatting — raw JSON only
- Professional, direct tone — no fluff`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => res.status.toString())
      throw new Error(`Anthropic API ${res.status}: ${errText}`)
    }

    const data = await res.json() as { content?: Array<{ type: string; text: string }> }
    const rawText = data.content?.find(c => c.type === 'text')?.text ?? ''

    // Strip markdown code fences if present (e.g. ```json ... ```)
    const text = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    // Extract JSON object from response (handles any stray text around it)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON object found in Claude response')

    const parsed = JSON.parse(match[0]) as Record<string, unknown>

    const priority = parsed.actionPriority as string
    const validPriority = (['immediate', 'this_week', 'monitor'] as const).includes(
      priority as 'immediate' | 'this_week' | 'monitor',
    )
      ? (priority as AiAnalysis['actionPriority'])
      : 'this_week'

    return {
      cfoCoverHeadline:        stripQuotes(parsed.cfoCoverHeadline),
      riskExplanation:         stripQuotes(parsed.riskExplanation),
      recommendationRationale: stripQuotes(parsed.recommendationRationale),
      actionPriority:          validPriority,
      keyRisk:                 stripQuotes(parsed.keyRisk),
      confidenceNote:          stripQuotes(parsed.confidenceNote),
    }
  } catch (err) {
    console.warn('[claudeClient] API call failed, using local fallback:', err)
    return generateFallbackAnalysis(metrics)
  }
}

export function generateFallbackAnalysis(metrics: RiskMetrics): AiAnalysis {
  const {
    unhedgedUsd,
    currentHedgeRatioPct,
    policyBreached,
    var95Usd,
    policyMinPct,
    nearestSettlementDays,
  } = metrics

  const priority: AiAnalysis['actionPriority'] =
    policyBreached || nearestSettlementDays < 30 ? 'immediate'
    : var95Usd > unhedgedUsd * 0.05 ? 'this_week'
    : 'monitor'

  return {
    cfoCoverHeadline: policyBreached
      ? `Your FX program is ${(100 - currentHedgeRatioPct).toFixed(0)}% below policy — ${fmt(unhedgedUsd)} exposed and requires immediate hedging action.`
      : `Your ${fmt(unhedgedUsd)} unhedged FX position carries up to ${fmt(var95Usd)} in annual P&L risk at 95% confidence.`,

    riskExplanation:
      `Based on 24-month historical volatility, your unhedged exposure of ${fmt(unhedgedUsd)} ` +
      `could impact earnings by up to ${fmt(var95Usd)} over the next 12 months. ` +
      (policyBreached
        ? `Your current hedge ratio of ${currentHedgeRatioPct.toFixed(0)}% falls below the policy minimum of ${policyMinPct}%, creating a compliance gap.`
        : 'A forward hedging programme would reduce this P&L volatility by over 80%.'),

    recommendationRationale:
      'Forward contracts provide the most cost-effective risk reduction for your exposure profile, ' +
      'eliminating FX uncertainty for budgeting and forecasting without requiring upfront premium. ' +
      'Execution is straightforward and can typically be completed within 24-48 hours.',

    actionPriority: priority,
    keyRisk: policyBreached ? 'Policy breach requiring action' : 'Unhedged currency exposure',

    confidenceNote:
      `Analysis based on ${metrics.currencyRisks.length} currency pair(s) with 24-month ECB reference rate history. ` +
      'Connecting live ERP and TMS data would improve precision.',
  }
}
