const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, LevelFormat, ExternalHyperlink,
} = require('docx')
const fs = require('fs')

const today = new Date()
const reviewDate = new Date(today)
reviewDate.setFullYear(reviewDate.getFullYear() + 1)

function fmt(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// ── Colours ───────────────────────────────────────────────────
const TEAL     = '007D6F'
const TEAL_LT  = 'E6F4F2'
const GRAY_LT  = 'F5F7FA'
const GRAY_MID = 'E2E8F0'
const GRAY_TXT = '64748B'
const WHITE    = 'FFFFFF'
const BLACK    = '0F172A'
const RED_LT   = 'FEF2F2'
const RED_MID  = 'FCA5A5'

const border = (color = 'CCCCCC', size = 4) => ({
  top: { style: BorderStyle.SINGLE, size, color },
  bottom: { style: BorderStyle.SINGLE, size, color },
  left: { style: BorderStyle.SINGLE, size, color },
  right: { style: BorderStyle.SINGLE, size, color },
})
const noBorder = () => ({
  top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
})

// ── Helpers ───────────────────────────────────────────────────
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: TEAL, space: 8 } },
    children: [new TextRun({ text, bold: true, size: 32, color: TEAL, font: 'Arial' })],
  })
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, bold: true, size: 26, color: BLACK, font: 'Arial' })],
  })
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 60, after: 100 },
    children: [new TextRun({ text, size: 22, font: 'Arial', color: BLACK, ...opts })],
  })
}

function bullet(text, bold_prefix = '') {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { before: 40, after: 40 },
    children: [
      bold_prefix ? new TextRun({ text: bold_prefix, bold: true, size: 22, font: 'Arial', color: BLACK }) : null,
      new TextRun({ text, size: 22, font: 'Arial', color: BLACK }),
    ].filter(Boolean),
  })
}

function gap(pts = 120) {
  return new Paragraph({ spacing: { before: 0, after: pts }, children: [] })
}

function pageBreak() {
  return new Paragraph({ pageBreakBefore: true, children: [] })
}

function infoBox(label, text, bgColor = TEAL_LT, borderColor = TEAL) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: {
              top:    { style: BorderStyle.SINGLE, size: 12, color: borderColor },
              bottom: { style: BorderStyle.SINGLE, size: 4,  color: borderColor },
              left:   { style: BorderStyle.SINGLE, size: 12, color: borderColor },
              right:  { style: BorderStyle.SINGLE, size: 4,  color: borderColor },
            },
            shading: { fill: bgColor, type: ShadingType.CLEAR },
            margins: { top: 140, bottom: 140, left: 200, right: 200 },
            width: { size: 9360, type: WidthType.DXA },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 60 },
                children: [new TextRun({ text: label, bold: true, size: 20, font: 'Arial', color: borderColor })],
              }),
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text, size: 20, font: 'Arial', color: BLACK })],
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

function metaTable(rows) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2600, 6760],
    rows: rows.map(([label, value], i) =>
      new TableRow({
        children: [
          new TableCell({
            borders: border(GRAY_MID, 4),
            shading: { fill: i % 2 === 0 ? GRAY_LT : WHITE, type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 160, right: 160 },
            width: { size: 2600, type: WidthType.DXA },
            children: [new Paragraph({
              children: [new TextRun({ text: label, bold: true, size: 20, font: 'Arial', color: GRAY_TXT })],
            })],
          }),
          new TableCell({
            borders: border(GRAY_MID, 4),
            shading: { fill: i % 2 === 0 ? GRAY_LT : WHITE, type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 160, right: 160 },
            width: { size: 6760, type: WidthType.DXA },
            children: [new Paragraph({
              children: [new TextRun({ text: value, size: 20, font: 'Arial', color: BLACK })],
            })],
          }),
        ],
      })
    ),
  })
}

