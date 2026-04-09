import pptxgen from 'pptxgenjs'
import type { BoardReportData } from './boardReportPdf'
import { fmtUsd } from './boardReportPdf'

export type { BoardReportData }

// ── Theme colors (hex strings for pptxgenjs) ──────────────────────────────────
const NAVY  = '0B1526'
const TEAL  = '14B8A6'
const WHITE = 'FFFFFF'
const GRAY  = '64748B'
const RED   = 'DC2626'
const GREEN = '059669'
const AMBER = 'D97706'
const LIGHT_GRAY = 'F1F5F9'
const DARK  = '0F172A'

type RGB = string

function statusColor(status: 'compliant' | 'under_hedged' | 'over_hedged'): RGB {
  if (status === 'compliant') return GREEN
  if (status === 'under_hedged') return RED
  return AMBER
}

function addFooter(slide: pptxgen.Slide, pageNum: number) {
  slide.addShape('rect' as pptxgen.SHAPE_NAME, {
    x: 0, y: 7.2, w: 13.33, h: 0.3,
    fill: { color: NAVY },
    line: { color: NAVY },
  })
  slide.addText('Quova — The Financial Risk OS', {
    x: 0.3, y: 7.21, w: 4, h: 0.28,
    fontSize: 8, color: WHITE, bold: false,
    valign: 'middle',
  })
  slide.addText(`Confidential | Page ${pageNum}`, {
    x: 8.5, y: 7.21, w: 4.5, h: 0.28,
    fontSize: 8, color: WHITE, align: 'right',
    valign: 'middle',
  })
}

function addHeaderBar(slide: pptxgen.Slide, title: string) {
  slide.addShape('rect' as pptxgen.SHAPE_NAME, {
    x: 0, y: 0, w: 13.33, h: 0.6,
    fill: { color: NAVY },
    line: { color: NAVY },
  })
  slide.addText(title, {
    x: 0.4, y: 0, w: 12, h: 0.6,
    fontSize: 18, color: WHITE, bold: true,
    valign: 'middle',
  })
}

// ── Slide 1 — Cover ───────────────────────────────────────────────────────────

