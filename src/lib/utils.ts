import type { CoverageStatus, CoverageWithStatus, HedgePolicy } from '@/types'

// ── Currency formatting ───────────────────────────────────

export function formatCurrency(
  amount: number,
  currency = 'USD',
  compact = false
): string {
  if (compact) {
    if (Math.abs(amount) >= 1_000_000_000) {
      return `${currency} ${(amount / 1_000_000_000).toFixed(1)}B`
    }
    if (Math.abs(amount) >= 1_000_000) {
      return `${currency} ${(amount / 1_000_000).toFixed(1)}M`
    }
    if (Math.abs(amount) >= 1_000) {
      return `${currency} ${(amount / 1_000).toFixed(0)}K`
    }
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatNumber(n: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)
}

export function formatPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`
}

export function formatRate(rate: number): string {
  return rate.toFixed(4)
}

// ── Date formatting ───────────────────────────────────────

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function daysUntil(dateStr: string): number {
  const target = new Date(dateStr)
  const now = new Date()
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

// ── Coverage logic ────────────────────────────────────────

export function getCoverageStatus(
  coveragePct: number,
  policy: HedgePolicy | null
): CoverageStatus {
  if (!policy) {
    if (coveragePct === 0) return 'unhedged'
    return 'compliant'
  }
  if (coveragePct === 0) return 'unhedged'
  if (coveragePct < policy.min_coverage_pct) return 'under_hedged'
  if (coveragePct > policy.max_coverage_pct) return 'over_hedged'
  return 'compliant'
}

export const COVERAGE_COLORS: Record<CoverageStatus, string> = {
  compliant: '#10b981',      // emerald
  under_hedged: '#ef4444',   // red
  over_hedged: '#f59e0b',    // amber
  unhedged: '#6b7280',       // grey
}

export const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  compliant: 'Compliant',
  under_hedged: 'Under-hedged',
  over_hedged: 'Over-hedged',
  unhedged: 'Unhedged',
}

export const COVERAGE_BG: Record<CoverageStatus, string> = {
  compliant: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  under_hedged: 'bg-red-500/10 text-red-400 border-red-500/20',
  over_hedged: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  unhedged: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
}

// ── Currency pair parsing ─────────────────────────────────

export function parseCurrencyPair(pair: string): {
  base: string
  quote: string
} | null {
  const cleaned = pair.toUpperCase().replace(/[^A-Z]/g, '')
  if (cleaned.length === 6) {
    return { base: cleaned.slice(0, 3), quote: cleaned.slice(3, 6) }
  }
  const parts = pair.toUpperCase().split(/[/\-_]/)
  if (parts.length === 2 && parts[0].length === 3 && parts[1].length === 3) {
    return { base: parts[0], quote: parts[1] }
  }
  return null
}

export function normalizeCurrencyPair(pair: string): string {
  const parsed = parseCurrencyPair(pair)
  if (!parsed) return pair.toUpperCase()
  return `${parsed.base}/${parsed.quote}`
}

// ── Currency flag emoji ───────────────────────────────────

const CURRENCY_FLAGS: Record<string, string> = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', CAD: '🇨🇦',
  JPY: '🇯🇵', AUD: '🇦🇺', CHF: '🇨🇭', SEK: '🇸🇪',
  NOK: '🇳🇴', DKK: '🇩🇰', NZD: '🇳🇿', SGD: '🇸🇬',
  HKD: '🇭🇰', CNY: '🇨🇳', MXN: '🇲🇽', BRL: '🇧🇷',
}

export function currencyFlag(code: string): string {
  return CURRENCY_FLAGS[code.toUpperCase()] ?? '💱'
}

// ── Chart colors ──────────────────────────────────────────

export const CHART_COLORS = [
  '#00c8a0', '#3b82f6', '#8b5cf6', '#f59e0b',
  '#ef4444', '#06b6d4', '#84cc16', '#f97316',
]

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]
}
