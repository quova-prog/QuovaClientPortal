import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts'
import { Plus, ChevronDown, ChevronRight, Star, MoreHorizontal, Download, FileText, Filter } from 'lucide-react'
import { HedgeAccountingExport } from '@/components/analytics/HedgeAccountingExport'
import { HedgeEffectivenessPanel } from '@/components/analytics/HedgeEffectivenessPanel'
import { BoardReportPanel } from '@/components/analytics/BoardReportPanel'
import { useHedgePositions, useExposures, useExposureSummary, useFxRates, useDashboardMetrics, useHedgePolicy } from '@/hooks/useData'
import { useCombinedCoverage, type CombinedCoverage } from '@/hooks/useCombinedCoverage'
import { useDerivedExposures, type DerivedExposure } from '@/hooks/useDerivedExposures'
import { useCashFlows, type CashFlowEntry } from '@/hooks/useCashFlows'
import { useAuth } from '@/hooks/useAuth'
import { useAuditLog } from '@/hooks/useAuditLog'
import { useEntity } from '@/context/EntityContext'
import { formatCurrency } from '@/lib/utils'
import { toUsd } from '@/lib/fx'
import type { HedgePosition, FxExposure, ExposureSummary } from '@/types'


type TabKey = 'hedgeview' | 'reports' | 'hedge_accounting' | 'effectiveness' | 'board_report'
type Period = 'yesterday' | 'month_end' | 'ytd' | 'all'

const PAIR_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#84cc16']

// ── Report definitions ────────────────────────────────────────────────────────

type DataSource = 'positions' | 'exposures' | 'summary'

interface ReportDef {
  name: string
  icon: string
  source: DataSource
  /** Optional secondary filter label shown as badge */
  badge?: string
}

const FX_REPORTS: ReportDef[] = [
  { name: 'FX Counterparty Risk Measures', icon: '📊', source: 'positions' },
  { name: 'FX Foreign Currency Accounts',  icon: '🏦', source: 'summary'   },
  { name: 'FX Exposure Report (EUR)',       icon: '📈', source: 'exposures', badge: 'EUR' },
  { name: 'FX Exposure Report (USD)',       icon: '📈', source: 'exposures', badge: 'USD' },
  { name: 'FX Trade Balance Report',        icon: '⚖️', source: 'positions' },
  { name: 'FX Journal Entry Report (Q1)',   icon: '📝', source: 'positions', badge: 'Q1' },
  { name: 'FX Journal Entry Report (Q2)',   icon: '📝', source: 'positions', badge: 'Q2' },
  { name: 'FX Journal Entry Report (YTD)',  icon: '📝', source: 'positions', badge: 'YTD' },
]

// ── CSV helpers ───────────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map(r => headers.map(h => csvEscape(r[h])).join(',')),
  ]
  return lines.join('\n')
}

function triggerDownload(filename: string, content: string, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['\uFEFF' + content], { type: mime }) // BOM for Excel UTF-8
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Period filtering ──────────────────────────────────────────────────────────

function filterByPeriod<T extends { trade_date?: string; created_at?: string }>(
  items: T[], period: Period
): T[] {
  if (period === 'all') return items
  const now   = new Date()
  const today = now.toISOString().split('T')[0]
  const year  = now.getFullYear()

  return items.filter(item => {
    const dateStr = item.trade_date ?? item.created_at ?? ''
    const d = new Date(dateStr)
    if (period === 'yesterday') {
      const yest = new Date(now); yest.setDate(yest.getDate() - 1)
      return dateStr.startsWith(yest.toISOString().split('T')[0])
    }
    if (period === 'month_end') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }
    if (period === 'ytd') {
      return d.getFullYear() === year
    }
    return true
  })
}

// ── Report CSV generators ─────────────────────────────────────────────────────

function buildCounterpartyRisk(positions: HedgePosition[]): Record<string, unknown>[] {
  const groups: Record<string, { counterparty: string; count: number; total_notional: number; pairs: Set<string> }> = {}
  for (const p of positions) {
    const k = p.counterparty_bank ?? 'Unknown'
    if (!groups[k]) groups[k] = { counterparty: k, count: 0, total_notional: 0, pairs: new Set() }
    groups[k].count++
    groups[k].total_notional += p.notional_base
    groups[k].pairs.add(p.currency_pair)
  }
  return Object.values(groups).map(g => ({
    Counterparty:       g.counterparty,
    'Trade Count':      g.count,
    'Total Notional':   g.total_notional.toFixed(2),
    'Currency Pairs':   [...g.pairs].join('; '),
    'Concentration %':  positions.length ? ((g.count / positions.length) * 100).toFixed(1) + '%' : '0%',
  }))
}

function buildForeignCurrencyAccounts(summary: ExposureSummary[]): Record<string, unknown>[] {
  return summary.map(s => ({
    'Currency Pair':        s.currency_pair,
    'Base Currency':        s.base_currency,
    'Total Receivable':     s.total_receivable.toFixed(2),
    'Total Payable':        s.total_payable.toFixed(2),
    'Net Exposure':         s.net_exposure.toFixed(2),
    'Exposure Count':       s.exposure_count,
    'Earliest Settlement':  s.earliest_settlement,
    'Latest Settlement':    s.latest_settlement,
  }))
}

function buildExposureReport(exposures: FxExposure[], ccyFilter?: string): Record<string, unknown>[] {
  const rows = ccyFilter
    ? exposures.filter(e => e.base_currency === ccyFilter || e.quote_currency === ccyFilter)
    : exposures
  return rows.map(e => ({
    'Entity':           e.entity,
    'Currency Pair':    e.currency_pair,
    'Direction':        e.direction,
    'Notional (Base)':  e.notional_base.toFixed(2),
    'Base Currency':    e.base_currency,
    'Settlement Date':  e.settlement_date,
    'Status':           e.status,
    'Description':      e.description ?? '',
    'Source System':    e.source_system,
  }))
}

function buildTradeBalance(positions: HedgePosition[]): Record<string, unknown>[] {
  const groups: Record<string, { pair: string; buys: number; sells: number; buy_notional: number; sell_notional: number }> = {}
  for (const p of positions) {
    if (!groups[p.currency_pair]) groups[p.currency_pair] = { pair: p.currency_pair, buys: 0, sells: 0, buy_notional: 0, sell_notional: 0 }
    if (p.direction === 'buy')  { groups[p.currency_pair].buys++;  groups[p.currency_pair].buy_notional  += p.notional_base }
    else                        { groups[p.currency_pair].sells++; groups[p.currency_pair].sell_notional += p.notional_base }
  }
  return Object.values(groups).map(g => ({
    'Currency Pair':    g.pair,
    'Buy Count':        g.buys,
    'Sell Count':       g.sells,
    'Buy Notional':     g.buy_notional.toFixed(2),
    'Sell Notional':    g.sell_notional.toFixed(2),
    'Net Position':     (g.buy_notional - g.sell_notional).toFixed(2),
  }))
}