function roleTable(rows) {
  const COL = [2800, 3400, 3160]
  const headerRow = new TableRow({
    tableHeader: true,
    children: ['Role', 'Permissions', 'Typical Users'].map((h, i) =>
      new TableCell({
        borders: border(TEAL, 8),
        shading: { fill: TEAL, type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        width: { size: COL[i], type: WidthType.DXA },
        children: [new Paragraph({
          children: [new TextRun({ text: h, bold: true, size: 20, font: 'Arial', color: WHITE })],
        })],
      })
    ),
  })

  const dataRows = rows.map(([role, perms, users], i) =>
    new TableRow({
      children: [role, perms, users].map((val, j) =>
        new TableCell({
          borders: border(GRAY_MID, 4),
          shading: { fill: i % 2 === 0 ? WHITE : GRAY_LT, type: ShadingType.CLEAR },
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          width: { size: COL[j], type: WidthType.DXA },
          children: [new Paragraph({
            children: [new TextRun({ text: val, size: 20, font: 'Arial', color: BLACK, bold: j === 0 })],
          })],
        })
      ),
    })
  )

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: COL,
    rows: [headerRow, ...dataRows],
  })
}

// ── Cover page ────────────────────────────────────────────────
const coverSection = {
  properties: {
    page: {
      size: { width: 12240, height: 15840 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  },
  children: [
    // Teal header band
    new Table({
      width: { size: 12240, type: WidthType.DXA },
      columnWidths: [12240],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: noBorder(),
              shading: { fill: TEAL, type: ShadingType.CLEAR },
              margins: { top: 1200, bottom: 800, left: 1440, right: 1440 },
              width: { size: 12240, type: WidthType.DXA },
              children: [
                new Paragraph({
                  spacing: { before: 0, after: 120 },
                  children: [new TextRun({ text: 'ORBIT', size: 28, font: 'Arial', color: 'CCFAF4', bold: true, allCaps: true, characterSpacing: 200 })],
                }),
                new Paragraph({
                  spacing: { before: 0, after: 0 },
                  children: [new TextRun({ text: 'Access Control Policy', size: 64, font: 'Arial', color: WHITE, bold: true })],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    // White body
    new Table({
      width: { size: 12240, type: WidthType.DXA },
      columnWidths: [12240],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: noBorder(),
              shading: { fill: WHITE, type: ShadingType.CLEAR },
              margins: { top: 640, bottom: 640, left: 1440, right: 1440 },
              width: { size: 12240, type: WidthType.DXA },
              children: [
                new Paragraph({
                  spacing: { before: 0, after: 80 },
                  children: [new TextRun({ text: 'Information Security Policy', size: 24, font: 'Arial', color: GRAY_TXT, italics: true })],
                }),
                new Paragraph({
                  spacing: { before: 0, after: 600 },
                  children: [new TextRun({ text: 'Governing user access, roles, and authentication across all Orbit systems and data.', size: 22, font: 'Arial', color: GRAY_TXT })],
                }),
                metaTable([
                  ['Policy Owner',      'Head of Engineering / CISO'],
                  ['Classification',    'Internal — Confidential'],
                  ['Version',           '1.0'],
                  ['Effective Date',    fmt(today)],
                  ['Next Review Date',  fmt(reviewDate)],
                  ['Approved By',       'Executive Team'],
                  ['SOC2 Controls',     'CC6.1, CC6.2, CC6.3, CC6.6, CC7.2'],
                ]),
              ],
            }),
          ],
        }),
      ],
    }),
    // Footer band
    new Table({
      width: { size: 12240, type: WidthType.DXA },
      columnWidths: [12240],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: noBorder(),
              shading: { fill: GRAY_LT, type: ShadingType.CLEAR },
              margins: { top: 240, bottom: 240, left: 1440, right: 1440 },
              width: { size: 12240, type: WidthType.DXA },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: `CONFIDENTIAL  ·  Orbit  ·  Version 1.0  ·  ${fmt(today)}`, size: 16, font: 'Arial', color: GRAY_TXT })],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ],
}