function addCoverSlide(prs: pptxgen, data: BoardReportData) {
  const slide = prs.addSlide()
  slide.background = { color: NAVY }

  // Logo square
  slide.addShape('rect' as pptxgen.SHAPE_NAME, {
    x: 0.5, y: 0.5, w: 0.25, h: 0.25,
    fill: { color: TEAL },
    line: { color: TEAL },
  })

  // ORBIT text
  slide.addText('ORBIT', {
    x: 0.85, y: 0.45, w: 2, h: 0.35,
    fontSize: 16, color: WHITE, bold: true,
  })

  // Treasury Intelligence
  slide.addText('Treasury Intelligence', {
    x: 0.85, y: 0.85, w: 3, h: 0.25,
    fontSize: 10, color: TEAL,
  })

  // Teal horizontal line
  slide.addShape('rect' as pptxgen.SHAPE_NAME, {
    x: 0.5, y: 1.2, w: 12.33, h: 0.02,
    fill: { color: TEAL },
    line: { color: TEAL },
  })

  // Main title
  slide.addText('FX RISK MANAGEMENT\nBOARD REPORT', {
    x: 0.5, y: 1.6, w: 12, h: 1.5,
    fontSize: 40, color: WHITE, bold: true,
  })

  // Company name
  slide.addText(data.companyName, {
    x: 0.5, y: 3.2, w: 12, h: 0.8,
    fontSize: 28, color: WHITE, bold: true,
  })

  // Report period
  slide.addText(data.reportPeriod, {
    x: 0.5, y: 4.1, w: 4, h: 0.4,
    fontSize: 18, color: TEAL,
  })

  // Prepared by
  slide.addText(`Prepared by: ${data.preparedBy}`, {
    x: 0.5, y: 4.7, w: 6, h: 0.3,
    fontSize: 11, color: GRAY,
  })

  // Generated
  slide.addText(`Generated: ${data.generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, {
    x: 0.5, y: 5.1, w: 6, h: 0.3,
    fontSize: 11, color: GRAY,
  })

  // Confidential
  slide.addText('CONFIDENTIAL', {
    x: 0.5, y: 6.8, w: 12.33, h: 0.3,
    fontSize: 9, color: GRAY, align: 'center',
  })
}

// ── Slide 2 — Executive Summary ───────────────────────────────────────────────

function addExecutiveSummarySlide(prs: pptxgen, data: BoardReportData) {
  const slide = prs.addSlide()
  slide.background = { color: WHITE }
  addHeaderBar(slide, 'EXECUTIVE SUMMARY')

  // 4 KPI cards
  const cardW = 2.8
  const cardH = 1.8
  const cardY = 0.9
  const gap = 0.3
  const startX = 0.5

  const complianceValueColor = data.complianceStatus === 'compliant' ? GREEN : RED
  const cards = [
    {
      label: 'Total FX Exposure',
      value: fmtUsd(data.totalExposureUsd),
      sub: 'USD equivalent',
      valueColor: NAVY,
    },
    {
      label: 'Hedge Coverage',
      value: `${data.overallCoveragePct.toFixed(1)}%`,
      sub: 'of total exposure',
      valueColor: NAVY,
    },
    {
      label: 'Policy Status',
      value: data.complianceStatus === 'compliant' ? 'COMPLIANT' : 'BREACH',
      sub: `${data.policyMinPct}%–${data.policyMaxPct}% band`,
      valueColor: complianceValueColor,
    },
    {
      label: 'P&L at Risk (95%)',
      value: fmtUsd(data.var95Usd),
      sub: 'annual estimate',
      valueColor: NAVY,
    },
  ]

  cards.forEach((card, i) => {
    const x = startX + i * (cardW + gap)

    // Card background
    slide.addShape('rect' as pptxgen.SHAPE_NAME, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: LIGHT_GRAY },
      line: { color: 'CBD5E1', width: 0.5 },
    })

    // Teal left border strip
    slide.addShape('rect' as pptxgen.SHAPE_NAME, {
      x, y: cardY, w: 0.06, h: cardH,
      fill: { color: TEAL },
      line: { color: TEAL },
    })

    // Label
    slide.addText(card.label, {
      x: x + 0.12, y: cardY + 0.1, w: cardW - 0.2, h: 0.3,
      fontSize: 9, color: GRAY,
    })

    // Value
    slide.addText(card.value, {
      x: x + 0.12, y: cardY + 0.45, w: cardW - 0.2, h: 0.7,
      fontSize: 26, color: card.valueColor, bold: true,
    })

    // Sub-label
    slide.addText(card.sub, {
      x: x + 0.12, y: cardY + 1.45, w: cardW - 0.2, h: 0.3,
      fontSize: 8, color: GRAY,
    })
  })

  // Highlight bullets
  const pairCount = data.coverageByPair.length
  const compliantCount = data.coverageByPair.filter(r => r.status === 'compliant').length
  const maturingIn30 = data.upcomingMaturities.filter(m => m.daysToMaturity <= 30).length
  const sortedByUnhedged = [...data.coverageByPair].sort((a, b) => b.unhedgedUsd - a.unhedgedUsd)
  const largest = sortedByUnhedged[0]
  const inBand = data.overallCoveragePct >= data.policyMinPct && data.overallCoveragePct <= data.policyMaxPct

  const highlights = [
    `Total FX exposure of ${fmtUsd(data.totalExposureUsd)} across ${pairCount} currency pair${pairCount !== 1 ? 's' : ''}`,
    `Overall hedge coverage of ${data.overallCoveragePct.toFixed(1)}%, ${inBand ? 'within' : 'outside'} the ${data.policyMinPct}%–${data.policyMaxPct}% policy band`,
    `${compliantCount} of ${pairCount} tracked currency pair${pairCount !== 1 ? 's' : ''} are fully compliant with policy minimums`,
    maturingIn30 > 0
      ? `${maturingIn30} position${maturingIn30 > 1 ? 's' : ''} maturing within 30 days requiring immediate attention`
      : 'No positions maturing within 30 days',
    largest
      ? `Largest unhedged exposure: ${largest.pair} at ${fmtUsd(largest.unhedgedUsd)} (${largest.coveragePct.toFixed(0)}% coverage)`
      : 'No unhedged exposures identified',
    `P&L at risk (95% VaR): ${fmtUsd(data.var95Usd)} over a 12-month horizon`,
  ]

  const bulletRows = highlights.map(h => [{ text: `• ${h}`, options: { fontSize: 11, color: DARK } }])
  slide.addTable(bulletRows, {
    x: 0.5, y: 3.0, w: 12.33,
    rowH: 0.35,
    border: { type: 'none' },
    align: 'left',
  })

  addFooter(slide, 2)
}

// ── Slide 3 — FX Exposure vs Policy ──────────────────────────────────────────

function addExposurePolicySlide(prs: pptxgen, data: BoardReportData) {
  const slide = prs.addSlide()
  slide.background = { color: WHITE }
  addHeaderBar(slide, 'FX EXPOSURE VS. POLICY')

  slide.addText('FX Exposure by Currency Pair', {
    x: 0.4, y: 0.7, w: 12, h: 0.4,
    fontSize: 14, color: NAVY, bold: true,
  })

  const headerRow: pptxgen.TableRow = [
    { text: 'Currency Pair', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: 'Exposure (USD)', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
    { text: 'Hedged (USD)', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
    { text: 'Unhedged (USD)', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
    { text: 'Coverage %', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
    { text: 'Policy Min', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
    { text: 'Policy Max', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
    { text: 'Status', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'center' } },
  ]

  const dataRows: pptxgen.TableRow[] = data.coverageByPair.map((row, idx) => {
    const statusText = row.status === 'compliant' ? 'Compliant' : row.status === 'under' ? 'Under-hedged' : row.status === 'over' ? 'Over-hedged' : 'Unhedged'
    const statusFill = row.status === 'compliant' ? 'D1FAE5' : row.status === 'over' ? 'FEF3C7' : 'FEE2E2'
    const rowFill = idx % 2 === 0 ? 'FFFFFF' : LIGHT_GRAY
    return [
      { text: row.pair, options: { bold: true, fill: { color: rowFill } } },
      { text: fmtUsd(row.exposureUsd), options: { align: 'right', fill: { color: rowFill } } },
      { text: fmtUsd(row.hedgedUsd), options: { align: 'right', fill: { color: rowFill } } },
      { text: fmtUsd(row.unhedgedUsd), options: { align: 'right', fill: { color: rowFill } } },
      { text: `${row.coveragePct.toFixed(1)}%`, options: { align: 'right', fill: { color: rowFill } } },
      { text: `${data.policyMinPct}%`, options: { align: 'right', fill: { color: rowFill } } },
      { text: `${data.policyMaxPct}%`, options: { align: 'right', fill: { color: rowFill } } },
      { text: statusText, options: { bold: true, align: 'center', fill: { color: statusFill } } },
    ]
  })

  slide.addTable([headerRow, ...dataRows], {
    x: 0.4, y: 1.1, w: 12.5,
    rowH: 0.32,
    fontSize: 9,
    border: { pt: 0.5, color: 'CBD5E1' },
    align: 'left',
  })

  addFooter(slide, 3)
}

// ── Slide 4 — Hedge Portfolio & MTM ──────────────────────────────────────────

function addHedgePortfolioSlide(prs: pptxgen, data: BoardReportData) {
  const slide = prs.addSlide()
  slide.background = { color: WHITE }
  addHeaderBar(slide, 'HEDGE PORTFOLIO & MARK-TO-MARKET')

  slide.addText('Active Hedge Positions', {
    x: 0.4, y: 0.7, w: 12, h: 0.4,
    fontSize: 14, color: NAVY, bold: true,
  })

  const headerRow: pptxgen.TableRow = [
    { text: 'Currency Pair', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: 'Instrument', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: 'Direction', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: 'Notional', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
    { text: 'Contracted Rate', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
    { text: 'Current Rate', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
    { text: 'MTM (USD)', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
    { text: 'Counterparty', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: 'Value Date', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
  ]

  const totalMtm = data.activePositions.reduce((s, p) => s + p.mtmUsd, 0)

  const dataRows: pptxgen.TableRow[] = data.activePositions.map((pos, idx) => {
    const mtmColor = pos.mtmUsd >= 0 ? GREEN : RED
    const rowFill = idx % 2 === 0 ? 'FFFFFF' : LIGHT_GRAY
    return [
      { text: pos.pair, options: { bold: true, fill: { color: rowFill } } },
      { text: pos.instrument, options: { fill: { color: rowFill } } },
      { text: pos.direction, options: { fill: { color: rowFill } } },
      { text: `${pos.notionalBase.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${pos.baseCcy}`, options: { align: 'right', fill: { color: rowFill } } },
      { text: pos.contractedRate.toFixed(4), options: { align: 'right', fill: { color: rowFill } } },
      { text: pos.currentRate.toFixed(4), options: { align: 'right', fill: { color: rowFill } } },
      { text: fmtUsd(pos.mtmUsd), options: { bold: true, color: mtmColor, align: 'right', fill: { color: rowFill } } },
      { text: pos.counterparty, options: { fill: { color: rowFill } } },
      { text: pos.valueDate, options: { fill: { color: rowFill } } },
    ]
  })

  const totalMtmColor = totalMtm >= 0 ? GREEN : RED
  const totalRow: pptxgen.TableRow = [
    { text: 'TOTAL', options: { bold: true, fill: { color: LIGHT_GRAY } } },
    { text: '', options: { fill: { color: LIGHT_GRAY } } },
    { text: '', options: { fill: { color: LIGHT_GRAY } } },
    { text: '', options: { fill: { color: LIGHT_GRAY } } },
    { text: '', options: { fill: { color: LIGHT_GRAY } } },
    { text: '', options: { fill: { color: LIGHT_GRAY } } },
    { text: fmtUsd(totalMtm), options: { bold: true, color: totalMtmColor, align: 'right', fill: { color: LIGHT_GRAY } } },
    { text: '', options: { fill: { color: LIGHT_GRAY } } },
    { text: '', options: { fill: { color: LIGHT_GRAY } } },
  ]

  slide.addTable([headerRow, ...dataRows, totalRow], {
    x: 0.4, y: 1.1, w: 12.5,
    rowH: 0.3,
    fontSize: 8.5,
    border: { pt: 0.5, color: 'CBD5E1' },
  })

  addFooter(slide, 4)
}

// ── Slide 5 — Upcoming Maturities ────────────────────────────────────────────

function addMaturitiesSlide(prs: pptxgen, data: BoardReportData) {
  const slide = prs.addSlide()
  slide.background = { color: WHITE }
  addHeaderBar(slide, 'UPCOMING MATURITIES & SETTLEMENT SCHEDULE')

  slide.addText('Positions maturing within 90 days', {
    x: 0.4, y: 0.7, w: 12, h: 0.4,
    fontSize: 14, color: NAVY, bold: true,
  })

  if (data.upcomingMaturities.length === 0) {
    slide.addShape('rect' as pptxgen.SHAPE_NAME, {
      x: 0.5, y: 1.2, w: 12.33, h: 0.7,
      fill: { color: 'D1FAE5' },
      line: { color: GREEN },
    })
    slide.addText('No positions maturing within 90 days. Next review window is clear.', {
      x: 0.5, y: 1.2, w: 12.33, h: 0.7,
      fontSize: 14, color: GREEN, bold: true, align: 'center', valign: 'middle',
    })
  } else {
    const headerRow: pptxgen.TableRow = [
      { text: 'Currency Pair', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Instrument', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Notional', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
      { text: 'Contracted Rate', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
      { text: 'Counterparty', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Value Date', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Days to Maturity', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'center' } },
      { text: 'Action', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'center' } },
    ]

    const dataRows: pptxgen.TableRow[] = data.upcomingMaturities.map((mat, idx) => {
      const daysColor = mat.daysToMaturity < 7 ? RED : mat.daysToMaturity <= 30 ? AMBER : TEAL
      const action = mat.daysToMaturity < 30 ? 'Roll or Close' : 'Review'
      const rowFill = idx % 2 === 0 ? 'FFFFFF' : LIGHT_GRAY
      return [
        { text: mat.pair, options: { bold: true, fill: { color: rowFill } } },
        { text: mat.instrument, options: { fill: { color: rowFill } } },
        { text: `${mat.notionalBase.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${mat.baseCcy}`, options: { align: 'right', fill: { color: rowFill } } },
        { text: mat.contractedRate.toFixed(4), options: { align: 'right', fill: { color: rowFill } } },
        { text: mat.counterparty, options: { fill: { color: rowFill } } },
        { text: mat.valueDate, options: { fill: { color: rowFill } } },
        { text: String(mat.daysToMaturity), options: { bold: true, color: daysColor, align: 'center', fill: { color: rowFill } } },
        { text: action, options: { bold: true, color: mat.daysToMaturity < 30 ? RED : TEAL, align: 'center', fill: { color: rowFill } } },
      ]
    })

    slide.addTable([headerRow, ...dataRows], {
      x: 0.4, y: 1.1, w: 12.5,
      rowH: 0.32,
      fontSize: 9,
      border: { pt: 0.5, color: 'CBD5E1' },
    })
  }

  addFooter(slide, 5)
}

// ── Slide 6 — Policy Compliance ───────────────────────────────────────────────

function addComplianceSlide(prs: pptxgen, data: BoardReportData) {
  const slide = prs.addSlide()
  slide.background = { color: WHITE }
  addHeaderBar(slide, 'POLICY COMPLIANCE & RISK SUMMARY')

  // Status banner
  const bannerFill = data.complianceStatus === 'compliant' ? GREEN : data.complianceStatus === 'under_hedged' ? RED : AMBER
  const bannerText = data.complianceStatus === 'compliant'
    ? 'COMPLIANT — Portfolio coverage is within the approved policy band'
    : data.complianceStatus === 'under_hedged'
      ? 'POLICY BREACH — Coverage below minimum threshold. Immediate action required.'
      : 'COVERAGE EXCESS — Portfolio is over-hedged. Consider reducing positions.'

  slide.addShape('rect' as pptxgen.SHAPE_NAME, {
    x: 0.4, y: 0.75, w: 12.5, h: 0.6,
    fill: { color: bannerFill },
    line: { color: bannerFill },
  })
  slide.addText(bannerText, {
    x: 0.4, y: 0.75, w: 12.5, h: 0.6,
    fontSize: 13, color: WHITE, bold: true, align: 'center', valign: 'middle',
  })

  // Policy settings table
  const coverageStatusLabel =
    data.complianceStatus === 'compliant' ? 'Within Policy Band' :
    data.complianceStatus === 'under_hedged' ? 'Under-Hedged — BREACH' : 'Over-Hedged'
  const nextReview = new Date(data.generatedAt)
  nextReview.setMonth(nextReview.getMonth() + 3)
  const nextReviewStr = nextReview.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })

  const headerRow: pptxgen.TableRow = [
    { text: 'Policy Setting', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    { text: 'Value', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
  ]
  const policyRows: pptxgen.TableRow[] = [
    [{ text: 'Minimum Coverage Threshold', options: { bold: true, fill: { color: 'FFFFFF' } } }, { text: `${data.policyMinPct}%`, options: { align: 'right', fill: { color: 'FFFFFF' } } }],
    [{ text: 'Maximum Coverage Threshold', options: { bold: true, fill: { color: LIGHT_GRAY } } }, { text: `${data.policyMaxPct}%`, options: { align: 'right', fill: { color: LIGHT_GRAY } } }],
    [{ text: 'Current Coverage', options: { bold: true, fill: { color: 'FFFFFF' } } }, { text: `${data.overallCoveragePct.toFixed(1)}%`, options: { align: 'right', fill: { color: 'FFFFFF' } } }],
    [{ text: 'Status', options: { bold: true, fill: { color: LIGHT_GRAY } } }, { text: coverageStatusLabel, options: { bold: true, color: statusColor(data.complianceStatus), align: 'right', fill: { color: LIGHT_GRAY } } }],
    [{ text: 'Base Currency', options: { bold: true, fill: { color: 'FFFFFF' } } }, { text: data.baseCurrency, options: { align: 'right', fill: { color: 'FFFFFF' } } }],
    [{ text: 'Next Review', options: { bold: true, fill: { color: LIGHT_GRAY } } }, { text: nextReviewStr, options: { align: 'right', fill: { color: LIGHT_GRAY } } }],
  ]

  slide.addTable([headerRow, ...policyRows], {
    x: 0.4, y: 1.45, w: 7,
    rowH: 0.32,
    fontSize: 10,
    border: { pt: 0.5, color: 'CBD5E1' },
  })

  // Risk statement
  slide.addText('Risk Statement', {
    x: 0.4, y: 3.75, w: 12, h: 0.35,
    fontSize: 12, color: NAVY, bold: true,
  })

  const inPolicyStr = data.complianceStatus === 'compliant' ? 'is' : 'is not'
  const recAction =
    data.complianceStatus === 'compliant'
      ? 'No immediate action is required.'
      : data.complianceStatus === 'under_hedged'
        ? 'Immediate action is required to increase hedge coverage.'
        : 'Management should consider reducing hedge positions.'

  const riskStatement = `Based on current portfolio composition, the ${data.companyName}'s FX risk programme ${inPolicyStr} operating within approved policy parameters. P&L at Risk: ${fmtUsd(data.var95Usd)} (95% confidence, 1-year horizon). ${recAction}`
  slide.addText(riskStatement, {
    x: 0.4, y: 4.1, w: 12.5, h: 0.8,
    fontSize: 10, color: DARK,
  })

  // Recommended actions
  slide.addText('Recommended Actions', {
    x: 0.4, y: 5.0, w: 12, h: 0.35,
    fontSize: 12, color: NAVY, bold: true,
  })

  const sortedPairs = [...data.coverageByPair].sort((a, b) => b.unhedgedUsd - a.unhedgedUsd)
  const topPair = sortedPairs[0]?.pair ?? 'N/A'
  const secondPair = sortedPairs[1]?.pair ?? 'N/A'
  const coverageGap = data.totalExposureUsd * (data.policyMinPct / 100) - data.totalHedgedUsd
  const nearLowerBound = data.coverageByPair.filter(
    r => r.coveragePct >= data.policyMinPct && r.coveragePct < data.policyMinPct + 5
  ).length

  let actionBullets: string[]
  if (data.complianceStatus === 'under_hedged') {
    actionBullets = [
      `Initiate hedging trades for largest unhedged pairs (${topPair}, ${secondPair})`,
      `Coverage gap of ${fmtUsd(Math.max(coverageGap, 0))} requires hedging to reach minimum policy threshold`,
      'Contact treasury banks for forward rate quotes',
    ]
  } else if (data.complianceStatus === 'over_hedged') {
    actionBullets = [
      'Consider closing or not rolling positions approaching maturity',
      'Review whether policy thresholds remain appropriate for current business cycle',
    ]
  } else {
    actionBullets = [
      'Maintain current hedge programme and review at next quarterly cycle',
      nearLowerBound > 0
        ? `Monitor ${nearLowerBound} pair${nearLowerBound !== 1 ? 's' : ''} approaching the lower policy boundary`
        : 'All currency pairs within comfortable policy ranges',
    ]
  }

  const bulletRows: pptxgen.TableRow[] = actionBullets.map(b => [
    { text: `• ${b}`, options: { fontSize: 10, color: DARK } },
  ])
  slide.addTable(bulletRows, {
    x: 0.5, y: 5.35, w: 12.33,
    rowH: 0.35,
    border: { type: 'none' },
  })

  addFooter(slide, 6)
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function generateBoardReportPptx(data: BoardReportData): Promise<void> {
  const prs = new pptxgen()
  prs.layout = 'LAYOUT_WIDE'

  addCoverSlide(prs, data)
  addExecutiveSummarySlide(prs, data)
  addExposurePolicySlide(prs, data)
  addHedgePortfolioSlide(prs, data)
  addMaturitiesSlide(prs, data)
  addComplianceSlide(prs, data)

  const dateStr = data.generatedAt.toISOString().split('T')[0]
  const periodSlug = data.reportPeriod.replace(/\s/g, '_')
  await prs.writeFile({ fileName: `Quova_Board_Report_${periodSlug}_${dateStr}.pptx` })
}
