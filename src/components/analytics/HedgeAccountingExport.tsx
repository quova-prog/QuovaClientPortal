/**
 * HedgeAccountingExport
 *
 * Generates ASC 815-compliant journal entry CSV exports for:
 *   1. Period-End MTM Adjustments   — mark open positions to fair value
 *   2. Settlement Entries           — record gain/loss when positions expire
 *   3. OCI Reclassification         — reclassify AOCI to P&L when hedged item settles (CF hedges)
 *
 * Simplification note:
 *   Fair value is computed as (current spot − contracted rate) × notional.
 *   This ignores interest rate differentials and time value, which are immaterial
 *   for short-tenor FX forwards but should be reviewed by your auditor.
 *   The "MTM Adjustment" entry shows cumulative fair value; the period change
 *   equals this period's entry minus the prior period's entry for the same position.
 */

import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Download, ChevronDown, ChevronUp, Settings2,
  CheckCircle, AlertTriangle, Info, RefreshCw,
} from 'lucide-react'
import { useHedgePositions, useFxRates } from '@/hooks/useData'
import { useEntity } from '@/context/EntityContext'
import type { HedgePosition } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AccountCode { code: string; name: string }

interface AccountMap {
  derivative_asset:        AccountCode
  derivative_liability:    AccountCode
  aoci_cf_reserve:         AccountCode
  unrealized_gl:           AccountCode
  realized_gl:             AccountCode
  settlement_account:      AccountCode
  reclassification_target: AccountCode
}

type EntryType = 'MTM_Adjustment' | 'Settlement' | 'OCI_Reclassification'
type EntryFilter = 'all' | 'mtm' | 'settlement' | 'reclass'

