const fs = require('fs')
const path = require('path')
const { jsPDF } = require('jspdf')

const outputDir = path.join(__dirname, '..', 'output', 'pdf')
const outputPath = path.join(outputDir, 'orbit-app-summary.pdf')

fs.mkdirSync(outputDir, { recursive: true })

const doc = new jsPDF({
  orientation: 'landscape',
  unit: 'pt',
  format: 'letter',
  compress: true,
})

const pageWidth = doc.internal.pageSize.getWidth()
const pageHeight = doc.internal.pageSize.getHeight()
const margin = 30
const gutter = 20
const innerWidth = pageWidth - margin * 2
const colWidth = (innerWidth - gutter) / 2
const leftX = margin
const rightX = margin + colWidth + gutter
const boxRadius = 10

function roundRect(x, y, w, h, fill) {
  doc.roundedRect(x, y, w, h, boxRadius, boxRadius, fill ? 'FD' : 'S')
}

function drawHeader() {
  doc.setFillColor(14, 31, 47)
  doc.roundedRect(margin, margin, innerWidth, 58, 12, 12, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  doc.text('Orbit App Summary', margin + 18, margin + 25)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('One-page repo-based overview', margin + 18, margin + 42)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Source basis: code and docs in this repo only', pageWidth - margin - 18, margin + 34, { align: 'right' })
}

function drawSectionTitle(title, x, y, width) {
  doc.setFillColor(232, 242, 245)
  doc.setDrawColor(205, 221, 226)
  roundRect(x, y, width, 22, true)
  doc.setTextColor(18, 43, 54)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(title, x + 10, y + 15)
  return y + 32
}

function drawParagraph(text, x, y, width, opts = {}) {
  const fontSize = opts.fontSize || 9.4
  const leading = opts.leading || 12
  doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
  doc.setFontSize(fontSize)
  doc.setTextColor(33, 37, 41)
  const lines = doc.splitTextToSize(text, width)
  doc.text(lines, x, y)
  return y + lines.length * leading
}

function drawBullets(items, x, y, width, opts = {}) {
  const fontSize = opts.fontSize || 9.2
  const leading = opts.leading || 11.5
  const bulletIndent = 10
  const textWidth = width - bulletIndent - 4
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(fontSize)
  doc.setTextColor(33, 37, 41)

  items.forEach((item) => {
    const lines = doc.splitTextToSize(item, textWidth)
    doc.text('-', x, y)
    doc.text(lines, x + bulletIndent, y)
    y += lines.length * leading + 2
  })
  return y
}

drawHeader()

let leftY = margin + 78
let rightY = margin + 78

leftY = drawSectionTitle('What It Is', leftX, leftY, colWidth)
leftY = drawParagraph(
  'Orbit is an FX risk intelligence platform for tracking currency exposures, hedge policy, hedge positions, and treasury operations in one web app. The repo shows a React + TypeScript + Vite frontend backed by Supabase Auth and Postgres, with no custom backend server found in repo.',
  leftX + 2,
  leftY,
  colWidth - 4,
)

leftY += 8
leftY = drawSectionTitle('Who It Is For', leftX, leftY, colWidth)
leftY = drawParagraph(
  'Primary persona: treasury, CFO, or finance teams managing multi-entity FX exposure and hedging programs. This is inferred from repo evidence such as the "FX Risk Intelligence Platform" login copy, CFO-focused advisor section, and pages for bank accounts, counterparties, hedge policy, analytics, and audit logs.',
  leftX + 2,
  leftY,
  colWidth - 4,
)

leftY += 8
leftY = drawSectionTitle('How It Works', leftX, leftY, colWidth)
leftY = drawBullets([
  'SPA shell: src/main.tsx mounts the app; src/App.tsx adds AuthProvider, EntityProvider, routing, protected routes, and shared layout.',
  'UI layer: route pages under src/pages cover dashboard, upload, exposure, strategy, advisor, hedge, trade, analytics, integrations, settings, inbox, and audit log.',
  'Data layer: hooks under src/hooks read and write Supabase tables/views such as fx_exposures, hedge_positions, hedge_policies, upload_batches, alerts, and audit_logs.',
  'Auth flow: useAuth.tsx validates a cached session, creates a JWT-scoped Supabase client, and supports sign-up, sign-in, MFA, and sign-out.',
  'Ingestion flow: UploadWizard accepts CSV/XLS/XLSX, runs dataset-specific parsers in src/lib, then imports rows into Supabase with upload dedup support.',
  'Rates flow: useLiveFxRates.ts fetches ECB-based rates through the Frankfurter service, refreshes every 5 minutes, and upserts rates into Supabase.',
], leftX + 2, leftY, colWidth - 4, { fontSize: 8.5, leading: 10.4 })

rightY = drawSectionTitle('What It Does', rightX, rightY, colWidth)
rightY = drawBullets([
  'Uploads and validates treasury data files with step-by-step review before import.',
  'Tracks open FX exposures and hedge positions, then computes coverage and unhedged amounts.',
  'Shows dashboard metrics across exposures, cash flows, purchase orders, contracts, loans, payroll, capex, forecasts, and intercompany transfers.',
  'Supports strategy and hedge policy workflows, including target ratios and threshold-based controls.',
  'Provides a hedge advisor and trade workflow for turning exposure gaps into action plans and position records.',
  'Refreshes live FX rates and uses them in dashboard, analytics, and conversion logic.',
  'Includes operational controls such as alerts/inbox, entity switching, MFA, idle timeout, and audit logging.',
], rightX + 2, rightY, colWidth - 4)

rightY += 8
rightY = drawSectionTitle('How To Run', rightX, rightY, colWidth)
rightY = drawBullets([
  'Use Node.js 18+.',
  'Run `npm install`.',
  'Create a Supabase project and run the repo SQL schema. DEPLOY.md explicitly documents supabase/migrations/001_initial_schema.sql; additional migrations are present under supabase/migrations/.',
  'Copy .env.example to .env.local, then set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  'Run npm run dev and open http://localhost:5173.',
], rightX + 2, rightY, colWidth - 4)

rightY += 8
rightY = drawSectionTitle('Notes', rightX, rightY, colWidth)
rightY = drawBullets([
  'Hosting path found in repo: Vercel for the frontend (DEPLOY.md, vercel.json).',
  'End-to-end production integration setup beyond Supabase and Frankfurter: Not found in repo. The Integrations page exists, and Workday OAuth is listed in DEPLOY.md as a future step.',
], rightX + 2, rightY, colWidth - 4, { fontSize: 8.7, leading: 10.8 })

doc.save(outputPath)
console.log(outputPath)
console.log(JSON.stringify({ pageWidth, pageHeight, leftY, rightY }, null, 2))
