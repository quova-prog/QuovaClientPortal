// ============================================================
// HTML email templates for Quova notifications
// Inline CSS for maximum email client compatibility
// ============================================================

const NAVY = '#0B1526'
const TEAL = '#00C8A0'
const WHITE = '#FFFFFF'
const LIGHT_BG = '#F0F4F8'
const TEXT_PRIMARY = '#0F172A'
const TEXT_MUTED = '#64748B'
const RED = '#EF4444'
const AMBER = '#F59E0B'
const BORDER = '#E2E8F0'

function baseTemplate(content: string, unsubscribeUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${LIGHT_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${LIGHT_BG};padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:${WHITE};border-radius:8px;overflow:hidden;border:1px solid ${BORDER};">

<!-- Header -->
<tr><td style="background:${NAVY};padding:20px 32px;">
  <span style="color:${WHITE};font-size:18px;font-weight:700;letter-spacing:0.02em;">Quova</span>
  <span style="color:${TEAL};font-size:14px;font-weight:500;margin-left:8px;">FX Risk OS</span>
</td></tr>

<!-- Content -->
<tr><td style="padding:32px;">
  ${content}
</td></tr>

<!-- Footer -->
<tr><td style="padding:24px 32px;border-top:1px solid ${BORDER};background:${LIGHT_BG};">
  <p style="margin:0;font-size:12px;color:${TEXT_MUTED};line-height:1.5;">
    You received this email because you have notifications enabled in Quova.
    <a href="${unsubscribeUrl}" style="color:${TEAL};text-decoration:underline;">Unsubscribe</a>
  </p>
  <p style="margin:8px 0 0;font-size:11px;color:${TEXT_MUTED};">
    &copy; ${new Date().getFullYear()} Quova Inc. All rights reserved.
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

// ── Urgent Alert Email ───────────────────────────────────────────────

export interface UrgentAlertEmailData {
  alertTitle: string
  alertBody: string
  alertType: string
  severity: string
  href: string | null
  orgName: string
  appBaseUrl: string
  unsubscribeUrl: string
}

export function urgentAlertEmail(data: UrgentAlertEmailData): { subject: string; html: string } {
  const severityColor = data.severity === 'urgent' ? RED : AMBER
  const severityLabel = data.severity.charAt(0).toUpperCase() + data.severity.slice(1)
  const typeLabel = data.alertType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const ctaUrl = data.href ? `${data.appBaseUrl}${data.href}` : `${data.appBaseUrl}/inbox`

  const content = `
    <div style="margin-bottom:24px;">
      <span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${severityColor}15;color:${severityColor};font-size:12px;font-weight:700;border:1px solid ${severityColor}40;">
        ${severityLabel}
      </span>
      <span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${LIGHT_BG};color:${TEXT_MUTED};font-size:12px;font-weight:600;margin-left:8px;border:1px solid ${BORDER};">
        ${typeLabel}
      </span>
    </div>
    <h2 style="margin:0 0 12px;font-size:20px;color:${TEXT_PRIMARY};font-weight:600;">${escapeHtml(data.alertTitle)}</h2>
    <p style="margin:0 0 24px;font-size:14px;color:${TEXT_MUTED};line-height:1.6;">${escapeHtml(data.alertBody)}</p>
    <a href="${ctaUrl}" style="display:inline-block;padding:10px 24px;background:${TEAL};color:${WHITE};border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
      View in Quova
    </a>
  `

  return {
    subject: `[Quova Alert] ${data.alertTitle}`,
    html: baseTemplate(content, data.unsubscribeUrl),
  }
}

// ── Daily Digest Email ───────────────────────────────────────────────

export interface DigestEmailData {
  orgName: string
  date: string
  totalExposureUsd: string
  coveragePct: string
  activeHedges: number
  unhedgedUsd: string
  urgentCount: number
  warningCount: number
  infoCount: number
  topAlerts: { title: string; severity: string; type: string }[]
  appBaseUrl: string
  unsubscribeUrl: string
}

export function dailyDigestEmail(data: DigestEmailData): { subject: string; html: string } {
  const kpiCell = (label: string, value: string, color = TEXT_PRIMARY) => `
    <td style="padding:12px;text-align:center;border:1px solid ${BORDER};border-radius:6px;">
      <div style="font-size:20px;font-weight:700;color:${color};margin-bottom:4px;">${value}</div>
      <div style="font-size:11px;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.05em;">${label}</div>
    </td>
  `

  const alertRows = data.topAlerts.map(a => {
    const sColor = a.severity === 'urgent' ? RED : a.severity === 'warning' ? AMBER : TEAL
    return `<tr>
      <td style="padding:6px 8px;font-size:13px;"><span style="color:${sColor};font-weight:600;">${a.severity}</span></td>
      <td style="padding:6px 8px;font-size:13px;color:${TEXT_MUTED};">${a.type.replace(/_/g, ' ')}</td>
      <td style="padding:6px 8px;font-size:13px;color:${TEXT_PRIMARY};">${escapeHtml(a.title)}</td>
    </tr>`
  }).join('')

  const content = `
    <h2 style="margin:0 0 4px;font-size:18px;color:${TEXT_PRIMARY};font-weight:600;">Daily Digest — ${escapeHtml(data.orgName)}</h2>
    <p style="margin:0 0 24px;font-size:13px;color:${TEXT_MUTED};">${data.date}</p>

    <!-- KPI tiles -->
    <table width="100%" cellpadding="0" cellspacing="8" style="margin-bottom:24px;">
      <tr>
        ${kpiCell('Total Exposure', data.totalExposureUsd)}
        ${kpiCell('Coverage', data.coveragePct, TEAL)}
      </tr>
      <tr>
        ${kpiCell('Active Hedges', String(data.activeHedges))}
        ${kpiCell('Unhedged', data.unhedgedUsd, parseFloat(data.unhedgedUsd.replace(/[^0-9.]/g, '')) > 0 ? RED : TEXT_PRIMARY)}
      </tr>
    </table>

    <!-- Alert summary -->
    <div style="margin-bottom:24px;">
      <h3 style="margin:0 0 8px;font-size:14px;color:${TEXT_PRIMARY};font-weight:600;">Alert Summary</h3>
      <div style="display:flex;gap:12px;margin-bottom:12px;">
        <span style="font-size:13px;"><span style="color:${RED};font-weight:700;">${data.urgentCount}</span> urgent</span>
        <span style="font-size:13px;margin-left:12px;"><span style="color:${AMBER};font-weight:700;">${data.warningCount}</span> warning</span>
        <span style="font-size:13px;margin-left:12px;"><span style="color:${TEAL};font-weight:700;">${data.infoCount}</span> info</span>
      </div>
      ${data.topAlerts.length > 0 ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:6px;overflow:hidden;">
          <thead><tr style="background:${LIGHT_BG};">
            <th style="padding:8px;text-align:left;font-size:11px;color:${TEXT_MUTED};font-weight:600;text-transform:uppercase;">Severity</th>
            <th style="padding:8px;text-align:left;font-size:11px;color:${TEXT_MUTED};font-weight:600;text-transform:uppercase;">Type</th>
            <th style="padding:8px;text-align:left;font-size:11px;color:${TEXT_MUTED};font-weight:600;text-transform:uppercase;">Alert</th>
          </tr></thead>
          <tbody>${alertRows}</tbody>
        </table>
      ` : '<p style="font-size:13px;color:' + TEXT_MUTED + ';">No alerts in the past 24 hours.</p>'}
    </div>

    <a href="${data.appBaseUrl}/dashboard" style="display:inline-block;padding:10px 24px;background:${TEAL};color:${WHITE};border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
      View Full Dashboard
    </a>
  `

  return {
    subject: `Quova Daily Digest — ${data.orgName} — ${data.date}`,
    html: baseTemplate(content, data.unsubscribeUrl),
  }
}

// ── Unsubscribe confirmation page ────────────────────────────────────

export function unsubscribeConfirmationHtml(preferenceLabel: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Unsubscribed — Quova</title></head>
<body style="margin:0;padding:40px;background:${LIGHT_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;">
  <div style="max-width:480px;margin:0 auto;background:${WHITE};border-radius:12px;padding:48px 32px;border:1px solid ${BORDER};">
    <div style="font-size:24px;font-weight:700;color:${NAVY};margin-bottom:8px;">Quova</div>
    <h1 style="font-size:20px;color:${TEXT_PRIMARY};margin:24px 0 12px;">Unsubscribed</h1>
    <p style="font-size:14px;color:${TEXT_MUTED};line-height:1.6;">
      You have been unsubscribed from <strong>${escapeHtml(preferenceLabel)}</strong> emails.
      You can re-enable notifications anytime in your Quova settings.
    </p>
  </div>
</body>
</html>`
}

// ── Helpers ───────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
