import { useState } from 'react'
import { FileText, Download, Table, CheckCircle } from 'lucide-react'
import { useExposures, useHedgePositions, useHedgeCoverage, useHedgePolicy } from '@/hooks/useData'
import { formatCurrency, formatDate, formatPct, COVERAGE_LABELS, getCoverageStatus } from '@/lib/utils'

type ReportType = 'exposure_summary' | 'hedge_positions' | 'coverage_report' | 'board_pack'

const REPORTS = [
  {
    id: 'exposure_summary' as ReportType,
    title: 'FX Exposure Summary',
    description: 'Complete ledger of open FX exposures by entity, currency pair, and settlement date.',
    formats: ['Excel', 'PDF'],
    icon: '📊',
  },
  {
    id: 'hedge_positions' as ReportType,
    title: 'Hedge Position Report',
    description: 'Active forward and swap positions with contracted rates and settlement dates.',
    formats: ['Excel', 'PDF'],
    icon: '🛡️',
  },
  {
    id: 'coverage_report' as ReportType,
    title: 'Policy Coverage Report',
    description: 'Hedge coverage ratio vs. policy targets per currency pair. Flags gaps and overage.',
    formats: ['Excel', 'PDF'],
    icon: '📋',
  },
  {
    id: 'board_pack' as ReportType,
    title: 'Board / CFO Pack',
    description: 'One-page executive summary: net exposure, hedge ratio, coverage status, and upcoming settlements.',
    formats: ['PDF'],
    icon: '📄',
  },
]