export interface JournalLine {
  reference:       string
  journalDate:     string
  entryType:       EntryType
  hedgeType:       string
  positionId:      string
  currencyPair:    string
  instrumentType:  string
  counterparty:    string
  maturityDate:    string
  accountCode:     string
  accountName:     string
  debitUsd:        number
  creditUsd:       number
  notionalBase:    number
  contractedRate:  number
  spotRate:        number
  fairValueUsd:    number
  memo:            string
  entity:          string
  period:          string
  asc815Note:      string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'orbit_hedge_acct_account_map'

const DEFAULT_MAP: AccountMap = {
  derivative_asset:        { code: '', name: 'Derivative Financial Assets – Current' },
  derivative_liability:    { code: '', name: 'Derivative Financial Liabilities – Current' },
  aoci_cf_reserve:         { code: '', name: 'AOCI – Cash Flow Hedge Reserve' },
  unrealized_gl:           { code: '', name: 'Unrealized Gain/Loss on Hedge Instruments' },
  realized_gl:             { code: '', name: 'Realized Gain/Loss on FX Hedges' },
  settlement_account:      { code: '', name: 'FX Settlement Receivable / Payable' },
  reclassification_target: { code: '', name: 'Revenue / COGS (enter appropriate account)' },
}

const ACCOUNT_LABELS: Record<keyof AccountMap, string> = {
  derivative_asset:        'Derivative Asset',
  derivative_liability:    'Derivative Liability',
  aoci_cf_reserve:         'AOCI – CF Hedge Reserve',
  unrealized_gl:           'Unrealized Gain / Loss',
  realized_gl:             'Realized Gain / Loss',
  settlement_account:      'Settlement Account',
  reclassification_target: 'Reclassification (P&L)',
}

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function lastDayOfMonth(year: number, month: number): string {
  // month is 1-based
  const d = new Date(year, month, 0) // day 0 of next month = last day of this month
  return d.toISOString().slice(0, 10)
}

function periodLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

function refNum(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s
}

function fmt2(n: number): string {
  return n === 0 ? '' : Math.abs(n).toFixed(2)
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(Math.abs(n))
}

/**
 * Compute fair value of a hedge position in USD.
 * Positive = asset (favorable); negative = liability (unfavorable).
 */
function computeFairValue(
  position: HedgePosition,
  spotRates: Record<string, number>,
): number {
  const spot = spotRates[position.currency_pair] ?? spotRates[`${position.base_currency}/USD`] ?? 1
  const contracted = position.contracted_rate
  const notional   = position.notional_base

  // For buy (long base): gain when spot rises above contracted
  // For sell (short base): gain when spot falls below contracted
  const raw = position.direction === 'buy'
    ? (spot - contracted) * notional
    : (contracted - spot) * notional

  // Convert to USD if quote isn't USD
  if (position.quote_currency !== 'USD') {
    const quoteToUsd = spotRates[`${position.quote_currency}/USD`] ?? 1
    return raw * quoteToUsd
  }
  return raw
}

function getSpotRate(position: HedgePosition, spotRates: Record<string, number>): number {
  return spotRates[position.currency_pair]
    ?? spotRates[`${position.base_currency}/USD`]
    ?? position.contracted_rate
}

// ── Journal entry generators ──────────────────────────────────────────────────

function generateMtmEntries(
  positions: HedgePosition[],
  spotRates: Record<string, number>,
  accountMap: AccountMap,
  periodDate: string,
  periodLbl: string,
  entityName: string,
): JournalLine[] {
  const lines: JournalLine[] = []
  let seq = 1

  for (const p of positions) {
    if (p.status !== 'active') continue
    const fv   = computeFairValue(p, spotRates)
    if (fv === 0) continue
    const absFv = Math.abs(fv)
    const spot  = getSpotRate(p, spotRates)
    const ref   = refNum('HEDGE-MTM', seq++)
    const hedge = (p.hedge_type ?? 'cash_flow').replace('_', ' ').toUpperCase().replace(' ', '_')
    const counterparty = p.counterparty_bank ?? 'Unknown Counterparty'
    const base = {
      reference: ref,
      journalDate: periodDate,
      entryType: 'MTM_Adjustment' as EntryType,
      hedgeType: hedge,
      positionId: p.reference_number ?? p.id.slice(0, 8).toUpperCase(),
      currencyPair: p.currency_pair,
      instrumentType: p.instrument_type,
      counterparty,
      maturityDate: p.value_date,
      notionalBase: p.notional_base,
      contractedRate: p.contracted_rate,
      spotRate: spot,
      fairValueUsd: fv,
      entity: entityName,
      period: periodLbl,
    }

    const hedgeType = p.hedge_type ?? 'cash_flow'

    if (hedgeType === 'cash_flow') {
      if (fv > 0) {
        // Gain: Dr Derivative Asset / Cr AOCI
        lines.push({
          ...base, debitUsd: absFv, creditUsd: 0,
          accountCode: accountMap.derivative_asset.code || '[DERIVATIVE_ASSET]',
          accountName: accountMap.derivative_asset.name,
          memo: `MTM gain on ${p.currency_pair} ${p.instrument_type} maturing ${p.value_date}`,
          asc815Note: 'ASC 815-20: Cash flow hedge — effective portion to OCI',
        })
        lines.push({
          ...base, debitUsd: 0, creditUsd: absFv,
          accountCode: accountMap.aoci_cf_reserve.code || '[AOCI_CF_RESERVE]',
          accountName: accountMap.aoci_cf_reserve.name,
          memo: `Unrealized gain deferred to OCI — ${p.currency_pair} ${p.instrument_type}`,
          asc815Note: 'ASC 815-30-35: Record effective gain in AOCI',
        })
      } else {
        // Loss: Dr AOCI / Cr Derivative Liability
        lines.push({
          ...base, debitUsd: absFv, creditUsd: 0,
          accountCode: accountMap.aoci_cf_reserve.code || '[AOCI_CF_RESERVE]',
          accountName: accountMap.aoci_cf_reserve.name,
          memo: `MTM loss on ${p.currency_pair} ${p.instrument_type} maturing ${p.value_date}`,
          asc815Note: 'ASC 815-30-35: Record effective loss in AOCI',
        })
        lines.push({
          ...base, debitUsd: 0, creditUsd: absFv,
          accountCode: accountMap.derivative_liability.code || '[DERIVATIVE_LIABILITY]',
          accountName: accountMap.derivative_liability.name,
          memo: `Derivative liability — ${p.currency_pair} ${p.instrument_type}`,
          asc815Note: 'ASC 815-20: Cash flow hedge — derivative at fair value',
        })
      }
    } else {
      // Fair Value Hedge: derivative and hedged item both to P&L
      if (fv > 0) {
        lines.push({
          ...base, debitUsd: absFv, creditUsd: 0,
          accountCode: accountMap.derivative_asset.code || '[DERIVATIVE_ASSET]',
          accountName: accountMap.derivative_asset.name,
          memo: `FV hedge gain on ${p.currency_pair} ${p.instrument_type} maturing ${p.value_date}`,
          asc815Note: 'ASC 815-20: Fair value hedge — derivative at fair value through P&L',
        })
        lines.push({
          ...base, debitUsd: 0, creditUsd: absFv,
          accountCode: accountMap.unrealized_gl.code || '[UNREALIZED_GL]',
          accountName: accountMap.unrealized_gl.name,
          memo: `Unrealized gain on FV hedge — ${p.currency_pair}`,
          asc815Note: 'ASC 815-25: Gain on derivative recognized in earnings',
        })
      } else {
        lines.push({
          ...base, debitUsd: absFv, creditUsd: 0,
          accountCode: accountMap.unrealized_gl.code || '[UNREALIZED_GL]',
          accountName: accountMap.unrealized_gl.name,
          memo: `Unrealized loss on FV hedge — ${p.currency_pair} ${p.instrument_type}`,
          asc815Note: 'ASC 815-25: Loss on derivative recognized in earnings',
        })
        lines.push({
          ...base, debitUsd: 0, creditUsd: absFv,
          accountCode: accountMap.derivative_liability.code || '[DERIVATIVE_LIABILITY]',
          accountName: accountMap.derivative_liability.name,
          memo: `Derivative liability — ${p.currency_pair} ${p.instrument_type}`,
          asc815Note: 'ASC 815-20: Fair value hedge — derivative at fair value',
        })
      }
    }
  }

  return lines
}

function generateSettlementEntries(
  positions: HedgePosition[],
  spotRates: Record<string, number>,
  accountMap: AccountMap,
  year: number,
  month: number,
  entityName: string,
): JournalLine[] {
  const lines: JournalLine[] = []
  let seq = 1

  // Filter positions that matured in the selected month
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`
  const periodEnd   = lastDayOfMonth(year, month)

  for (const p of positions) {
    if (p.status !== 'expired' && p.status !== 'active') continue
    if (p.value_date < periodStart || p.value_date > periodEnd) continue

    const fv     = computeFairValue(p, spotRates)
    const absFv  = Math.abs(fv)
    const spot   = getSpotRate(p, spotRates)
    const ref    = refNum('HEDGE-SETL', seq++)
    const hedgeType = p.hedge_type ?? 'cash_flow'
    const counterparty = p.counterparty_bank ?? 'Unknown Counterparty'
    const base = {
      reference: ref,
      journalDate: p.value_date,
      entryType: 'Settlement' as EntryType,
      hedgeType: hedgeType.replace('_', ' ').toUpperCase().replace(' ', '_'),
      positionId: p.reference_number ?? p.id.slice(0, 8).toUpperCase(),
      currencyPair: p.currency_pair,
      instrumentType: p.instrument_type,
      counterparty,
      maturityDate: p.value_date,
      notionalBase: p.notional_base,
      contractedRate: p.contracted_rate,
      spotRate: spot,
      fairValueUsd: fv,
      entity: entityName,
      period: periodLabel(year, month),
    }

    if (fv >= 0) {
      // Net settlement gain
      lines.push({
        ...base, debitUsd: absFv, creditUsd: 0,
        accountCode: accountMap.settlement_account.code || '[SETTLEMENT_ACCOUNT]',
        accountName: accountMap.settlement_account.name,
        memo: `Settlement receipt — ${p.currency_pair} ${p.instrument_type} matured ${p.value_date}`,
        asc815Note: 'ASC 815: Record net cash settlement of derivative at maturity',
      })
      lines.push({
        ...base, debitUsd: 0, creditUsd: absFv,
        accountCode: accountMap.realized_gl.code || '[REALIZED_GL]',
        accountName: accountMap.realized_gl.name,
        memo: `Realized gain — ${p.currency_pair} hedge settled at ${spot.toFixed(4)} vs contracted ${p.contracted_rate.toFixed(4)}`,
        asc815Note: hedgeType === 'cash_flow'
          ? 'ASC 815-30: Gain deferred in AOCI pending hedged transaction; see OCI reclassification entry'
          : 'ASC 815-25: Realized gain on settled FV hedge derivative',
      })
    } else {
      // Net settlement loss
      lines.push({
        ...base, debitUsd: absFv, creditUsd: 0,
        accountCode: accountMap.realized_gl.code || '[REALIZED_GL]',
        accountName: accountMap.realized_gl.name,
        memo: `Realized loss — ${p.currency_pair} hedge settled at ${spot.toFixed(4)} vs contracted ${p.contracted_rate.toFixed(4)}`,
        asc815Note: hedgeType === 'cash_flow'
          ? 'ASC 815-30: Loss deferred in AOCI pending hedged transaction; see OCI reclassification entry'
          : 'ASC 815-25: Realized loss on settled FV hedge derivative',
      })
      lines.push({
        ...base, debitUsd: 0, creditUsd: absFv,
        accountCode: accountMap.settlement_account.code || '[SETTLEMENT_ACCOUNT]',
        accountName: accountMap.settlement_account.name,
        memo: `Settlement payment — ${p.currency_pair} ${p.instrument_type} matured ${p.value_date}`,
        asc815Note: 'ASC 815: Record net cash settlement of derivative at maturity',
      })
    }
  }

  return lines
}

function generateReclassEntries(
  positions: HedgePosition[],
  spotRates: Record<string, number>,
  accountMap: AccountMap,
  year: number,
  month: number,
  entityName: string,
): JournalLine[] {
  // OCI reclassification only applies to Cash Flow hedges
  // Generated as template entries for settled CF hedges in the period
  const lines: JournalLine[] = []
  let seq = 1

  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`
  const periodEnd   = lastDayOfMonth(year, month)

  for (const p of positions) {
    if ((p.hedge_type ?? 'cash_flow') !== 'cash_flow') continue
    if (p.value_date < periodStart || p.value_date > periodEnd) continue

    const fv    = computeFairValue(p, spotRates)
    const absFv = Math.abs(fv)
    if (absFv === 0) continue
    const ref = refNum('HEDGE-RECLASS', seq++)
    const base = {
      reference: ref,
      journalDate: periodEnd,
      entryType: 'OCI_Reclassification' as EntryType,
      hedgeType: 'CASH_FLOW',
      positionId: p.reference_number ?? p.id.slice(0, 8).toUpperCase(),
      currencyPair: p.currency_pair,
      instrumentType: p.instrument_type,
      counterparty: p.counterparty_bank ?? 'Unknown Counterparty',
      maturityDate: p.value_date,
      notionalBase: p.notional_base,
      contractedRate: p.contracted_rate,
      spotRate: getSpotRate(p, spotRates),
      fairValueUsd: fv,
      entity: entityName,
      period: periodLabel(year, month),
      asc815Note: 'ASC 815-30-35-3: Reclassify AOCI to earnings when hedged item affects P&L. Amount = cumulative AOCI balance for this hedge. Update account code to match the hedged item income statement line.',
    }

    if (fv > 0) {
      // Reclassify AOCI gain to P&L
      lines.push({
        ...base, debitUsd: absFv, creditUsd: 0,
        accountCode: accountMap.aoci_cf_reserve.code || '[AOCI_CF_RESERVE]',
        accountName: accountMap.aoci_cf_reserve.name,
        memo: `Reclassify AOCI gain to P&L — ${p.currency_pair} hedge settled ${p.value_date}`,
      })
      lines.push({
        ...base, debitUsd: 0, creditUsd: absFv,
        accountCode: accountMap.reclassification_target.code || '[RECLASSIFICATION_TARGET]',
        accountName: accountMap.reclassification_target.name,
        memo: `Hedge gain reclassified to earnings — ${p.currency_pair} ${p.instrument_type}`,
      })
    } else {
      // Reclassify AOCI loss to P&L
      lines.push({
        ...base, debitUsd: absFv, creditUsd: 0,
        accountCode: accountMap.reclassification_target.code || '[RECLASSIFICATION_TARGET]',
        accountName: accountMap.reclassification_target.name,
        memo: `Hedge loss reclassified to earnings — ${p.currency_pair} ${p.instrument_type}`,
      })
      lines.push({
        ...base, debitUsd: 0, creditUsd: absFv,
        accountCode: accountMap.aoci_cf_reserve.code || '[AOCI_CF_RESERVE]',
        accountName: accountMap.aoci_cf_reserve.name,
        memo: `Reclassify AOCI loss to P&L — ${p.currency_pair} hedge settled ${p.value_date}`,
      })
    }
  }

  return lines
}

// ── CSV export ────────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'Journal_Date','Reference','Entry_Type','Hedge_Type','Position_ID',
  'Currency_Pair','Instrument','Counterparty','Maturity_Date',
  'Account_Code','Account_Name','Debit_USD','Credit_USD',
  'Notional_Base','Contracted_Rate','Spot_Rate','Fair_Value_USD',
  'Memo','Entity','Period','ASC815_Reference',
]

