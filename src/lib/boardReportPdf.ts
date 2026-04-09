import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── Color constants ────────────────────────────────────────────────────────────
const NAVY:  [number, number, number] = [11,  21,  38]
const TEAL:  [number, number, number] = [20,  184, 166]
const WHITE: [number, number, number] = [255, 255, 255]
const GRAY:  [number, number, number] = [100, 116, 139]
const LIGHT: [number, number, number] = [241, 245, 249]
const RED:   [number, number, number] = [220, 38,  38]
const AMBER: [number, number, number] = [217, 119, 6]
const GREEN: [number, number, number] = [5,   150, 105]
const DARK:  [number, number, number] = [15,  23,  42]

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface BoardReportData {
  companyName: string
  reportPeriod: string
  generatedAt: Date
  preparedBy: string
  policyMinPct: number
  policyMaxPct: number
  baseCurrency: string
  totalExposureUsd: number
  totalHedgedUsd: number
  overallCoveragePct: number
  complianceStatus: 'compliant' | 'under_hedged' | 'over_hedged'
  var95Usd: number
  coverageByPair: CoveragePairRow[]
  activePositions: PositionRow[]
  upcomingMaturities: MaturityRow[]
  upcomingFlows: FlowRow[]
}

export interface CoveragePairRow {
  pair: string
  exposureUsd: number
  hedgedUsd: number
  unhedgedUsd: number
  coveragePct: number
  status: 'compliant' | 'under' | 'over' | 'unhedged'
}

export interface PositionRow {
  pair: string
  instrument: string
  direction: string
  notionalBase: number
  baseCcy: string
  contractedRate: number
  currentRate: number
  mtmUsd: number
  valueDate: string
  counterparty: string
}

export interface MaturityRow {
  pair: string
  instrument: string
  notionalBase: number
  baseCcy: string
  valueDate: string
  daysToMaturity: number
  contractedRate: number
  counterparty: string
}