export function ReportsPage() {
  const { exposures } = useExposures()
  const { positions } = useHedgePositions()
  const { coverage } = useHedgeCoverage()
  const { policy } = useHedgePolicy()
  const [generating, setGenerating] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function generateExcel(type: ReportType) {
    const XLSX = await import('xlsx')
    let wb = XLSX.utils.book_new()

    if (type === 'exposure_summary' || type === 'board_pack') {
      const rows = exposures.map(e => ({
        Entity: e.entity,
        'Currency Pair': e.currency_pair,
        Direction: e.direction,
        'Notional (Base)': e.notional_base,
        'Base Currency': e.base_currency,
        'Settlement Date': formatDate(e.settlement_date),
        Description: e.description ?? '',
        Status: e.status,
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Exposures')
    }

    if (type === 'hedge_positions' || type === 'board_pack') {
      const rows = positions.map(p => ({
        Instrument: p.instrument_type,
        'Currency Pair': p.currency_pair,
        Direction: p.direction,
        'Notional (Base)': p.notional_base,
        'Contracted Rate': p.contracted_rate,
        'Trade Date': formatDate(p.trade_date),
        'Settlement Date': formatDate(p.value_date),
        Counterparty: p.counterparty_bank ?? '',
        Reference: p.reference_number ?? '',
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Hedge Positions')
    }

    if (type === 'coverage_report' || type === 'board_pack') {
      const rows = coverage.map(c => ({
        'Currency Pair': c.currency_pair,
        'Net Exposure': c.net_exposure,
        'Total Hedged': c.total_hedged,
        'Unhedged Amount': c.unhedged_amount,
        'Coverage %': `${c.coverage_pct.toFixed(1)}%`,
        Status: COVERAGE_LABELS[getCoverageStatus(c.coverage_pct, policy)],
        'Policy Min %': policy?.min_coverage_pct ?? '',
        'Policy Max %': policy?.max_coverage_pct ?? '',
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Coverage Analysis')
    }

    const filename = `Orbit_${type}_${new Date().toISOString().split('T')[0]}.xlsx`
    XLSX.writeFile(wb, filename)
  }

  async function generatePdf(type: ReportType) {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    // Header
    doc.setFillColor(8, 15, 26)
    doc.rect(0, 0, 297, 22, 'F')
    doc.setTextColor(0, 200, 160)
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text('ORBIT', 14, 14)
    doc.setTextColor(200, 210, 220)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text('FX Risk Intelligence Platform', 36, 14)
    doc.setTextColor(100, 120, 140)
    doc.text(`Generated: ${today}`, 200, 14)

    let y = 30

    if (type === 'board_pack' || type === 'coverage_report') {
      // Summary stats
      const totalExposure = exposures.reduce((s, e) => s + Math.abs(e.notional_base), 0)
      const totalHedged = positions.reduce((s, p) => s + p.notional_base, 0)
      const coveragePct = totalExposure > 0 ? (totalHedged / totalExposure) * 100 : 0

      doc.setTextColor(30, 40, 50)
      doc.setFontSize(13)
      doc.setFont('helvetica', 'bold')
      doc.text('Executive FX Summary', 14, y)
      y += 8

      const stats = [
        ['Total Net Exposure', formatCurrency(totalExposure, 'USD', true)],
        ['Total Hedged', formatCurrency(totalHedged, 'USD', true)],
        ['Overall Coverage', formatPct(coveragePct)],
        ['Open Exposures', `${exposures.length} items`],
        ['Active Hedges', `${positions.length} positions`],
      ]
      stats.forEach(([label, value]) => {
        doc.setFontSize(10)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(80, 90, 100)
        doc.text(label + ':', 14, y)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(0, 200, 160)
        doc.text(value, 70, y)
        y += 6
      })
      y += 4
    }

    if (type === 'exposure_summary' || type === 'board_pack') {
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30, 40, 50)
      doc.text('FX Exposure Ledger', 14, y)
      y += 4

      autoTable(doc, {
        startY: y,
        head: [['Entity', 'Currency Pair', 'Direction', 'Notional', 'Settlement Date', 'Status']],
        body: exposures.slice(0, 30).map(e => [
          e.entity, e.currency_pair, e.direction,
          formatCurrency(e.notional_base, e.base_currency),
          formatDate(e.settlement_date), e.status,
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [13, 26, 41], textColor: [0, 200, 160], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 249, 250] },
        margin: { left: 14, right: 14 },
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }

    if (type === 'coverage_report' || type === 'board_pack') {
      if (y > 160) { doc.addPage(); y = 20 }
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30, 40, 50)
      doc.text('Coverage Analysis vs. Policy', 14, y)
      y += 4

      autoTable(doc, {
        startY: y,
        head: [['Currency Pair', 'Net Exposure', 'Hedged', 'Unhedged', 'Coverage %', 'Status']],
        body: coverage.map(c => {
          const status = getCoverageStatus(c.coverage_pct, policy)
          return [
            c.currency_pair,
            formatCurrency(Math.abs(c.net_exposure), 'USD', true),
            formatCurrency(c.total_hedged, 'USD', true),
            formatCurrency(Math.max(c.unhedged_amount, 0), 'USD', true),
            formatPct(c.coverage_pct),
            COVERAGE_LABELS[status],
          ]
        }),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [13, 26, 41], textColor: [0, 200, 160], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 249, 250] },
        margin: { left: 14, right: 14 },
      })
    }

    if (type === 'hedge_positions') {
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30, 40, 50)
      doc.text('Hedge Positions', 14, y)
      y += 4

      autoTable(doc, {
        startY: y,
        head: [['Instrument', 'Currency Pair', 'Direction', 'Notional', 'Rate', 'Settlement', 'Counterparty']],
        body: positions.map(p => [
          p.instrument_type, p.currency_pair, p.direction,
          formatCurrency(p.notional_base, p.base_currency),
          p.contracted_rate.toFixed(4),
          formatDate(p.value_date),
          p.counterparty_bank ?? '—',
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [13, 26, 41], textColor: [0, 200, 160], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 249, 250] },
        margin: { left: 14, right: 14 },
      })
    }

    // Footer
    doc.setFontSize(7)
    doc.setTextColor(150, 160, 170)
    doc.text('Confidential — Generated by Orbit FX Risk Intelligence Platform', 14, 200)

    doc.save(`Orbit_${type}_${new Date().toISOString().split('T')[0]}.pdf`)
  }

  async function handleGenerate(reportId: ReportType, format: string) {
    const key = `${reportId}_${format}`
    setGenerating(key)
    setDone(null)
    try {
      if (format === 'Excel') await generateExcel(reportId)
      else await generatePdf(reportId)
      setDone(key)
      setTimeout(() => setDone(null), 3000)
    } catch (e) {
      console.error('Report generation failed:', e)
    }
    setGenerating(null)
  }

  return (
    <div style={{ padding: '1.75rem', maxWidth: 900 }} className="fade-in">
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Reports</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
          Download FX exposure and hedge reports in PDF or Excel format
        </p>
      </div>

      {/* Data summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.75rem' }}>
        {[
          { label: 'Open Exposures', value: exposures.length, icon: '📈' },
          { label: 'Active Hedges',  value: positions.length, icon: '🛡️' },
          { label: 'Currency Pairs', value: coverage.length,  icon: '💱' },
        ].map(({ label, value, icon }) => (
          <div key={label} className="card" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
            <span style={{ fontSize: '1.5rem' }}>{icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.5rem', fontFamily: 'var(--font-mono)' }}>{value}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Report cards — Screen 14 FX Report grid style */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {REPORTS.map(report => (
          <div key={report.id} className="card">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem', marginBottom: '1rem' }}>
              <span style={{ fontSize: '1.75rem', lineHeight: 1 }}>{report.icon}</span>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: '0.25rem' }}>{report.title}</h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{report.description}</p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {report.formats.map(fmt => {
                const key = `${report.id}_${fmt}`
                const isGenerating = generating === key
                const isDone = done === key
                const Icon = fmt === 'Excel' ? Table : FileText

                return (
                  <button key={fmt} className="btn btn-ghost btn-sm"
                    style={{ flex: 1, justifyContent: 'center', color: isDone ? 'var(--green)' : undefined }}
                    onClick={() => handleGenerate(report.id, fmt)} disabled={!!generating}>
                    {isGenerating ? (
                      <><span className="spinner" style={{ width: 13, height: 13 }} /> Generating…</>
                    ) : isDone ? (
                      <><CheckCircle size={13} /> Downloaded</>
                    ) : (
                      <><Icon size={13} /> {fmt}</>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <p style={{ marginTop: '1.5rem', fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'center' }}>
        Reports are generated from live data and downloaded directly to your device.
      </p>
    </div>
  )
}