function buildJournalEntries(positions: HedgePosition[], quarterFilter?: string): Record<string, unknown>[] {
  let rows = positions
  if (quarterFilter) {
    const qMap: Record<string, [number, number]> = {
      Q1: [1, 3], Q2: [4, 6], Q3: [7, 9], Q4: [10, 12],
    }
    const [startM, endM] = qMap[quarterFilter] ?? [1, 12]
    rows = positions.filter(p => {
      const m = new Date(p.trade_date).getMonth() + 1
      return m >= startM && m <= endM
    })
  }
  return rows.map((p, i) => ({
    'Journal #':       `JE-${String(i + 1).padStart(4, '0')}`,
    'Trade Date':      p.trade_date,
    'Value Date':      p.value_date,
    'Instrument':      p.instrument_type,
    'Currency Pair':   p.currency_pair,
    'Direction':       p.direction,
    'Notional':        p.notional_base.toFixed(2),
    'Contracted Rate': p.contracted_rate.toFixed(6),
    'Counterparty':    p.counterparty_bank ?? '',
    'Reference':       p.reference_number ?? '',
    'Dr Account':      p.direction === 'buy'  ? 'FX Asset'     : 'FX Liability',
    'Cr Account':      p.direction === 'buy'  ? 'Cash / Bank'  : 'FX Asset',
    'Status':          p.status,
  }))
}

// ── Main generator ────────────────────────────────────────────────────────────

function generateReportRows(
  report: ReportDef,
  period: Period,
  positions: HedgePosition[],
  exposures: FxExposure[],
  summary:   ExposureSummary[],
): Record<string, unknown>[] {
  const filteredPos = filterByPeriod(positions, period)
  const filteredExp = filterByPeriod(exposures.map(e => ({ ...e, trade_date: e.created_at })), period)

  if (report.name.startsWith('FX Counterparty'))          return buildCounterpartyRisk(filteredPos)
  if (report.name.startsWith('FX Foreign'))               return buildForeignCurrencyAccounts(summary)
  if (report.name.startsWith('FX Exposure Report (EUR)')) return buildExposureReport(filteredExp, 'EUR')
  if (report.name.startsWith('FX Exposure Report (USD)')) return buildExposureReport(filteredExp, 'USD')
  if (report.name.startsWith('FX Trade Balance'))         return buildTradeBalance(filteredPos)
  if (report.name.includes('Q1'))                         return buildJournalEntries(filteredPos, 'Q1')
  if (report.name.includes('Q2'))                         return buildJournalEntries(filteredPos, 'Q2')
  if (report.name.includes('YTD'))                        return buildJournalEntries(filteredPos)
  return []
}

// ── Utility ───────────────────────────────────────────────────────────────────