export interface FlowRow {
  date: string
  currency: string
  amount: number
  flowType: string
  counterparty: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function fmtUsd(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1_000_000)     return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1_000)         return `${sign}$${(abs / 1e3).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function setColor(doc: jsPDF, rgb: [number, number, number]) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2])
}

function setFill(doc: jsPDF, rgb: [number, number, number]) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2])
}

function setDraw(doc: jsPDF, rgb: [number, number, number]) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2])
}

function addPageFooter(doc: jsPDF, pageNum: number) {
  const y = 283
  setDraw(doc, [203, 213, 225])
  doc.setLineWidth(0.3)
  doc.line(18, y, 192, y)
  setColor(doc, GRAY)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text('Orbit Treasury Intelligence', 18, 289)
  doc.text('Confidential', 105, 289, { align: 'center' })
  doc.text(`Page ${pageNum}`, 192, 289, { align: 'right' })
}

function addPageHeader(doc: jsPDF, title: string) {
  setFill(doc, NAVY)
  doc.rect(0, 0, 210, 14, 'F')
  setColor(doc, WHITE)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 18, 9)
}

// ── PAGE 1 — COVER ────────────────────────────────────────────────────────────

function addCoverPage(doc: jsPDF, data: BoardReportData) {
  // Navy band
  setFill(doc, NAVY)
  doc.rect(0, 0, 210, 80, 'F')

  // Teal logo square
  setFill(doc, TEAL)
  doc.rect(18, 16, 14, 14, 'F')

  // ORBIT text
  setColor(doc, WHITE)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('ORBIT', 36, 26)

  // Treasury Intelligence
  setColor(doc, GRAY)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('Treasury Intelligence', 36, 33)

  // Teal line
  setDraw(doc, TEAL)
  doc.setLineWidth(0.5)
  doc.line(18, 38, 192, 38)

  // FX RISK MANAGEMENT
  setColor(doc, TEAL)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('FX RISK MANAGEMENT', 18, 50)

  // BOARD REPORT
  setColor(doc, WHITE)
  doc.setFontSize(28)
  doc.setFont('helvetica', 'bold')
  doc.text('BOARD REPORT', 18, 66)

  // Company name
  setColor(doc, NAVY)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(data.companyName, 18, 98)

  // Report period
  setColor(doc, GRAY)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'normal')
  doc.text(data.reportPeriod, 18, 110)

  // Prepared by
  doc.setFontSize(10)
  doc.text('Prepared by: ' + data.preparedBy, 18, 122)

  // Generated
  doc.text('Generated: ' + fmtDate(data.generatedAt), 18, 132)

  // Teal line
  setDraw(doc, TEAL)
  doc.setLineWidth(0.5)
  doc.line(18, 145, 192, 145)

  // Confidential footer
  setColor(doc, GRAY)
  doc.setFontSize(8)
  doc.text('CONFIDENTIAL — FOR BOARD AND EXECUTIVE USE ONLY', 105, 280, { align: 'center' })
}

// ── PAGE 2 — EXECUTIVE SUMMARY ────────────────────────────────────────────────

function addExecutiveSummaryPage(doc: jsPDF, data: BoardReportData, pageNum: number) {
  addPageHeader(doc, 'EXECUTIVE SUMMARY')

  // Section title
  setColor(doc, NAVY)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Key Metrics', 18, 25)

  // 4 KPI boxes
  const boxes = [
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
      valueColor: data.complianceStatus === 'compliant' ? GREEN : RED,
    },
    {
      label: 'P&L at Risk (95%)',
      value: fmtUsd(data.var95Usd),
      sub: 'annual estimate',
      valueColor: NAVY,
    },
  ]

  const boxW = 42
  const boxH = 28
  const boxY = 32
  const gap = 2

  boxes.forEach((box, i) => {
    const x = 18 + i * (boxW + gap)

    // Box border
    setFill(doc, LIGHT)
    setDraw(doc, [203, 213, 225])
    doc.setLineWidth(0.3)
    doc.roundedRect(x, boxY, boxW, boxH, 1, 1, 'FD')

    // Teal left strip
    setFill(doc, TEAL)
    doc.rect(x, boxY, 3, boxH, 'F')

    // Label
    setColor(doc, GRAY)
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.text(box.label, x + 5, boxY + 6)

    // Value
    setColor(doc, box.valueColor)
    doc.setFontSize(17)
    doc.setFont('helvetica', 'bold')
    doc.text(box.value, x + 5, boxY + 17)

    // Sub-label
    setColor(doc, GRAY)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text(box.sub, x + 5, boxY + 24)
  })

  // Portfolio Highlights title
  setColor(doc, NAVY)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Portfolio Highlights', 18, 75)

  // Teal underline
  setDraw(doc, TEAL)
  doc.setLineWidth(0.5)
  doc.line(18, 77, 70, 77)

  // Build bullets
  const pairCount = data.coverageByPair.length
  const compliantCount = data.coverageByPair.filter(r => r.status === 'compliant').length
  const maturingIn30 = data.upcomingMaturities.filter(m => m.daysToMaturity <= 30).length
  const largest = data.coverageByPair.sort((a, b) => b.unhedgedUsd - a.unhedgedUsd)[0]

  const inBand = data.overallCoveragePct >= data.policyMinPct && data.overallCoveragePct <= data.policyMaxPct
  const bandWord = inBand ? 'within' : 'outside'

  const bullets = [
    `Total FX exposure of ${fmtUsd(data.totalExposureUsd)} across ${pairCount} currency pair${pairCount !== 1 ? 's' : ''}`,
    `Overall hedge coverage of ${data.overallCoveragePct.toFixed(1)}%, ${bandWord} the ${data.policyMinPct}%–${data.policyMaxPct}% policy band`,
    `${compliantCount} of ${pairCount} tracked currency pair${pairCount !== 1 ? 's' : ''} are fully compliant with policy minimums`,
    maturingIn30 > 0
      ? `${maturingIn30} position${maturingIn30 > 1 ? 's' : ''} maturing within 30 days requiring immediate attention`
      : 'No positions maturing within 30 days',
    largest
      ? `Largest unhedged exposure: ${largest.pair} at ${fmtUsd(largest.unhedgedUsd)} (${largest.coveragePct.toFixed(0)}% coverage)`
      : 'No unhedged exposures identified',
    `P&L at risk (95% VaR): ${fmtUsd(data.var95Usd)} over a 12-month horizon`,
  ]

  setColor(doc, DARK)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  bullets.forEach((bullet, i) => {
    const y = 85 + i * 10
    // Red color for the maturity bullet if there are urgent maturities
    if (i === 3 && maturingIn30 > 0) {
      setColor(doc, RED)
    } else {
      setColor(doc, DARK)
    }
    doc.text(`• ${bullet}`, 22, y)
  })

  addPageFooter(doc, pageNum)
}

// ── PAGE 3 — FX EXPOSURE VS POLICY ───────────────────────────────────────────

function addExposurePolicyPage(doc: jsPDF, data: BoardReportData, pageNum: number) {
  addPageHeader(doc, 'FX EXPOSURE VS. POLICY')

  setColor(doc, GRAY)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  const introText = 'The following table shows foreign currency exposure by currency pair, current hedge coverage levels, and compliance with policy thresholds. Pairs outside the policy band are highlighted.'
  const splitIntro = doc.splitTextToSize(introText, 174)
  doc.text(splitIntro, 18, 20)

  // Coverage table
  const tableBody = data.coverageByPair.map((row, idx) => {
    const statusText = row.status === 'compliant' ? 'Compliant' : row.status === 'under' ? 'Under-hedged' : row.status === 'over' ? 'Over-hedged' : 'Unhedged'
    const statusFill = row.status === 'compliant'
      ? [209, 250, 229]
      : row.status === 'over'
        ? [255, 243, 205]
        : [254, 226, 226]

    return [
      row.pair,
      fmtUsd(row.exposureUsd),
      fmtUsd(row.hedgedUsd),
      fmtUsd(row.unhedgedUsd),
      `${row.coveragePct.toFixed(1)}%`,
      `${data.policyMinPct}%`,
      `${data.policyMaxPct}%`,
      { content: statusText, styles: { fillColor: statusFill as [number, number, number], fontStyle: 'bold' as const } },
    ]
  })

  autoTable(doc, {
    startY: 35,
    head: [['Currency Pair', 'Exposure (USD)', 'Hedged (USD)', 'Unhedged (USD)', 'Coverage %', 'Policy Min', 'Policy Max', 'Status']],
    body: tableBody,
    headStyles: {
      fillColor: NAVY,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
    margin: { left: 18, right: 18 },
  })

  const finalY: number = (doc as any).lastAutoTable?.finalY ?? 120

  // Note box
  const noteY = finalY + 6
  if (noteY < 240) {
    setFill(doc, LIGHT)
    setDraw(doc, [203, 213, 225])
    doc.setLineWidth(0.3)
    doc.rect(18, noteY, 174, 10, 'FD')
    setColor(doc, GRAY)
    doc.setFontSize(7.5)
    doc.text(`Coverage % = Hedged Amount ÷ Total Exposure. Policy requires coverage between ${data.policyMinPct}%–${data.policyMaxPct}%.`, 22, noteY + 7)
  }

  // Coverage at a Glance section
  let glanceY = noteY + 18
  if (glanceY > 220) {
    doc.addPage()
    glanceY = 20
  }

  setColor(doc, NAVY)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Coverage at a Glance', 18, glanceY)
  setDraw(doc, TEAL)
  doc.setLineWidth(0.5)
  doc.line(18, glanceY + 2, 80, glanceY + 2)

  const barStartX = 52
  const barWidth = 100
  const rowH = 8

  data.coverageByPair.forEach((row, i) => {
    const y = glanceY + 8 + i * rowH
    if (y > 270) return

    // Label
    setColor(doc, DARK)
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.text(row.pair, 18, y + 4)

    // Background bar (gray)
    setFill(doc, [226, 232, 240])
    doc.rect(barStartX, y, barWidth, 5, 'F')

    // Filled portion
    const fillW = Math.min((row.coveragePct / 100) * barWidth, barWidth)
    const barColor: [number, number, number] = row.coveragePct === 0
      ? RED
      : row.coveragePct < data.policyMinPct
        ? AMBER
        : TEAL
    setFill(doc, barColor)
    if (fillW > 0) doc.rect(barStartX, y, fillW, 5, 'F')

    // Percentage text
    setColor(doc, GRAY)
    doc.setFontSize(7.5)
    doc.text(`${row.coveragePct.toFixed(1)}%`, barStartX + barWidth + 3, y + 4)
  })

  addPageFooter(doc, pageNum)
}

// ── PAGE 4 — HEDGE PORTFOLIO & MTM ───────────────────────────────────────────

function addHedgePortfolioPage(doc: jsPDF, data: BoardReportData, pageNum: number) {
  addPageHeader(doc, 'HEDGE PORTFOLIO & MARK-TO-MARKET')

  setColor(doc, GRAY)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  const introText = `Active hedge positions with mark-to-market valuations as of ${fmtDate(data.generatedAt)}. MTM represents the unrealized gain/loss on the hedge instrument; the underlying exposure gain/loss largely offsets this for a functioning hedge.`
  const splitIntro = doc.splitTextToSize(introText, 174)
  doc.text(splitIntro, 18, 20)

  const totalMtm = data.activePositions.reduce((s, p) => s + p.mtmUsd, 0)

  const tableBody = data.activePositions.map(pos => {
    const mtmColor: [number, number, number] = pos.mtmUsd >= 0 ? GREEN : RED
    return [
      pos.pair,
      pos.instrument,
      pos.direction,
      `${pos.notionalBase.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${pos.baseCcy}`,
      pos.contractedRate.toFixed(4),
      pos.currentRate.toFixed(4),
      { content: fmtUsd(pos.mtmUsd), styles: { textColor: mtmColor, fontStyle: 'bold' as const } },
      pos.counterparty,
      pos.valueDate,
    ]
  })

  // Total row
  const totalMtmColor: [number, number, number] = totalMtm >= 0 ? GREEN : RED
  tableBody.push([
    { content: 'TOTAL', styles: { textColor: DARK, fontStyle: 'bold' as const } },
    '', '', '', '', '',
    { content: fmtUsd(totalMtm), styles: { textColor: totalMtmColor, fontStyle: 'bold' as const } },
    '', '',
  ])

  autoTable(doc, {
    startY: 32,
    head: [['Currency Pair', 'Instrument', 'Direction', 'Notional', 'Contracted Rate', 'Current Rate', 'MTM (USD)', 'Counterparty', 'Value Date']],
    body: tableBody,
    headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5 },
    bodyStyles: { fontSize: 7.5 },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
    margin: { left: 18, right: 18 },
  })

  const finalY: number = (doc as any).lastAutoTable?.finalY ?? 150

  // MTM callout box
  const boxY = finalY + 8
  if (boxY < 250) {
    const mtmPositive = totalMtm >= 0
    const boxFill: [number, number, number] = mtmPositive ? [209, 250, 229] : [254, 226, 226]
    setFill(doc, boxFill)
    setDraw(doc, mtmPositive ? GREEN : RED)
    doc.setLineWidth(0.5)
    doc.rect(18, boxY, 174, 22, 'FD')

    setColor(doc, DARK)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(`Hedge Instrument MTM: ${fmtUsd(totalMtm)}`, 22, boxY + 8)

    setColor(doc, GRAY)
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    const noteText = 'Note: This figure represents the mark-to-market of hedge instruments only. The offsetting gain/loss on the underlying FX exposures approximately cancels this out for a well-matched hedge programme.'
    const splitNote = doc.splitTextToSize(noteText, 166)
    doc.text(splitNote, 22, boxY + 15)
  }

  addPageFooter(doc, pageNum)
}

// ── PAGE 5 — UPCOMING MATURITIES ─────────────────────────────────────────────

function addMaturitiesPage(doc: jsPDF, data: BoardReportData, pageNum: number) {
  addPageHeader(doc, 'UPCOMING MATURITIES & SETTLEMENT SCHEDULE')

  setColor(doc, GRAY)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  doc.text('Positions maturing within the next 90 days. Review each position for roll-over requirements or replacement hedges.', 18, 20)

  if (data.upcomingMaturities.length === 0) {
    setFill(doc, [209, 250, 229])
    setDraw(doc, GREEN)
    doc.setLineWidth(0.5)
    doc.rect(18, 30, 174, 16, 'FD')
    setColor(doc, GREEN)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('No positions maturing within 90 days. Next review window is clear.', 105, 41, { align: 'center' })
  } else {
    const tableBody = data.upcomingMaturities.map(mat => {
      const daysColor: [number, number, number] = mat.daysToMaturity < 7 ? RED : mat.daysToMaturity <= 30 ? AMBER : TEAL
      const action = mat.daysToMaturity < 30 ? 'Roll or Close' : 'Review'
      return [
        mat.pair,
        mat.instrument,
        `${mat.notionalBase.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${mat.baseCcy}`,
        mat.contractedRate.toFixed(4),
        mat.counterparty,
        mat.valueDate,
        { content: String(mat.daysToMaturity), styles: { textColor: daysColor, fontStyle: 'bold' as const } },
        { content: action, styles: { textColor: mat.daysToMaturity < 30 ? RED : TEAL, fontStyle: 'bold' as const } },
      ]
    })

    autoTable(doc, {
      startY: 28,
      head: [['Currency Pair', 'Instrument', 'Notional', 'Contracted Rate', 'Counterparty', 'Value Date', 'Days to Maturity', 'Action']],
      body: tableBody,
      headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: LIGHT },
      columnStyles: {
        3: { halign: 'right' },
        6: { halign: 'center' },
      },
      margin: { left: 18, right: 18 },
    })
  }

  addPageFooter(doc, pageNum)
}

// ── PAGE 6 — POLICY COMPLIANCE & RISK SUMMARY ────────────────────────────────

function addCompliancePage(doc: jsPDF, data: BoardReportData, pageNum: number) {
  addPageHeader(doc, 'POLICY COMPLIANCE & RISK SUMMARY')

  // Section title
  setColor(doc, NAVY)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Compliance Status', 18, 22)

  // Status banner
  const bannerFill: [number, number, number] =
    data.complianceStatus === 'compliant' ? GREEN :
    data.complianceStatus === 'under_hedged' ? RED : AMBER
  const bannerText =
    data.complianceStatus === 'compliant'
      ? 'COMPLIANT — Portfolio coverage is within policy band'
      : data.complianceStatus === 'under_hedged'
        ? 'POLICY BREACH — Coverage below minimum threshold. Immediate action required.'
        : 'COVERAGE EXCESS — Portfolio is over-hedged. Consider reducing positions.'

  setFill(doc, bannerFill)
  doc.rect(18, 26, 174, 16, 'F')
  setColor(doc, WHITE)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(bannerText, 105, 37, { align: 'center' })

  // Policy table
  const nextReview = new Date(data.generatedAt)
  nextReview.setMonth(nextReview.getMonth() + 3)
  const nextReviewStr = nextReview.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })

  const coverageStatusLabel =
    data.complianceStatus === 'compliant' ? 'Within Policy Band' :
    data.complianceStatus === 'under_hedged' ? 'Under-Hedged — BREACH' : 'Over-Hedged'

  autoTable(doc, {
    startY: 50,
    head: [['Policy Setting', 'Value']],
    body: [
      ['Minimum Coverage Threshold', `${data.policyMinPct}%`],
      ['Maximum Coverage Threshold', `${data.policyMaxPct}%`],
      ['Current Coverage', `${data.overallCoveragePct.toFixed(1)}%`],
      ['Status', coverageStatusLabel],
      ['Base Currency', data.baseCurrency],
      ['Next Review', nextReviewStr],
    ],
    headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 100 },
      1: { halign: 'right' },
    },
    margin: { left: 18, right: 18 },
  })

  // Risk Statement
  setColor(doc, NAVY)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Risk Statement', 18, 122)

  const inPolicyStr = data.complianceStatus === 'compliant' ? 'is' : 'is not'
  const positionDesc = data.activePositions.length > 0
    ? `${data.activePositions.length} active hedge position${data.activePositions.length !== 1 ? 's' : ''} across ${data.coverageByPair.length} currency pair${data.coverageByPair.length !== 1 ? 's' : ''}`
    : 'current portfolio composition'
  const recAction =
    data.complianceStatus === 'compliant'
      ? 'No immediate action is required. Continue to monitor the programme at the next quarterly review.'
      : data.complianceStatus === 'under_hedged'
        ? 'Immediate action is required to increase hedge coverage to meet the minimum policy threshold.'
        : 'Management should consider reducing hedge positions to return coverage within the approved band.'

  const riskText = `Based on current portfolio composition, the ${data.companyName}'s FX risk programme ${inPolicyStr} operating within approved policy parameters. The P&L at Risk estimate of ${fmtUsd(data.var95Usd)} (95% confidence, 1-year horizon) reflects ${positionDesc}. ${recAction}`
  setColor(doc, DARK)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  const splitRisk = doc.splitTextToSize(riskText, 174)
  doc.text(splitRisk, 18, 130)

  // Recommended Actions
  setColor(doc, NAVY)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Recommended Actions', 18, 162)

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
      `Initiate hedging trades for the largest unhedged pairs (${topPair}, ${secondPair})`,
      `Coverage gap of ${fmtUsd(Math.max(coverageGap, 0))} requires hedging to reach minimum policy threshold`,
      'Contact treasury banks to obtain forward rate quotes',
      'Escalate to CFO and Risk Committee for policy breach notification',
    ]
  } else if (data.complianceStatus === 'over_hedged') {
    actionBullets = [
      'Consider closing or not rolling positions approaching maturity to reduce coverage',
      'Review if policy thresholds are still appropriate for current business cycle',
      'Consult with CFO before executing any position reductions',
    ]
  } else {
    actionBullets = [
      'Maintain current hedge programme and review at next quarterly cycle',
      nearLowerBound > 0
        ? `Monitor ${nearLowerBound} pair${nearLowerBound !== 1 ? 's' : ''} approaching the lower policy boundary`
        : 'All currency pairs are within comfortable policy ranges',
      'Schedule next board reporting cycle for end of quarter',
    ]
  }

  setColor(doc, DARK)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  actionBullets.forEach((bullet, i) => {
    doc.text(`• ${bullet}`, 22, 170 + i * 9)
  })

  // Footer note
  setColor(doc, GRAY)
  doc.setFontSize(7.5)
  doc.text(
    `This report was generated by Orbit Treasury Intelligence on ${fmtDate(data.generatedAt)}. For questions contact your Treasury team.`,
    105,
    260,
    { align: 'center' },
  )

  addPageFooter(doc, pageNum)
}

// ── Main function ─────────────────────────────────────────────────────────────

export function generateBoardReportPdf(data: BoardReportData): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  // Page 1 — Cover
  addCoverPage(doc, data)

  // Page 2 — Executive Summary
  doc.addPage()
  addExecutiveSummaryPage(doc, data, 2)

  // Page 3 — FX Exposure vs Policy
  doc.addPage()
  addExposurePolicyPage(doc, data, 3)

  // Page 4 — Hedge Portfolio & MTM
  doc.addPage()
  addHedgePortfolioPage(doc, data, 4)

  // Page 5 — Upcoming Maturities
  doc.addPage()
  addMaturitiesPage(doc, data, 5)

  // Page 6 — Policy Compliance & Risk Summary
  doc.addPage()
  addCompliancePage(doc, data, 6)

  // Save
  const dateStr = data.generatedAt.toISOString().split('T')[0]
  const periodSlug = data.reportPeriod.replace(/\s/g, '_')
  doc.save(`Orbit_Board_Report_${periodSlug}_${dateStr}.pdf`)
}