function toCSV(lines: JournalLine[]): string {
  const rows = [
    CSV_HEADERS.join(','),
    ...lines.map(l => [
      l.journalDate, l.reference, l.entryType, l.hedgeType, l.positionId,
      l.currencyPair, l.instrumentType, l.counterparty, l.maturityDate,
      l.accountCode, l.accountName,
      fmt2(l.debitUsd), fmt2(l.creditUsd),
      l.notionalBase, l.contractedRate.toFixed(6), l.spotRate.toFixed(6),
      l.fairValueUsd.toFixed(2),
      l.memo, l.entity, l.period, l.asc815Note,
    ].map(csvEscape).join(',')),
  ]
  return rows.join('\n')
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── Component ─────────────────────────────────────────────────────────────────

const ENTRY_TYPE_COLORS: Record<EntryType, string> = {
  MTM_Adjustment:    '#3b82f6',
  Settlement:        '#10b981',
  OCI_Reclassification: '#f59e0b',
}

export function HedgeAccountingExport() {
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)  // 1-based
  const [filter, setFilter] = useState<EntryFilter>('all')
  const [showAccountEditor, setShowAccountEditor] = useState(false)
  const [accountMap, setAccountMap] = useState<AccountMap>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return { ...DEFAULT_MAP, ...JSON.parse(stored) }
    } catch {}
    return DEFAULT_MAP
  })
  const [accountSaved, setAccountSaved] = useState(false)

  // Include expired positions so Settlement entries cover positions that settled this period
  const { positions } = useHedgePositions(['active', 'expired'])
  const { rates: spotRates } = useFxRates()
  const { currentEntityId, isConsolidated, entities } = useEntity()

  const entityName = useMemo(() => {
    if (isConsolidated) return 'Consolidated'
    return entities.find(e => e.id === currentEntityId)?.name ?? 'Unknown Entity'
  }, [isConsolidated, currentEntityId, entities])

  // Filter positions by entity
  const scopedPositions = useMemo(() =>
    isConsolidated
      ? positions
      : positions.filter(p => (p as any).entity_id === currentEntityId || !(p as any).entity_id),
  [positions, isConsolidated, currentEntityId])

  const periodDate = lastDayOfMonth(year, month)
  const periodLbl  = periodLabel(year, month)

  // Generate all journal entries
  const mtmLines = useMemo(() =>
    generateMtmEntries(scopedPositions, spotRates, accountMap, periodDate, periodLbl, entityName),
  [scopedPositions, spotRates, accountMap, periodDate, periodLbl, entityName])

  const settlementLines = useMemo(() =>
    generateSettlementEntries(scopedPositions, spotRates, accountMap, year, month, entityName),
  [scopedPositions, spotRates, accountMap, year, month, entityName])

  const reclassLines = useMemo(() =>
    generateReclassEntries(scopedPositions, spotRates, accountMap, year, month, entityName),
  [scopedPositions, spotRates, accountMap, year, month, entityName])

  const allLines = useMemo(() =>
    [...mtmLines, ...settlementLines, ...reclassLines],
  [mtmLines, settlementLines, reclassLines])

  const displayLines = useMemo(() => {
    if (filter === 'mtm')        return mtmLines
    if (filter === 'settlement') return settlementLines
    if (filter === 'reclass')    return reclassLines
    return allLines
  }, [filter, allLines, mtmLines, settlementLines, reclassLines])

  // Balance check
  const totalDebit  = allLines.reduce((s, l) => s + l.debitUsd, 0)
  const totalCredit = allLines.reduce((s, l) => s + l.creditUsd, 0)
  const isBalanced  = Math.abs(totalDebit - totalCredit) < 0.01
  const entryCount  = allLines.length / 2  // each journal entry = 2 lines

  function saveAccountMap() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accountMap))
    setAccountSaved(true)
    setTimeout(() => setAccountSaved(false), 2500)
  }

  function updateAccount(key: keyof AccountMap, field: 'code' | 'name', value: string) {
    setAccountMap(m => ({ ...m, [key]: { ...m[key], [field]: value } }))
  }

  function handleExport(subset: 'all' | 'mtm' | 'settlement' | 'reclass') {
    const lines = subset === 'mtm'        ? mtmLines
                : subset === 'settlement' ? settlementLines
                : subset === 'reclass'    ? reclassLines
                : allLines
    const suffix = subset === 'all' ? 'Full_Package' : subset.toUpperCase()
    const csv  = toCSV(lines)
    const name = `Hedge_Accounting_${suffix}_${periodLbl.replace(' ', '_')}.csv`
    downloadCSV(csv, name)
  }

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    const next = new Date(year, month, 1) // first of next month
    if (next > new Date()) return         // don't go into the future
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── Header controls ─────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>

          {/* Period navigator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Period</span>
            <button onClick={prevMonth} style={navBtnStyle}>◀</button>
            <span style={{ fontWeight: 700, fontSize: '0.9375rem', minWidth: 130, textAlign: 'center' }}>
              {periodLbl}
            </span>
            <button onClick={nextMonth} style={navBtnStyle}>▶</button>
          </div>

          {/* Entry filter */}
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            {([
              { key: 'all',        label: 'All Entries' },
              { key: 'mtm',        label: `MTM (${mtmLines.length / 2})` },
              { key: 'settlement', label: `Settlements (${settlementLines.length / 2})` },
              { key: 'reclass',    label: `OCI Reclass (${reclassLines.length / 2})` },
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key as EntryFilter)}
                style={{
                  padding: '5px 12px', borderRadius: 5, fontSize: '0.8125rem', cursor: 'pointer',
                  fontWeight: filter === f.key ? 600 : 400,
                  background: filter === f.key ? 'var(--teal)' : 'var(--bg-surface)',
                  color: filter === f.key ? '#fff' : 'var(--text-primary)',
                  border: `1px solid ${filter === f.key ? 'var(--teal)' : 'var(--border)'}`,
                }}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Account mapping toggle */}
          <button
            onClick={() => setShowAccountEditor(v => !v)}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 5, fontSize: '0.8125rem', cursor: 'pointer',
              background: showAccountEditor ? 'rgba(0,200,160,0.1)' : 'var(--bg-surface)',
              border: `1px solid ${showAccountEditor ? 'var(--teal)' : 'var(--border)'}`,
              color: 'var(--text-primary)' }}>
            <Settings2 size={13} />
            Account Codes
            {showAccountEditor ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>

        {/* Balance check banner */}
        <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem',
          fontSize: '0.8125rem', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5,
            color: isBalanced ? '#22c55e' : '#ef4444' }}>
            {isBalanced
              ? <><CheckCircle size={14} /> Journal Balanced — {entryCount} entries ({allLines.length} lines)</>
              : <><AlertTriangle size={14} /> Unbalanced — Dr {fmtUsd(totalDebit)} ≠ Cr {fmtUsd(totalCredit)}</>}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>|</span>
          <span style={{ color: 'var(--text-muted)' }}>
            MTM: {mtmLines.length / 2} &nbsp;·&nbsp; Settlements: {settlementLines.length / 2} &nbsp;·&nbsp; OCI Reclass: {reclassLines.length / 2}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary btn-sm"
              onClick={() => handleExport('all')}
              disabled={allLines.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Download size={13} /> Export All CSV
            </button>
            <button className="btn btn-sm"
              onClick={() => handleExport('mtm')}
              disabled={mtmLines.length === 0}
              style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 5 }}>
              MTM Only
            </button>
            <button className="btn btn-sm"
              onClick={() => handleExport('settlement')}
              disabled={settlementLines.length === 0}
              style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 5 }}>
              Settlements
            </button>
          </div>
        </div>
      </div>

      {/* ── Account Code Editor ──────────────────────────────────────────── */}
      {showAccountEditor && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Account Code Mapping</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Map these to your Chart of Accounts. Codes are saved in your browser.
              </div>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={saveAccountMap}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {accountSaved ? <><CheckCircle size={13} /> Saved!</> : 'Save Codes'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '180px 120px 1fr', gap: '0.5rem',
            fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem',
            padding: '0 0 0.25rem', borderBottom: '1px solid var(--border)' }}>
            <span>Account</span><span>GL Code</span><span>Description</span>
          </div>

          {(Object.keys(accountMap) as (keyof AccountMap)[]).map(key => (
            <div key={key} style={{ display: 'grid', gridTemplateColumns: '180px 120px 1fr',
              gap: '0.5rem', alignItems: 'center', marginBottom: '0.375rem' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                {ACCOUNT_LABELS[key]}
              </span>
              <input
                className="input"
                value={accountMap[key].code}
                onChange={e => updateAccount(key, 'code', e.target.value)}
                placeholder="e.g. 1150"
                style={{ fontSize: '0.8125rem', padding: '4px 8px' }}
              />
              <input
                className="input"
                value={accountMap[key].name}
                onChange={e => updateAccount(key, 'name', e.target.value)}
                placeholder="Account name"
                style={{ fontSize: '0.8125rem', padding: '4px 8px' }}
              />
            </div>
          ))}

          <div style={{ marginTop: '0.875rem', padding: '0.625rem 0.875rem',
            background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
            borderRadius: 6, fontSize: '0.75rem', color: '#60a5fa', display: 'flex', gap: 8 }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Fair values are computed as (spot rate − contracted rate) × notional.
              This approximation is appropriate for short-tenor FX forwards but excludes
              interest rate differentials and time value. Confirm with your auditor for
              longer-dated positions. MTM entries show <strong>cumulative</strong> fair
              value; period change = this month's entry minus prior month's entry per position.
            </span>
          </div>
        </div>
      )}

      {/* ── Journal Entry Preview Table ──────────────────────────────────── */}
      {displayLines.length === 0 ? (
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            {allLines.length === 0
              ? 'No hedge positions found for this period. Positions must be Active (MTM) or expire within the selected month (Settlement / OCI Reclass).'
              : 'No entries match the selected filter.'}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.775rem' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 }}>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Date','Reference','Type','Hedge','Pair','Instrument','Account','Dr (USD)','Cr (USD)','Fair Value','Memo'].map(h => (
                    <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: h === 'Dr (USD)' || h === 'Cr (USD)' || h === 'Fair Value' ? 'right' : 'left',
                      color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayLines.map((line, i) => {
                  const isNewEntry = i === 0 || displayLines[i - 1].reference !== line.reference
                  return (
                    <tr key={`${line.reference}-${i}`}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: Math.floor(i / 2) % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                        borderTop: isNewEntry && i > 0 ? '1px solid rgba(255,255,255,0.06)' : undefined,
                      }}>
                      <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{line.journalDate}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{line.reference}</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{
                          fontSize: '0.6875rem', fontWeight: 600, padding: '2px 6px', borderRadius: 3,
                          background: `${ENTRY_TYPE_COLORS[line.entryType]}18`,
                          color: ENTRY_TYPE_COLORS[line.entryType],
                          whiteSpace: 'nowrap',
                        }}>
                          {line.entryType.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                        {line.hedgeType.replace('_', ' ')}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{line.currencyPair}</td>
                      <td style={{ padding: '0.5rem 0.75rem', textTransform: 'capitalize', color: 'var(--text-muted)' }}>{line.instrumentType}</td>
                      <td style={{ padding: '0.5rem 0.75rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {line.accountCode && (
                          <span style={{ fontFamily: 'monospace', fontSize: '0.6875rem', color: 'var(--teal)',
                            marginRight: 4, background: 'rgba(0,200,160,0.08)', padding: '1px 4px', borderRadius: 3 }}>
                            {line.accountCode}
                          </span>
                        )}
                        {line.accountName}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600, color: line.debitUsd > 0 ? '#f1f5f9' : 'transparent' }}>
                        {line.debitUsd > 0 ? fmtUsd(line.debitUsd) : '—'}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600, color: line.creditUsd > 0 ? '#f1f5f9' : 'transparent' }}>
                        {line.creditUsd > 0 ? fmtUsd(line.creditUsd) : '—'}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right',
                        color: line.fairValueUsd >= 0 ? '#22c55e' : '#ef4444',
                        fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {line.fairValueUsd >= 0 ? '+' : ''}{fmtUsd(line.fairValueUsd)}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {line.memo}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {/* Totals row */}
              <tfoot style={{ borderTop: '2px solid var(--border)', position: 'sticky', bottom: 0, background: 'var(--bg-card)' }}>
                <tr>
                  <td colSpan={7} style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    {displayLines.length} lines · {displayLines.length / 2} entries
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontWeight: 700 }}>
                    {fmtUsd(displayLines.reduce((s, l) => s + l.debitUsd, 0))}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontWeight: 700 }}>
                    {fmtUsd(displayLines.reduce((s, l) => s + l.creditUsd, 0))}
                  </td>
                  <td colSpan={2} style={{ padding: '0.625rem 0.75rem', textAlign: 'right' }}>
                    <span style={{ color: isBalanced ? '#22c55e' : '#ef4444', fontWeight: 600, fontSize: '0.8125rem' }}>
                      {isBalanced ? '✓ Balanced' : '✗ Does not balance'}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── ASC 815 Quick Reference ──────────────────────────────────────── */}
      <div className="card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '0.75rem', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>ASC 815 Reference</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.875rem', fontSize: '0.775rem' }}>
          {[
            { badge: 'MTM Adj', color: '#3b82f6', title: 'Period-End Mark-to-Market',
              body: 'Cash flow hedge: effective FV change → AOCI. Fair value hedge: FV change → P&L, offset by hedged item adjustment.' },
            { badge: 'Settlement', color: '#10b981', title: 'Settlement at Maturity',
              body: 'Record net cash settlement. Realized G/L from fair value at maturity. CF hedges: gain/loss stays in AOCI until hedged item affects earnings.' },
            { badge: 'OCI Reclass', color: '#f59e0b', title: 'OCI Reclassification',
              body: 'Cash flow hedges only. Reclassify AOCI balance to the same P&L line as the hedged transaction (revenue, COGS, etc.) when it affects earnings.' },
          ].map(r => (
            <div key={r.badge} style={{ padding: '0.75rem', background: 'var(--bg-surface)',
              borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.375rem' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                  background: `${r.color}18`, color: r.color }}>{r.badge}</span>
                <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{r.title}</span>
              </div>
              <p style={{ color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>{r.body}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

// ── Shared mini-styles ────────────────────────────────────────────────────────

const navBtnStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem',
  background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)',
}