function formatCurrencyShort(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v}`
}

const PERIOD_LABELS: Record<Period, string> = {
  yesterday: 'Yesterday',
  month_end: 'Month End',
  ytd:       'YTD',
  all:       'All Time',
}

// ── Excel download ────────────────────────────────────────────────────────────

async function triggerXlsx(filename: string, rows: Record<string, unknown>[]) {
  const ExcelJS = await import('exceljs')
  const { saveAs } = await import('file-saver')
  const data = rows.length > 0 ? rows : [{ Note: 'No data found for this report.' }]
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Report')
  if (data.length > 0) {
    ws.columns = Object.keys(data[0]).map(key => ({ header: key, key }))
    ws.addRows(data)
  }
  const buffer = await wb.xlsx.writeBuffer()
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename)
}

// ── Custom Report definitions ─────────────────────────────────────────────────

type CrAudience = 'cfo_board' | 'treasurer' | 'compliance' | 'fx_ops'

interface CustomReportDef {
  id: string
  name: string
  description: string
  audience: CrAudience
  icon: string
  hasCcy?: boolean
  hasDate?: boolean
}

const CUSTOM_REPORTS: CustomReportDef[] = [
  // CFO / Board
  { id: 'exec_fx_risk',    name: 'Executive FX Risk Summary',  description: 'Exposure, coverage, unhedged amount and estimated P&L at risk by currency pair.',        audience: 'cfo_board',   icon: '📊', hasCcy: true  },
  { id: 'qoq_trend',       name: 'QoQ Coverage Trend',         description: 'Quarter-over-quarter exposure vs hedged notional and coverage % trend.',                   audience: 'cfo_board',   icon: '📈', hasDate: true },
  // Treasurer
  { id: 'maturity',        name: 'Hedge Maturity Schedule',    description: 'All hedge positions sorted by maturity date with days-to-maturity and instrument detail.',  audience: 'treasurer',   icon: '📅', hasCcy: true, hasDate: true },
  { id: 'net_open',        name: 'Net Open Position',          description: 'Unhedged exposure by currency pair vs policy thresholds.',                                  audience: 'treasurer',   icon: '⚖️', hasCcy: true  },
  { id: 'mtm',             name: 'Mark-to-Market Valuation',   description: 'Unrealized P&L per trade vs current live rates.',                                           audience: 'treasurer',   icon: '💹', hasCcy: true, hasDate: true },
  { id: 'cf_hedge',        name: 'Cash Flow vs Hedge Coverage', description: 'Monthly cash inflows/outflows vs hedge notional and coverage %.',                          audience: 'treasurer',   icon: '🔄', hasDate: true },
  // Auditor / Compliance
  { id: 'policy',          name: 'Policy Compliance Report',   description: 'Coverage % per currency pair vs min/max policy thresholds with breach flags.',              audience: 'compliance',  icon: '✅', hasCcy: true  },
  { id: 'audit_log',       name: 'Audit Activity Log',         description: 'All system actions (logins, uploads, exports, data changes) with user and timestamp.',       audience: 'compliance',  icon: '🔍', hasDate: true },
  // FX Operations
  { id: 'blotter',         name: 'Trade Blotter',              description: 'Full trade blotter with instrument, direction, notional, rate, counterparty and status.',    audience: 'fx_ops',      icon: '📋', hasCcy: true, hasDate: true },
  { id: 'fx_detail',       name: 'FX Exposure Detail',         description: 'Granular exposure rows from all sources: DB records and uploaded CSV data.',                 audience: 'fx_ops',      icon: '🗂️', hasCcy: true, hasDate: true },
]

const AUDIENCE_META: Record<CrAudience, { label: string; color: string }> = {
  cfo_board:  { label: 'CFO / Board',           color: '#6366f1' },
  treasurer:  { label: 'Treasurer',             color: '#0d9488' },
  compliance: { label: 'Auditor / Compliance',  color: '#d97706' },
  fx_ops:     { label: 'FX Operations',         color: '#8b5cf6' },
}

const AUDIENCE_ORDER: CrAudience[] = ['cfo_board', 'treasurer', 'compliance', 'fx_ops']

// ── Custom Report generators ──────────────────────────────────────────────────

function crBuildExecFxRisk(cc: CombinedCoverage[], fxRates: Record<string, number>, ccy: string): Record<string, unknown>[] {
  const rows = ccy !== 'all' ? cc.filter(c => c.currency_pair.includes(ccy)) : cc
  return rows.map(c => {
    const expUsd = toUsd(Math.abs(c.net_exposure), c.base_currency, fxRates)
    const hedUsd = toUsd(c.total_hedged, c.base_currency, fxRates)
    const pct    = expUsd > 0 ? (hedUsd / expUsd * 100) : 0
    const unhed  = Math.max(0, expUsd - hedUsd)
    return {
      'Currency Pair':         c.currency_pair,
      'Direction':             c.net_exposure >= 0 ? 'Receivable' : 'Payable',
      'Net Exposure (USD)':    expUsd.toFixed(0),
      'Hedged (USD)':          hedUsd.toFixed(0),
      'Coverage %':            pct.toFixed(1) + '%',
      'Unhedged (USD)':        unhed.toFixed(0),
      'P&L at Risk (5% move)': (unhed * 0.05).toFixed(0),
      'Policy Status':         pct >= 70 ? 'Compliant' : 'Breach',
    }
  })
}

function crBuildQoQTrend(derExp: DerivedExposure[], positions: HedgePosition[], fxRates: Record<string, number>, from: string, to: string): Record<string, unknown>[] {
  const quarters: Record<string, { period: string; exposure: number; hedged: number }> = {}
  for (const e of derExp) {
    if (from && e.settlement_date < from) continue
    if (to   && e.settlement_date > to  ) continue
    const d = new Date(e.settlement_date || Date.now())
    const q = `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`
    if (!quarters[q]) quarters[q] = { period: q, exposure: 0, hedged: 0 }
    quarters[q].exposure += toUsd(e.notional_base, e.base_currency, fxRates)
  }
  for (const p of positions) {
    const d = new Date(p.value_date || p.trade_date)
    const q = `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`
    if (!quarters[q]) quarters[q] = { period: q, exposure: 0, hedged: 0 }
    quarters[q].hedged += toUsd(p.notional_base, p.base_currency, fxRates)
  }
  return Object.values(quarters)
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(q => ({
      'Quarter':          q.period,
      'Total Exposure':   q.exposure.toFixed(0),
      'Hedged (USD)':     q.hedged.toFixed(0),
      'Coverage %':       q.exposure > 0 ? (q.hedged / q.exposure * 100).toFixed(1) + '%' : '—',
    }))
}

function crBuildMaturity(positions: HedgePosition[], fxRates: Record<string, number>, from: string, to: string, ccy: string): Record<string, unknown>[] {
  let rows = positions
  if (from) rows = rows.filter(p => p.value_date >= from)
  if (to)   rows = rows.filter(p => p.value_date <= to)
  if (ccy !== 'all') rows = rows.filter(p => p.currency_pair.includes(ccy))
  const today = Date.now()
  return rows
    .sort((a, b) => a.value_date.localeCompare(b.value_date))
    .map((p, i) => ({
      'Maturity Date':    p.value_date,
      'Days to Maturity': Math.round((new Date(p.value_date).getTime() - today) / 86400000),
      'Currency Pair':    p.currency_pair,
      'Direction':        p.direction,
      'Notional':         p.notional_base.toFixed(2),
      'Contracted Rate':  p.contracted_rate.toFixed(6),
      'Instrument':       p.instrument_type,
      'Counterparty':     p.counterparty_bank ?? '',
      'Reference':        p.reference_number ?? `TRD-${String(i + 1).padStart(4, '0')}`,
      'Status':           p.status,
      'Notional (USD)':   toUsd(p.notional_base, p.base_currency, fxRates).toFixed(0),
    }))
}

function crBuildNetOpen(cc: CombinedCoverage[], fxRates: Record<string, number>, ccy: string): Record<string, unknown>[] {
  const rows = ccy !== 'all' ? cc.filter(c => c.currency_pair.includes(ccy)) : cc
  return rows.map(c => ({
    'Currency Pair':      c.currency_pair,
    'Base Currency':      c.base_currency,
    'Net Exposure (USD)': toUsd(Math.abs(c.net_exposure), c.base_currency, fxRates).toFixed(0),
    'Hedged (USD)':       toUsd(c.total_hedged,           c.base_currency, fxRates).toFixed(0),
    'Net Open (USD)':     toUsd(c.unhedged_amount,        c.base_currency, fxRates).toFixed(0),
    'Coverage %':         c.coverage_pct.toFixed(1) + '%',
    'Earliest Settlement': c.earliest_settlement,
    'Latest Settlement':   c.latest_settlement,
  }))
}

function crBuildMtm(positions: HedgePosition[], fxRates: Record<string, number>, from: string, to: string, ccy: string): Record<string, unknown>[] {
  let rows = positions
  if (from) rows = rows.filter(p => p.trade_date >= from)
  if (to)   rows = rows.filter(p => p.trade_date <= to)
  if (ccy !== 'all') rows = rows.filter(p => p.currency_pair.includes(ccy))
  return rows.map((p, i) => {
    const current = fxRates[p.currency_pair] ?? p.contracted_rate
    const diff    = p.direction === 'buy' ? current - p.contracted_rate : p.contracted_rate - current
    let pnl       = diff * p.notional_base
    // Convert to USD for USD-base pairs (e.g. USD/JPY: raw P&L is in JPY)
    const isUsdBase = p.currency_pair.startsWith('USD/')
    if (isUsdBase && current > 0) pnl = pnl / current
    return {
      'Reference':         p.reference_number ?? `TRD-${String(i + 1).padStart(4, '0')}`,
      'Trade Date':        p.trade_date,
      'Maturity Date':     p.value_date,
      'Currency Pair':     p.currency_pair,
      'Direction':         p.direction,
      'Notional':          p.notional_base.toFixed(2),
      'Contracted Rate':   p.contracted_rate.toFixed(6),
      'Current Rate':      current.toFixed(6),
      'Unrealized P&L (USD)': pnl.toFixed(2),
      'P&L Direction':     pnl >= 0 ? 'Gain' : 'Loss',
      'Instrument':        p.instrument_type,
      'Status':            p.status,
    }
  })
}

function crBuildCfHedge(flows: CashFlowEntry[], positions: HedgePosition[], fxRates: Record<string, number>, from: string, to: string): Record<string, unknown>[] {
  const months: Record<string, { period: string; inflows: number; outflows: number; hedged: number }> = {}
  for (const f of flows) {
    if (from && f.flow_date < from) continue
    if (to   && f.flow_date > to  ) continue
    const d   = new Date(f.flow_date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!months[key]) months[key] = { period: key, inflows: 0, outflows: 0, hedged: 0 }
    const usd = toUsd(Math.abs(f.amount), f.currency, fxRates)
    if (f.amount > 0) months[key].inflows += usd
    else              months[key].outflows += usd
  }
  for (const p of positions) {
    if (from && p.value_date < from) continue
    if (to   && p.value_date > to  ) continue
    const d   = new Date(p.value_date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!months[key]) months[key] = { period: key, inflows: 0, outflows: 0, hedged: 0 }
    months[key].hedged += toUsd(p.notional_base, p.base_currency, fxRates)
  }
  return Object.values(months)
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(m => {
      const net      = m.inflows - m.outflows
      const coverage = Math.abs(net) > 0 ? (m.hedged / Math.abs(net) * 100) : 0
      return {
        'Period (YYYY-MM)':      m.period,
        'Cash Inflows (USD)':    m.inflows.toFixed(0),
        'Cash Outflows (USD)':   m.outflows.toFixed(0),
        'Net Cash Flow (USD)':   net.toFixed(0),
        'Hedge Notional (USD)':  m.hedged.toFixed(0),
        'Hedge Coverage %':      coverage.toFixed(1) + '%',
      }
    })
}

function crBuildPolicy(cc: CombinedCoverage[], fxRates: Record<string, number>, ccy: string): Record<string, unknown>[] {
  const POLICY_MIN = 70; const POLICY_MAX = 100
  const rows = ccy !== 'all' ? cc.filter(c => c.currency_pair.includes(ccy)) : cc
  return rows.map(c => {
    const pct    = c.coverage_pct
    const breach = pct < POLICY_MIN ? 'Under-hedged' : pct > POLICY_MAX ? 'Over-hedged' : null
    return {
      'Currency Pair':      c.currency_pair,
      'Net Exposure (USD)': toUsd(Math.abs(c.net_exposure), c.base_currency, fxRates).toFixed(0),
      'Hedged (USD)':       toUsd(c.total_hedged,           c.base_currency, fxRates).toFixed(0),
      'Coverage %':         pct.toFixed(1) + '%',
      'Policy Min':         POLICY_MIN + '%',
      'Policy Max':         POLICY_MAX + '%',
      'In Policy':          breach ? 'No'  : 'Yes',
      'Breach Type':        breach ?? '—',
    }
  })
}

function crBuildBlotter(positions: HedgePosition[], from: string, to: string, ccy: string): Record<string, unknown>[] {
  let rows = positions
  if (from) rows = rows.filter(p => p.trade_date >= from)
  if (to)   rows = rows.filter(p => p.trade_date <= to)
  if (ccy !== 'all') rows = rows.filter(p => p.currency_pair.includes(ccy))
  return rows
    .sort((a, b) => b.trade_date.localeCompare(a.trade_date))
    .map((p, i) => ({
      'Trade Date':      p.trade_date,
      'Value Date':      p.value_date,
      'Reference':       p.reference_number ?? `TRD-${String(i + 1).padStart(4, '0')}`,
      'Instrument':      p.instrument_type,
      'Currency Pair':   p.currency_pair,
      'Direction':       p.direction,
      'Notional':        p.notional_base.toFixed(2),
      'Contracted Rate': p.contracted_rate.toFixed(6),
      'Counterparty':    p.counterparty_bank ?? '',
      'Status':          p.status,
    }))
}

function crBuildFxDetail(exposures: FxExposure[], derExp: DerivedExposure[], from: string, to: string, ccy: string): Record<string, unknown>[] {
  const combined = [
    ...exposures.map(e => ({ entity: e.entity, pair: e.currency_pair, direction: e.direction, notional: e.notional_base, currency: e.base_currency, settlement: e.settlement_date, status: e.status, source: e.source_system })),
    ...derExp.map(e    => ({ entity: '',        pair: e.currency_pair, direction: e.direction, notional: e.notional_base, currency: e.base_currency, settlement: e.settlement_date, status: 'active',    source: e.source        })),
  ]
  let rows = combined
  if (from) rows = rows.filter(r => r.settlement >= from)
  if (to)   rows = rows.filter(r => r.settlement <= to)
  if (ccy !== 'all') rows = rows.filter(r => r.pair.includes(ccy))
  return rows.map(r => ({
    'Entity':          r.entity,
    'Currency Pair':   r.pair,
    'Direction':       r.direction,
    'Notional':        r.notional.toFixed(2),
    'Currency':        r.currency,
    'Settlement Date': r.settlement,
    'Status':          r.status,
    'Source':          r.source,
  }))
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AnalyticsPage() {
  const [tab,           setTab          ] = useState<TabKey>('hedgeview')
  const [fxReportOpen,  setFxReportOpen ] = useState(true)
  const [periods,       setPeriods      ] = useState<Record<number, Period>>({})
  const [downloading,   setDownloading  ] = useState<number | null>(null)
  const [downloaded,    setDownloaded   ] = useState<Set<number>>(new Set())
  const [starred,       setStarred      ] = useState<Set<number>>(new Set())
  const [openDropdown,  setOpenDropdown ] = useState<number | null>(null)

  // Custom Reports state
  const [crFrom,        setCrFrom       ] = useState('')
  const [crTo,          setCrTo         ] = useState('')
  const [crCcy,         setCrCcy        ] = useState('all')
  const [crDl,          setCrDl         ] = useState<string | null>(null)
  const [crDone,        setCrDone       ] = useState<Set<string>>(new Set())
  const [crDropdown,    setCrDropdown   ] = useState<string | null>(null)
  const [auditLogs,     setAuditLogs    ] = useState<Record<string, unknown>[]>([])

  const { positions } = useHedgePositions()
  const { exposures } = useExposures()
  const { summary   } = useExposureSummary()
  const { rates: fxRates }            = useFxRates()
  const { combinedCoverage }          = useCombinedCoverage()
  const { derivedExposures: allDerivedExposures } = useDerivedExposures()
  const { flows                      }            = useCashFlows()
  const { currentEntityId, isConsolidated }       = useEntity()
  const { user, db }                              = useAuth()
  const { log }                                   = useAuditLog()
  const { metrics }                               = useDashboardMetrics()
  const { policy }                                = useHedgePolicy()

  // Filter derived exposures by entity when one is selected
  const derivedExposures = useMemo(() =>
    isConsolidated
      ? allDerivedExposures
      : allDerivedExposures.filter(e => e.entity_id === currentEntityId),
  [allDerivedExposures, isConsolidated, currentEntityId])

  // Entity-filtered cash flows for custom reports
  const entityFlows = useMemo(() =>
    isConsolidated ? flows : flows.filter(f => f.entity_id === currentEntityId),
  [flows, isConsolidated, currentEntityId])

  // Lazy-load audit logs when Custom Reports tab is active
  const fetchAuditLogs = useCallback(async () => {
    const orgId = user?.profile?.org_id
    if (!orgId || !db) return
    const { data } = await db
      .from('audit_logs')
      .select('created_at, user_email, action, resource, summary')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(500)
    if (data) {
      setAuditLogs(data.map((r: any) => ({
        'Timestamp':   new Date(r.created_at).toLocaleString(),
        'User':        r.user_email ?? '—',
        'Action':      r.action,
        'Resource':    r.resource,
        'Description': r.summary,
      })))
    }
  }, [user, db])

  useEffect(() => {
    if (tab === 'reports' && auditLogs.length === 0) { fetchAuditLogs() }
  }, [tab, auditLogs.length, fetchAuditLogs])

  // Derive available currencies for filter dropdown
  const availableCurrencies = useMemo(() => {
    const ccys = new Set<string>()
    combinedCoverage.forEach(c => ccys.add(c.base_currency))
    positions.forEach(p => ccys.add(p.base_currency))
    return Array.from(ccys).sort()
  }, [combinedCoverage, positions])

  // Custom report download handler
  async function handleCrDownload(reportId: string, format: 'csv' | 'xlsx') {
    setCrDl(reportId)
    setCrDropdown(null)
    await new Promise(r => setTimeout(r, 80))

    let rows: Record<string, unknown>[] = []
    const from = crFrom; const to = crTo; const ccy = crCcy

    if (reportId === 'exec_fx_risk') rows = crBuildExecFxRisk(combinedCoverage, fxRates, ccy)
    else if (reportId === 'qoq_trend')    rows = crBuildQoQTrend(derivedExposures, positions, fxRates, from, to)
    else if (reportId === 'maturity')     rows = crBuildMaturity(positions, fxRates, from, to, ccy)
    else if (reportId === 'net_open')     rows = crBuildNetOpen(combinedCoverage, fxRates, ccy)
    else if (reportId === 'mtm')          rows = crBuildMtm(positions, fxRates, from, to, ccy)
    else if (reportId === 'cf_hedge')     rows = crBuildCfHedge(entityFlows, positions, fxRates, from, to)
    else if (reportId === 'policy')       rows = crBuildPolicy(combinedCoverage, fxRates, ccy)
    else if (reportId === 'audit_log')    rows = auditLogs
    else if (reportId === 'blotter')      rows = crBuildBlotter(positions, from, to, ccy)
    else if (reportId === 'fx_detail')    rows = crBuildFxDetail(exposures, derivedExposures, from, to, ccy)

    const safeName = CUSTOM_REPORTS.find(r => r.id === reportId)?.name.replace(/[^a-z0-9]/gi, '_') ?? reportId
    if (format === 'xlsx') await triggerXlsx(`${safeName}.xlsx`, rows)
    else triggerDownload(`${safeName}.csv`, toCsv(rows.length ? rows : [{ Note: `No data for "${safeName}"` }]))
    await log({
      action: 'export',
      resource: 'custom_report',
      resource_id: reportId,
      summary: `Exported custom report ${reportId} as ${format}`,
      metadata: {
        format,
        row_count: rows.length,
        from: from || null,
        to: to || null,
        currency: ccy,
      },
    })

    setCrDl(null)
    setCrDone(prev => new Set([...prev, reportId]))
    setTimeout(() => setCrDone(prev => { const n = new Set(prev); n.delete(reportId); return n }), 2000)
  }

  // ── Assets & Liabilities chart: receivables / payables / hedged by settlement quarter ──
  const assetsData = useMemo(() => {
    const quarters: Record<string, { period: string; receivables: number; payables: number; hedged: number }> = {}
    // Derived exposures bucketed by settlement quarter
    for (const exp of derivedExposures) {
      const d = new Date(exp.settlement_date || new Date())
      const q = `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`
      if (!quarters[q]) quarters[q] = { period: q, receivables: 0, payables: 0, hedged: 0 }
      const usd = toUsd(exp.notional_base, exp.base_currency, fxRates)
      if (exp.direction === 'receivable') quarters[q].receivables += usd
      else                                quarters[q].payables    += usd
    }
    // Hedge positions bucketed by value_date (maturity) quarter
    for (const p of positions) {
      const d = new Date(p.value_date || p.trade_date)
      const q = `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`
      if (!quarters[q]) quarters[q] = { period: q, receivables: 0, payables: 0, hedged: 0 }
      quarters[q].hedged += toUsd(p.notional_base, p.base_currency, fxRates)
    }
    return Object.values(quarters)
      .sort((a, b) => a.period.localeCompare(b.period))
      .map(q => ({ period: q.period, receivables: Math.round(q.receivables), payables: Math.round(q.payables), hedged: Math.round(q.hedged) }))
  }, [derivedExposures, positions, fxRates])

  // ── Legend: one entry per active currency pair ────────────────────────────
  const assetLegend = useMemo(() =>
    combinedCoverage.slice(0, 8).map((c, i) => ({
      name:  `${c.currency_pair} — ${c.net_exposure >= 0 ? 'Receivable' : 'Payable'}`,
      color: PAIR_COLORS[i % PAIR_COLORS.length],
    }))
  , [combinedCoverage])

  // ── KPI totals from combinedCoverage ─────────────────────────────────────
  const totalExposureUsd = useMemo(() =>
    combinedCoverage.reduce((s, c) => s + toUsd(Math.abs(c.net_exposure), c.base_currency, fxRates), 0)
  , [combinedCoverage, fxRates])

  const totalHedgedUsd = useMemo(() =>
    combinedCoverage.reduce((s, c) => s + toUsd(c.total_hedged, c.base_currency, fxRates), 0)
  , [combinedCoverage, fxRates])

  const coveragePct    = totalExposureUsd > 0 ? (totalHedgedUsd / totalExposureUsd) * 100 : 0
  const unhedgedUsd    = Math.max(0, totalExposureUsd - totalHedgedUsd)

  // ── Mark-to-Market P&L per month (unrealised, vs live rates) ─────────────
  const mimData = useMemo(() => {
    if (positions.length === 0 || Object.keys(fxRates).length === 0) return []
    const months: Record<string, { period: string; fwd_mim: number; opt_mim: number }> = {}
    positions.forEach(p => {
      const d = new Date(p.trade_date)
      const key = `${d.toLocaleString('default', { month: 'short' })} ${d.getFullYear()}`
      if (!months[key]) months[key] = { period: key, fwd_mim: 0, opt_mim: 0 }
      const currentRate = fxRates[p.currency_pair] ?? p.contracted_rate
      // Direction-aware P&L: sell hedge gains when contracted > current, buy hedge gains when current > contracted
      const diff = p.direction === 'buy'
        ? currentRate - p.contracted_rate
        : p.contracted_rate - currentRate
      let pnl = diff * p.notional_base
      // Convert to USD for cross-currency aggregation
      const isUsdBase = p.currency_pair.startsWith('USD/')
      if (isUsdBase && currentRate > 0) pnl = pnl / currentRate
      if (p.instrument_type === 'option') months[key].opt_mim += pnl
      else                                months[key].fwd_mim += pnl
    })
    return Object.values(months).sort((a, b) => a.period.localeCompare(b.period))
  }, [positions, fxRates])

  const tabs: { key: TabKey; label: string; badge?: string }[] = [
    { key: 'hedgeview',        label: 'Hedge View'           },
    { key: 'reports',          label: 'Custom Reports'       },
    { key: 'hedge_accounting', label: 'Hedge Accounting'     },
    { key: 'effectiveness',    label: 'Effectiveness Testing', badge: 'ASC 815 / IFRS 9' },
    { key: 'board_report',     label: 'Board Package',        badge: 'New' },
  ]

  function getPeriod(i: number): Period { return periods[i] ?? 'all' }

  function setPeriod(i: number, p: Period) {
    setPeriods(prev => ({ ...prev, [i]: p }))
  }

  async function handleDownload(i: number, format: 'csv') {
    setDownloading(i)
    setOpenDropdown(null)

    // Small delay lets the spinner render
    await new Promise(r => setTimeout(r, 120))

    const report = FX_REPORTS[i]
    const period = getPeriod(i)
    const rows   = generateReportRows(report, period, positions, exposures, summary)

    if (rows.length === 0) {
      // Still download an empty CSV with headers so the user knows it worked
      const emptyRow = { Note: `No data found for "${report.name}" with period: ${PERIOD_LABELS[period]}` }
      triggerDownload(`${report.name.replace(/[^a-z0-9]/gi, '_')}_${period}.csv`, toCsv([emptyRow]))
    } else {
      triggerDownload(`${report.name.replace(/[^a-z0-9]/gi, '_')}_${period}.csv`, toCsv(rows))
    }
    await log({
      action: 'export',
      resource: 'fx_report',
      resource_id: report.name,
      summary: `Exported FX report ${report.name} as csv`,
      metadata: {
        period,
        row_count: rows.length,
      },
    })

    setDownloading(null)
    setDownloaded(prev => new Set([...prev, i]))
    // Clear the "done" checkmark after 2 seconds
    setTimeout(() => setDownloaded(prev => { const n = new Set(prev); n.delete(i); return n }), 2000)
  }

  return (
    <div className="fade-in" onClick={() => setOpenDropdown(null)}>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Analytics & Reporting</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>Portfolio-level hedge performance and risk reports</p>
        </div>
        <button className="btn btn-primary btn-sm"><Plus size={13} /> New Report</button>
      </div>

      <div style={{ padding: '1.5rem 1.5rem 0' }}>
        <div className="tab-bar">
          {tabs.map(t => (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              {t.label}
              {t.badge && (
                <span style={{
                  fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.375rem',
                  borderRadius: 10, background: tab === t.key ? 'rgba(255,255,255,0.2)' : 'var(--bg-surface)',
                  border: '1px solid var(--border)', color: tab === t.key ? '#fff' : 'var(--text-muted)',
                  letterSpacing: '0.03em',
                }}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 1.5rem 1.5rem' }}>

        {/* ── HEDGE VIEW TAB ──────────────────────────────────────────── */}
        {tab === 'hedgeview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>

              {/* Assets & Liabilities */}
              <div className="card" style={{ padding: 0 }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Assets & Liabilities</span>
                </div>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                  {[
                    { label: 'Total Exposure',  value: totalExposureUsd > 0 ? formatCurrency(totalExposureUsd, 'USD', true) : '—', color: 'var(--text-primary)' },
                    { label: 'Unhedged',        value: totalExposureUsd > 0 ? formatCurrency(unhedgedUsd, 'USD', true)      : '—', color: unhedgedUsd > 0 ? 'var(--red)' : 'var(--green)' },
                    { label: 'Coverage',        value: totalExposureUsd > 0 ? `${coveragePct.toFixed(1)}%`                  : '—', color: 'var(--teal)'         },
                    { label: 'Active Hedges',   value: `${positions.length}`,                                                      color: '#6366f1'             },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: s.color, fontFamily: 'var(--font-mono)' }}>{s.value}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '0.625rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                  {assetLegend.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
                      {assetLegend.map(a => (
                        <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: a.color, flexShrink: 0 }} />
                          {a.name}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>Upload exposure data to see currency breakdown</p>
                  )}
                </div>
                <div style={{ padding: '1rem', height: 200 }}>
                  {assetsData.length === 0 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0 0 0.5rem', textAlign: 'center' }}>
                      Upload exposure data or add hedge positions to see chart
                    </div>
                  )}
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={assetsData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={formatCurrencyShort} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} formatter={formatCurrencyShort} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="receivables" name="Receivables" fill="#0ea5e9" radius={[3,3,0,0]} />
                      <Bar dataKey="payables"    name="Payables"    fill="#f59e0b" radius={[3,3,0,0]} />
                      <Bar dataKey="hedged"      name="Hedged"      fill="var(--teal)" radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Mark to Market */}
              <div className="card" style={{ padding: 0 }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Mark to Market (MIM)</span>
                </div>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                  {(() => {
                    const totalFwdMim = mimData.reduce((s, m) => s + m.fwd_mim, 0)
                    const totalOptMim = mimData.reduce((s, m) => s + m.opt_mim, 0)
                    const usdcad = fxRates['USD/CAD'] ?? fxRates['CAD/USD'] ?? null
                    return [
                      { label: 'General MIM',   value: formatCurrencyShort(totalFwdMim + totalOptMim) },
                      { label: 'Options MIM',   value: formatCurrencyShort(totalOptMim)               },
                      { label: 'Forwards MIM',  value: formatCurrencyShort(totalFwdMim)               },
                      { label: 'Live USD/CAD',  value: usdcad ? usdcad.toFixed(4) : '—'              },
                    ]
                  })().map(s => (
                    <div key={s.label}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.125rem' }}>{s.label}</div>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '0.9375rem' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '0.5rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '1rem' }}>
                  {[{ label: 'FWD MIM', color: 'var(--teal)' }, { label: 'Option MIM', color: '#8b5cf6' }].map(l => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      <div style={{ width: 10, height: 3, background: l.color, borderRadius: 2 }} />
                      {l.label}
                    </div>
                  ))}
                </div>
                <div style={{ padding: '1rem', height: 230 }}>
                  {mimData.length === 0 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', paddingBottom: '0.5rem', textAlign: 'center' }}>
                      Add hedge positions to calculate mark-to-market P&amp;L
                    </div>
                  )}
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mimData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={formatCurrencyShort} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} formatter={formatCurrencyShort} />
                      <Bar dataKey="fwd_mim" name="FWD MIM"    fill="var(--teal)" radius={[3,3,0,0]} />
                      <Bar dataKey="opt_mim" name="Option MIM" fill="#8b5cf6"     radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* FX Report Section */}
            <div className="card" style={{ padding: 0 }}>
              {/* Collapsible header */}
              <div
                style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onClick={() => setFxReportOpen(o => !o)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>FX Reports</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({FX_REPORTS.length})</span>
                  {fxReportOpen ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
                </div>
                <button className="btn btn-primary btn-sm" onClick={e => e.stopPropagation()}>
                  <Plus size={13} /> New Report
                </button>
              </div>

              {fxReportOpen && (
                <>
                  <div style={{ padding: '0.625rem 1.25rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0 }}>
                      Generate and download standardized FX reports. Select a date period then click <strong>Download CSV</strong>.
                    </p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                    {FX_REPORTS.map((report, i) => {
                      const period     = getPeriod(i)
                      const isStarred  = starred.has(i)
                      const isDl       = downloading === i
                      const isDone     = downloaded.has(i)
                      const isDropOpen = openDropdown === i

                      return (
                        <div
                          key={i}
                          style={{
                            padding: '0.875rem 1.25rem',
                            borderBottom:  i < FX_REPORTS.length - 2 ? '1px solid var(--border-dim)' : 'none',
                            borderRight:   i % 2 === 0 ? '1px solid var(--border-dim)' : 'none',
                            display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                          }}
                        >
                          {/* Icon */}
                          <span style={{ fontSize: '1.25rem', lineHeight: 1, marginTop: '0.125rem', flexShrink: 0 }}>{report.icon}</span>

                          {/* Name + controls */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{report.name}</span>
                              {report.badge && <span className="badge badge-gray" style={{ fontSize: '0.65rem' }}>{report.badge}</span>}
                            </div>

                            {/* Period selector */}
                            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                              {(['yesterday', 'month_end', 'ytd', 'all'] as Period[]).map(p => (
                                <button
                                  key={p}
                                  onClick={() => setPeriod(i, p)}
                                  style={{
                                    background:  period === p ? 'var(--teal)' : 'var(--bg-surface)',
                                    color:       period === p ? '#fff' : 'var(--text-secondary)',
                                    border:      `1px solid ${period === p ? 'var(--teal)' : 'var(--border)'}`,
                                    borderRadius: 'var(--r-sm)',
                                    fontSize:    '0.72rem',
                                    fontWeight:  period === p ? 600 : 400,
                                    padding:     '0.15rem 0.5rem',
                                    cursor:      'pointer',
                                    lineHeight:  1.6,
                                    transition:  'all 0.1s',
                                  }}
                                >
                                  {PERIOD_LABELS[p]}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                            {/* Star */}
                            <button
                              title={isStarred ? 'Unstar' : 'Star'}
                              onClick={() => setStarred(prev => {
                                const n = new Set(prev)
                                isStarred ? n.delete(i) : n.add(i)
                                return n
                              })}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: isStarred ? '#f59e0b' : 'var(--text-muted)', padding: '0.25rem', display: 'flex' }}
                            >
                              <Star size={13} fill={isStarred ? '#f59e0b' : 'none'} />
                            </button>

                            {/* Download button + dropdown */}
                            <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                                {/* Main download action */}
                                <button
                                  className="btn btn-ghost btn-sm"
                                  disabled={isDl}
                                  onClick={() => handleDownload(i, 'csv')}
                                  style={{ borderRadius: 0, border: 'none', gap: '0.25rem', paddingRight: '0.5rem', minWidth: 90 }}
                                  title={`Download ${report.name} as CSV`}
                                >
                                  {isDl ? (
                                    <><div className="spinner" style={{ width: 12, height: 12 }} /> Generating…</>
                                  ) : isDone ? (
                                    <><FileText size={12} color="var(--green)" /> Downloaded!</>
                                  ) : (
                                    <><Download size={12} /> CSV</>
                                  )}
                                </button>

                                {/* Dropdown toggle */}
                                <button
                                  className="btn btn-ghost btn-sm"
                                  disabled={isDl}
                                  onClick={() => setOpenDropdown(isDropOpen ? null : i)}
                                  style={{ borderRadius: 0, border: 'none', borderLeft: '1px solid var(--border)', padding: '0 0.375rem' }}
                                  title="More export options"
                                >
                                  <ChevronDown size={11} />
                                </button>
                              </div>

                              {/* Dropdown menu */}
                              {isDropOpen && (
                                <div style={{
                                  position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                                  background: '#fff', border: '1px solid var(--border)',
                                  borderRadius: 'var(--r-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                  minWidth: 160, zIndex: 50, overflow: 'hidden',
                                }}>
                                  <button
                                    onClick={() => handleDownload(i, 'csv')}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.625rem 0.875rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8125rem', textAlign: 'left' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                  >
                                    <Download size={13} color="var(--teal)" /> Download CSV
                                  </button>
                                  <div style={{ borderTop: '1px solid var(--border-dim)' }} />
                                  <button
                                    onClick={() => { setOpenDropdown(null); alert('PDF export coming soon') }}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.625rem 0.875rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8125rem', textAlign: 'left', color: 'var(--text-muted)' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                  >
                                    <FileText size={13} /> Export PDF <span style={{ fontSize: '0.7rem', marginLeft: 'auto', opacity: 0.6 }}>Soon</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── CUSTOM REPORTS TAB ──────────────────────────────────────── */}
        {tab === 'reports' && (
          <div onClick={() => setCrDropdown(null)}>

            {/* Global Filters */}
            <div className="card" style={{ padding: '0.875rem 1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--text-muted)', fontSize: '0.8125rem', flexShrink: 0 }}>
                <Filter size={13} /> Filters
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>From</label>
                <input type="date" value={crFrom} onChange={e => setCrFrom(e.target.value)}
                  style={{ fontSize: '0.8125rem', padding: '0.25rem 0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>To</label>
                <input type="date" value={crTo} onChange={e => setCrTo(e.target.value)}
                  style={{ fontSize: '0.8125rem', padding: '0.25rem 0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Currency</label>
                <select value={crCcy} onChange={e => setCrCcy(e.target.value)}
                  style={{ fontSize: '0.8125rem', padding: '0.25rem 0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <option value="all">All Currencies</option>
                  {availableCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {(crFrom || crTo || crCcy !== 'all') && (
                <button onClick={() => { setCrFrom(''); setCrTo(''); setCrCcy('all') }}
                  style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, marginLeft: 'auto' }}>
                  Clear filters
                </button>
              )}
              {!isConsolidated && (
                <span className="badge badge-blue" style={{ marginLeft: 'auto', fontSize: '0.7rem' }}>
                  Entity filtered
                </span>
              )}
            </div>

            {/* Audience groups */}
            {AUDIENCE_ORDER.map(audience => {
              const meta    = AUDIENCE_META[audience]
              const reports = CUSTOM_REPORTS.filter(r => r.audience === audience)
              return (
                <div key={audience} className="card" style={{ padding: 0, marginBottom: '1rem' }}>
                  {/* Group header */}
                  <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border)', background: `${meta.color}12`, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: 3, height: 16, background: meta.color, borderRadius: 2, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: '0.875rem', color: meta.color }}>{meta.label}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({reports.length} reports)</span>
                  </div>

                  {/* Report cards grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                    {reports.map((report, ri) => {
                      const isLast     = ri >= reports.length - (reports.length % 2 === 0 ? 2 : 1)
                      const isDl       = crDl === report.id
                      const isDone     = crDone.has(report.id)
                      const isDropOpen = crDropdown === report.id

                      return (
                        <div
                          key={report.id}
                          style={{
                            padding:       '0.9rem 1.25rem',
                            borderBottom:  !isLast ? '1px solid var(--border-dim)' : 'none',
                            borderRight:   ri % 2 === 0 ? '1px solid var(--border-dim)' : 'none',
                            display:       'flex',
                            alignItems:    'flex-start',
                            gap:           '0.75rem',
                          }}
                        >
                          {/* Icon */}
                          <span style={{ fontSize: '1.375rem', lineHeight: 1, marginTop: '0.1rem', flexShrink: 0 }}>{report.icon}</span>

                          {/* Content */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{report.name}</span>
                              {!report.hasDate && !report.hasCcy && (
                                <span className="badge badge-gray" style={{ fontSize: '0.65rem' }}>All periods</span>
                              )}
                            </div>
                            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>{report.description}</p>
                            <div style={{ marginTop: '0.375rem', display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                              {report.hasDate && crFrom && (
                                <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>From: {crFrom}</span>
                              )}
                              {report.hasDate && crTo && (
                                <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>To: {crTo}</span>
                              )}
                              {report.hasCcy && crCcy !== 'all' && (
                                <span className="badge badge-gray" style={{ fontSize: '0.65rem' }}>{crCcy} only</span>
                              )}
                            </div>
                          </div>

                          {/* Download buttons */}
                          <div style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                              {/* Primary CSV button */}
                              <button
                                className="btn btn-ghost btn-sm"
                                disabled={isDl}
                                onClick={() => handleCrDownload(report.id, 'csv')}
                                style={{ borderRadius: 0, border: 'none', gap: '0.25rem', paddingRight: '0.5rem', minWidth: 90 }}
                              >
                                {isDl ? (
                                  <><div className="spinner" style={{ width: 12, height: 12 }} /> Generating…</>
                                ) : isDone ? (
                                  <><FileText size={12} color="var(--green)" /> Downloaded!</>
                                ) : (
                                  <><Download size={12} /> CSV</>
                                )}
                              </button>
                              {/* Dropdown toggle */}
                              <button
                                className="btn btn-ghost btn-sm"
                                disabled={isDl}
                                onClick={() => setCrDropdown(isDropOpen ? null : report.id)}
                                style={{ borderRadius: 0, border: 'none', borderLeft: '1px solid var(--border)', padding: '0 0.375rem' }}
                                title="More export options"
                              >
                                <ChevronDown size={11} />
                              </button>
                            </div>

                            {/* Dropdown menu */}
                            {isDropOpen && (
                              <div style={{
                                position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                                background: '#fff', border: '1px solid var(--border)',
                                borderRadius: 'var(--r-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                minWidth: 170, zIndex: 50, overflow: 'hidden',
                              }}>
                                {[
                                  { label: 'Download CSV',   fmt: 'csv'  as const, icon: <Download size={13} color="var(--teal)" /> },
                                  { label: 'Download Excel', fmt: 'xlsx' as const, icon: <FileText  size={13} color="#10b981"     /> },
                                ].map(opt => (
                                  <button
                                    key={opt.fmt}
                                    onClick={() => handleCrDownload(report.id, opt.fmt)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.625rem 0.875rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8125rem', textAlign: 'left' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                  >
                                    {opt.icon} {opt.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── HEDGE ACCOUNTING TAB ────────────────────────────────────── */}
        {tab === 'hedge_accounting' && <HedgeAccountingExport />}

        {/* ── EFFECTIVENESS TESTING TAB ────────────────────────────────── */}
        {tab === 'effectiveness' && <HedgeEffectivenessPanel positions={positions} />}

        {/* ── BOARD REPORT TAB ─────────────────────────────────────────── */}
        {tab === 'board_report' && (
          <BoardReportPanel
            combinedCoverage={combinedCoverage}
            positions={positions}
            flows={flows}
            fxRates={fxRates}
            policyMinPct={policy?.min_coverage_pct ?? 60}
            policyMaxPct={policy?.max_coverage_pct ?? 90}
            baseCurrency={policy?.base_currency ?? 'USD'}
            totalExposureUsd={metrics?.total_exposure_usd ?? 0}
            totalHedgedUsd={metrics?.total_hedged_usd ?? 0}
            overallCoveragePct={metrics?.overall_coverage_pct ?? 0}
            complianceStatus={
              metrics?.coverage_status === 'under_hedged' ? 'under_hedged'
              : metrics?.coverage_status === 'over_hedged' ? 'over_hedged'
              : 'compliant'
            }
            preparedBy={user?.email ?? 'Treasury Team'}
            orgName={(user?.organisation as any)?.name}
          />
        )}


      </div>
    </div>
  )
}