// ── Body pages ────────────────────────────────────────────────
const bodySection = {
  properties: {
    page: {
      size: { width: 12240, height: 15840 },
      margin: { top: 1080, right: 1260, bottom: 1080, left: 1260 },
    },
  },
  headers: {
    default: new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 8 } },
          spacing: { before: 0, after: 160 },
          children: [
            new TextRun({ text: 'Orbit  ·  Access Control Policy  ·  ', size: 18, font: 'Arial', color: GRAY_TXT }),
            new TextRun({ text: 'CONFIDENTIAL', size: 18, font: 'Arial', color: TEAL, bold: true }),
          ],
        }),
      ],
    }),
  },
  footers: {
    default: new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: GRAY_MID, space: 8 } },
          spacing: { before: 120, after: 0 },
          children: [
            new TextRun({ text: 'Page ', size: 18, font: 'Arial', color: GRAY_TXT }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, font: 'Arial', color: GRAY_TXT }),
            new TextRun({ text: '  ·  Internal — Confidential', size: 18, font: 'Arial', color: GRAY_TXT }),
          ],
        }),
      ],
    }),
  },
  children: [
    // ── 1. Purpose ────────────────────────────────────────────
    h1('1. Purpose'),
    body(
      'This Access Control Policy establishes the requirements for granting, managing, reviewing, ' +
      'and revoking access to Orbit systems, applications, and data. It is designed to ensure that ' +
      'access to sensitive information is limited to authorised individuals and that all access is ' +
      'granted on a need-to-know, least-privilege basis.'
    ),
    gap(80),
    infoBox(
      'SOC2 Alignment',
      'This policy directly supports Trust Service Criteria CC6.1 (Logical and Physical Access Controls), ' +
      'CC6.2 (Access Provisioning), CC6.3 (Role-Based Access), CC6.6 (Authentication), and CC7.2 (System Monitoring).'
    ),
    gap(160),

    // ── 2. Scope ─────────────────────────────────────────────
    h1('2. Scope'),
    body(
      'This policy applies to all individuals who have access to Orbit systems, including but not limited to:'
    ),
    bullet('Full-time and part-time employees'),
    bullet('Contractors, consultants, and temporary staff'),
    bullet('Third-party vendors and service providers with system access'),
    bullet('Executive and board-level personnel'),
    gap(120),
    body('Systems in scope include:'),
    bullet('Orbit web application and all sub-systems'),
    bullet('Supabase database and authentication platform'),
    bullet('Source code repositories (e.g., GitHub)'),
    bullet('Cloud hosting and infrastructure'),
    bullet('Internal communication and productivity tools with access to customer data'),
    gap(160),

    // ── 3. Roles & Responsibilities ───────────────────────────
    h1('3. Roles and Responsibilities'),

    h2('3.1 Policy Owner (Head of Engineering / CISO)'),
    bullet('Maintains and updates this policy on an annual basis or upon material change'),
    bullet('Approves exceptions to this policy'),
    bullet('Oversees the access review process'),
    bullet('Receives and investigates access-related security incidents'),
    gap(80),

    h2('3.2 Managers and Team Leads'),
    bullet('Submit access requests for new team members'),
    bullet('Promptly notify People Operations and Engineering when a team member departs or changes role'),
    bullet('Participate in quarterly access reviews for their direct reports'),
    gap(80),

    h2('3.3 Engineering / IT'),
    bullet('Provisions and revokes access in response to authorised requests'),
    bullet('Maintains role definitions and ensures RLS policies reflect current requirements'),
    bullet('Reviews audit logs for anomalous access patterns'),
    gap(80),

    h2('3.4 All Users'),
    bullet('Use only the access privileges granted to them'),
    bullet('Never share credentials or authentication tokens'),
    bullet('Report suspected unauthorised access immediately to security@orbit.com'),
    bullet('Complete annual security awareness training'),
    gap(160),

    // ── 4. Access Roles ───────────────────────────────────────
    h1('4. Role-Based Access Control (RBAC)'),
    body(
      'Orbit uses a three-tier role model enforced at the database level via Row-Level Security (RLS) ' +
      'policies in Supabase. Every user is assigned exactly one role within their organisation.'
    ),
    gap(120),
    roleTable([
      [
        'Admin',
        'Full read and write access to all organisation data. Can manage users, configure hedge policies, and view the Audit Log.',
        'CTO, Head of Treasury, Senior Finance Manager',
      ],
      [
        'Editor',
        'Read and write access to all financial data (hedges, cash flows, uploads, etc.). Cannot manage users or access Audit Log.',
        'Treasury Analyst, FX Manager, Finance Analyst',
      ],
      [
        'Viewer',
        'Read-only access to all data. All INSERT, UPDATE, and DELETE operations are blocked at the database level. Cannot export data.',
        'Auditor, CFO (read-only dashboards), External Consultant',
      ],
    ]),
    gap(120),
    infoBox(
      'Technical Enforcement',
      'Role restrictions are enforced by PostgreSQL Row-Level Security policies on all sensitive tables ' +
      '(hedge_positions, fx_exposures, cash_flows, purchase_orders, budget_rates, revenue_forecasts, ' +
      'loan_schedules, payroll, capex, intercompany_transfers, supplier_contracts, customer_contracts). ' +
      'Viewer-role users are blocked from INSERT, UPDATE, and DELETE at the database layer regardless of ' +
      'frontend behaviour.',
      TEAL_LT, TEAL
    ),
    gap(160),

    // ── 5. Access Provisioning ────────────────────────────────
    pageBreak(),
    h1('5. Access Provisioning'),

    h2('5.1 New User Onboarding'),
    body('Access is provisioned following this process:'),
    bullet('', '1.  Request:  '),
    ...['The hiring manager submits an access request to Engineering specifying the required role.',
        'Requests must be submitted before the employee\'s start date.',
    ].map(t => body('         ' + t)),
    bullet('', '2.  Approval:  '),
    ...['Engineering or the Policy Owner approves the role assignment.',
        'Admin role requests require explicit executive approval.',
    ].map(t => body('         ' + t)),
    bullet('', '3.  Provisioning:  '),
    body('         Access is created within one business day of approval.'),
    bullet('', '4.  Notification:  '),
    body('         The user receives onboarding instructions including MFA setup requirements.'),
    gap(80),

    h2('5.2 Role Changes'),
    body(
      'When a user changes role (e.g., promotion, team transfer), the manager must submit an access ' +
      'change request within five business days. The previous role is revoked before or simultaneously ' +
      'with the new role being granted. Role changes are logged in the Audit Log.'
    ),
    gap(80),

    h2('5.3 Principle of Least Privilege'),
    body(
      'All access is granted at the minimum level required for the user to perform their job function. ' +
      'Temporary elevated access (e.g., a Viewer needing Editor access for a project) must be time-bounded, ' +
      'approved in writing, and revoked immediately upon completion.'
    ),
    gap(160),

    // ── 6. Authentication ─────────────────────────────────────
    h1('6. Authentication Requirements'),

    h2('6.1 Passwords'),
    bullet('Minimum length: 12 characters'),
    bullet('Must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    bullet('Must not be reused within the last 10 passwords'),
    bullet('Must be changed if there is any suspicion of compromise'),
    bullet('Sharing of passwords is strictly prohibited'),
    gap(80),

    h2('6.2 Multi-Factor Authentication (MFA)'),
    body(
      'MFA using a TOTP authenticator application (e.g., Google Authenticator, Authy) is available to ' +
      'all users and is required for all Admin-role users. Users can enable MFA from the Settings → ' +
      'Security page within the Orbit application.'
    ),
    gap(40),
    infoBox(
      'MFA Requirement Timeline',
      'MFA is required for Admin users immediately. MFA will be required for all Editor and Viewer users ' +
      'by the date of the first SOC2 Type II audit period.',
      RED_LT, 'DC2626'
    ),
    gap(80),

    h2('6.3 Session Management'),
    bullet('Sessions automatically expire after 30 minutes of inactivity'),
    bullet('A warning is displayed 5 minutes before session expiry'),
    bullet('Users are responsible for manually signing out on shared or public devices'),
    bullet('Concurrent sessions from the same user are permitted but all are invalidated on sign-out'),
    gap(160),

    // ── 7. Access Termination ─────────────────────────────────
    h1('7. Access Termination'),
    body(
      'Access must be revoked promptly when a user leaves the organisation or no longer requires access. ' +
      'The following SLAs apply:'
    ),
    gap(80),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [4200, 5160],
      rows: [
        new TableRow({
          tableHeader: true,
          children: ['Termination Type', 'Revocation SLA'].map((h, i) =>
            new TableCell({
              borders: border(TEAL, 8),
              shading: { fill: TEAL, type: ShadingType.CLEAR },
              margins: { top: 100, bottom: 100, left: 160, right: 160 },
              width: { size: i === 0 ? 4200 : 5160, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, font: 'Arial', color: WHITE })] })],
            })
          ),
        }),
        ...([
          ['Voluntary resignation (standard notice)', 'On last day of employment'],
          ['Involuntary termination or immediate exit', 'Within 2 hours of notification'],
          ['Contractor / vendor engagement ends', 'On contract end date, or within 1 business day'],
          ['Role change (access reduction)', 'Within 1 business day of role change approval'],
          ['Suspected security incident', 'Immediately upon notification'],
        ]).map(([type, sla], i) =>
          new TableRow({
            children: [type, sla].map((val, j) =>
              new TableCell({
                borders: border(GRAY_MID, 4),
                shading: { fill: i % 2 === 0 ? WHITE : GRAY_LT, type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 160, right: 160 },
                width: { size: j === 0 ? 4200 : 5160, type: WidthType.DXA },
                children: [new Paragraph({ children: [new TextRun({ text: val, size: 20, font: 'Arial', color: BLACK })] })],
              })
            ),
          })
        ),
      ],
    }),
    gap(120),
    body(
      'People Operations is responsible for triggering the access revocation process. ' +
      'Engineering confirms revocation and records the action in the Audit Log within one business day.'
    ),
    gap(160),

    // ── 8. Access Reviews ─────────────────────────────────────
    pageBreak(),
    h1('8. Periodic Access Reviews'),
    body(
      'Access reviews are conducted to ensure that user privileges remain appropriate and that ' +
      'no unnecessary access persists. The following review cadence applies:'
    ),
    gap(80),
    bullet('', 'Quarterly:  '),
    body('         Managers review the role assignments of all direct reports and confirm continued need.'),
    bullet('', 'Semi-Annually:  '),
    body('         Engineering reviews all Admin-role users and removes any that are no longer warranted.'),
    bullet('', 'Annually:  '),
    body('         A full access review of all users and third-party integrations is conducted as part of the SOC2 audit preparation.'),
    gap(80),
    body(
      'Access review outcomes are documented. Any access that cannot be confirmed as necessary is revoked ' +
      'within five business days. Results are reported to the Policy Owner.'
    ),
    gap(160),

    // ── 9. Audit Logging ──────────────────────────────────────
    h1('9. Audit Logging and Monitoring'),
    body(
      'Orbit maintains an append-only Audit Log that records all significant user actions. ' +
      'Log entries cannot be modified or deleted. The following events are captured:'
    ),
    gap(80),
    bullet('Authentication events: login, logout, failed login attempts'),
    bullet('Data mutations: create, update, and delete operations on all financial records'),
    bullet('Bulk data imports via CSV upload'),
    bullet('Data exports and report downloads'),
    bullet('Access configuration changes'),
    gap(80),
    body(
      'Each log entry records the user identity, email address, action type, affected resource, ' +
      'timestamp, and a human-readable summary. Audit logs are retained for a minimum of 12 months.'
    ),
    gap(80),
    body(
      'The Audit Log is accessible to Admin-role users via Settings → Audit Log within the application. ' +
      'Engineering reviews logs for anomalous activity on a weekly basis and following any reported incident.'
    ),
    gap(160),

    // ── 10. Third-Party Access ────────────────────────────────
    h1('10. Third-Party and Vendor Access'),
    body(
      'Third parties (contractors, vendors, auditors) who require access to Orbit systems must:'
    ),
    bullet('Be approved by the Policy Owner before access is provisioned'),
    bullet('Sign a confidentiality and data handling agreement prior to access'),
    bullet('Be granted the minimum role necessary (Viewer where possible)'),
    bullet('Have access automatically scoped to a defined time period, after which it expires'),
    bullet('Provide evidence of their own information security policies upon request'),
    gap(80),
    body(
      'Third-party access is reviewed at least quarterly and revoked immediately upon engagement end.'
    ),
    gap(160),

    // ── 11. Violations ────────────────────────────────────────
    h1('11. Policy Violations'),
    body(
      'Violations of this policy may result in disciplinary action up to and including termination ' +
      'of employment or contract, and may result in civil or criminal liability. Suspected violations ' +
      'should be reported to security@orbit.com. Reports can be made anonymously.'
    ),
    gap(80),
    infoBox(
      'How to Report a Suspected Violation',
      'Email: security@orbit.com\nIn-app: Settings → Audit Log (Admin users can flag incidents)\n' +
      'Escalation: Contact the Head of Engineering or CEO directly for urgent matters.',
      RED_LT, 'DC2626'
    ),
    gap(160),

    // ── 12. Exceptions ────────────────────────────────────────
    h1('12. Exceptions'),
    body(
      'Exceptions to this policy must be requested in writing to the Policy Owner, documented with ' +
      'a business justification, approved by the Policy Owner, and reviewed at least quarterly. ' +
      'Exceptions are time-bounded and automatically expire after 90 days unless renewed.'
    ),
    gap(160),

    // ── 13. Review ────────────────────────────────────────────
    h1('13. Policy Review and Version History'),
    body(
      'This policy is reviewed annually or whenever a material change occurs in Orbit\'s systems, ' +
      'regulatory requirements, or organisational structure. Updates are approved by the Executive Team.'
    ),
    gap(80),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [1400, 1600, 2800, 3560],
      rows: [
        new TableRow({
          tableHeader: true,
          children: ['Version', 'Date', 'Author', 'Changes'].map((h, i) =>
            new TableCell({
              borders: border(TEAL, 8),
              shading: { fill: TEAL, type: ShadingType.CLEAR },
              margins: { top: 80, bottom: 80, left: 160, right: 160 },
              width: { size: [1400, 1600, 2800, 3560][i], type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, font: 'Arial', color: WHITE })] })],
            })
          ),
        }),
        new TableRow({
          children: ['1.0', fmt(today), 'Head of Engineering', 'Initial version'].map((val, i) =>
            new TableCell({
              borders: border(GRAY_MID, 4),
              shading: { fill: GRAY_LT, type: ShadingType.CLEAR },
              margins: { top: 80, bottom: 80, left: 160, right: 160 },
              width: { size: [1400, 1600, 2800, 3560][i], type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun({ text: val, size: 20, font: 'Arial', color: BLACK })] })],
            })
          ),
        }),
      ],
    }),
    gap(160),

    // ── Approval ──────────────────────────────────────────────
    h1('Approval and Sign-Off'),
    body('By approving this policy, the signatories confirm they have reviewed and accepted its contents.'),
    gap(120),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [3120, 3120, 3120],
      rows: [
        new TableRow({
          children: ['Policy Owner', 'CEO / Executive Sponsor', 'Date Approved'].map((h, i) =>
            new TableCell({
              borders: border(GRAY_MID, 4),
              shading: { fill: GRAY_LT, type: ShadingType.CLEAR },
              margins: { top: 80, bottom: 80, left: 160, right: 160 },
              width: { size: 3120, type: WidthType.DXA },
              children: [
                new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, font: 'Arial', color: GRAY_TXT })] }),
              ],
            })
          ),
        }),
        new TableRow({
          children: ['', '', fmt(today)].map((val, i) =>
            new TableCell({
              borders: border(GRAY_MID, 4),
              shading: { fill: WHITE, type: ShadingType.CLEAR },
              margins: { top: 640, bottom: 640, left: 160, right: 160 },
              width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun({ text: val, size: 20, font: 'Arial', color: GRAY_TXT })] })],
            })
          ),
        }),
      ],
    }),
    gap(80),
    body('_______________________________    _______________________________    _______________', { color: GRAY_MID }),
    body('Signature                          Signature                          Date', { color: GRAY_TXT, size: 18 }),
  ],
}

// ── Build & write ─────────────────────────────────────────────
const doc = new Document({
  title: 'Orbit Access Control Policy',
  description: 'SOC2 Access Control Policy v1.0',
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '\u2022',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 480, hanging: 240 } } },
        }],
      },
    ],
  },
  sections: [coverSection, bodySection],
})

Packer.toBuffer(doc).then(buffer => {
  const outPath = '/Users/stevenlabella/Downloads/Orbit_Access_Control_Policy_v1.0.docx'
  fs.writeFileSync(outPath, buffer)
  console.log('Written:', outPath)
}).catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
