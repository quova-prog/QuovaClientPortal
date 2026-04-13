// ============================================================
// QUOVA: Condensed Daily Digest PDF (1-2 pages)
// Uses jsPDF via esm.sh — works in Deno without a DOM
// ============================================================

import jsPDF from 'https://esm.sh/jspdf@2.5.1'
import autoTable from 'https://esm.sh/jspdf-autotable@3.8.2'

const NAVY:  [number, number, number] = [11,  21,  38]
const TEAL:  [number, number, number] = [20,  184, 166]
const WHITE: [number, number, number] = [255, 255, 255]
const GRAY:  [number, number, number] = [100, 116, 139]
const LIGHT: [number, number, number] = [241, 245, 249]
const RED:   [number, number, number] = [220, 38,  38]
const AMBER: [number, number, number] = [217, 119, 6]
const GREEN: [number, number, number] = [5,   150, 105]
const DARK:  [number, number, number] = [15,  23,  42]

export interface DigestPdfData {
  orgName: string
  date: string
  totalExposureUsd: number
  totalHedgedUsd: number
  overallCoveragePct: number
  activeHedgeCount: number
  unhedgedUsd: number
  policyMinPct: number
  policyMaxPct: number
  coverageByPair: { pair: string; exposureUsd: number; hedgedUsd: number; coveragePct: number; status: string }[]
  alerts: { severity: string; type: string; title: string; created_at: string }[]
  maturingPositions: { pair: string; instrument: string; notionalUsd: number; valueDate: string; daysToMaturity: number }[]
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1_000_000)     return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1_000)         return `${sign}$${(abs / 1e3).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

export function generateDigestPdf(data: DigestPdfData): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  let y = 0

  // ── Header bar ──────────────────────────────────────────────────────
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 28, 'F')
  doc.setTextColor(...WHITE)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Quova', 14, 12)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...TEAL)
  doc.text('Daily FX Risk Digest', 14, 20)
  doc.setTextColor(...WHITE)
  doc.setFontSize(9)
  doc.text(data.date, W - 14, 12, { align: 'right' })
  doc.text(data.orgName, W - 14, 20, { align: 'right' })

  y = 36

  // ── KPI Tiles ───────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total Exposure', value: fmtUsd(data.totalExposureUsd), color: DARK },
    { label: 'Coverage', value: `${data.overallCoveragePct.toFixed(1)}%`, color: data.overallCoveragePct >= data.policyMinPct ? GREEN : RED },
    { label: 'Active Hedges', value: String(data.activeHedgeCount), color: DARK },
    { label: 'Unhedged', value: fmtUsd(data.unhedgedUsd), color: data.unhedgedUsd > 0 ? RED : GREEN },
  ]
  const kpiW = (W - 28 - 12) / 2
  kpis.forEach((kpi, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = 14 + col * (kpiW + 4)
    const ky = y + row * 22
    doc.setFillColor(...LIGHT)
    doc.roundedRect(x, ky, kpiW, 18, 2, 2, 'F')
    doc.setTextColor(...kpi.color)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text(kpi.value, x + kpiW / 2, ky + 8, { align: 'center' })
    doc.setTextColor(...GRAY)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text(kpi.label.toUpperCase(), x + kpiW / 2, ky + 14, { align: 'center' })
  })

  y += 48

  // ── Compliance status ───────────────────────────────────────────────
  const isCompliant = data.overallCoveragePct >= data.policyMinPct && data.overallCoveragePct <= data.policyMaxPct
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...(isCompliant ? GREEN : RED))
  doc.text(
    isCompliant
      ? `Compliant — coverage within policy range (${data.policyMinPct}%–${data.policyMaxPct}%)`
      : `Non-compliant — coverage outside policy range (${data.policyMinPct}%–${data.policyMaxPct}%)`,
    14, y,
  )
  y += 8

  // ── Coverage by pair table ──────────────────────────────────────────
  if (data.coverageByPair.length > 0) {
    doc.setTextColor(...DARK)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Coverage by Currency Pair', 14, y)
    y += 4

    autoTable(doc, {
      startY: y,
      head: [['Pair', 'Exposure (USD)', 'Hedged (USD)', 'Coverage %', 'Status']],
      body: data.coverageByPair.map(c => [
        c.pair,
        fmtUsd(c.exposureUsd),
        fmtUsd(c.hedgedUsd),
        `${c.coveragePct.toFixed(1)}%`,
        c.status.replace(/_/g, ' '),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: LIGHT },
      margin: { left: 14, right: 14 },
    })
    y = (doc as any).lastAutoTable.finalY + 8
  }

  // ── Alert summary table ─────────────────────────────────────────────
  if (data.alerts.length > 0) {
    // Check if we need a new page
    if (y > 240) { doc.addPage(); y = 20 }

    doc.setTextColor(...DARK)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Recent Alerts (24h)', 14, y)
    y += 4

    autoTable(doc, {
      startY: y,
      head: [['Severity', 'Type', 'Alert']],
      body: data.alerts.slice(0, 15).map(a => [
        a.severity,
        a.type.replace(/_/g, ' '),
        a.title,
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: LIGHT },
      margin: { left: 14, right: 14 },
      columnStyles: {
        0: { cellWidth: 20, fontStyle: 'bold' },
        1: { cellWidth: 30 },
      },
      didParseCell: (hookData: any) => {
        if (hookData.column.index === 0 && hookData.section === 'body') {
          const val = hookData.cell.raw as string
          if (val === 'urgent') hookData.cell.styles.textColor = RED
          else if (val === 'warning') hookData.cell.styles.textColor = AMBER
          else hookData.cell.styles.textColor = TEAL
        }
      },
    })
    y = (doc as any).lastAutoTable.finalY + 8
  }

  // ── Maturing positions ──────────────────────────────────────────────
  if (data.maturingPositions.length > 0) {
    if (y > 240) { doc.addPage(); y = 20 }

    doc.setTextColor(...DARK)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Maturing Positions (7 days)', 14, y)
    y += 4

    autoTable(doc, {
      startY: y,
      head: [['Pair', 'Instrument', 'Notional (USD)', 'Value Date', 'Days']],
      body: data.maturingPositions.map(m => [
        m.pair,
        m.instrument,
        fmtUsd(m.notionalUsd),
        m.valueDate,
        String(m.daysToMaturity),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: LIGHT },
      margin: { left: 14, right: 14 },
    })
  }

  // ── Footer ──────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    const pH = doc.internal.pageSize.getHeight()
    doc.setFillColor(...LIGHT)
    doc.rect(0, pH - 12, W, 12, 'F')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    doc.text(`Generated by Quova · ${data.date}`, 14, pH - 4)
    doc.text(`Page ${i} of ${pageCount}`, W - 14, pH - 4, { align: 'right' })
  }

  return doc.output('arraybuffer') as unknown as Uint8Array
}
