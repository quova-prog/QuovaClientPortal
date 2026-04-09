# Quova — Claude Code Context

> **Last updated:** 2026-04-09 (session 9 — rebrand to Quova + Vercel deployment)
> **Product:** Quova — The Financial Risk OS
> **Founder / CEO:** Steve LaBella
> **Target customer:** $1B–$40B revenue companies (Loblaw, Atlassian, Celonis, Sagard)
> **Positioning:** "The other 95% of the FX workflow" — everything except trade execution
> **Domain:** www.quovaOS.com | Client Portal: www.quovaOS.com/ClientPortal

---

## Project Overview

Quova is an enterprise treasury SaaS platform that manages the entire FX risk workflow:
exposure capture → coverage analysis → hedge advisor → trade entry → analytics → board reporting.

It is a **React SPA** backed by **Supabase** (PostgreSQL + Auth + RLS). All data is strictly
multi-tenant, scoped to `org_id`. The MVP is fully functional end-to-end; active development
is focused on depth (ERP integrations, audit-grade compliance features, board-level reporting).

The app has **no backend server** — it is a Vite + React SPA that talks directly to Supabase
from the browser. AI calls (Anthropic API) are made directly from the browser via
`anthropic-dangerous-direct-browser-access`. This is MVP behaviour; a BFF proxy is planned
before GA.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | React 18 + TypeScript 5.3 | Strict mode, no `any` |
| Build | Vite 5 | `@vitejs/plugin-react` |
| Routing | React Router 6 | |
| Database / Auth | Supabase (`@supabase/supabase-js` 2.39) | PostgreSQL, RLS, Auth |
| Styling | Plain CSS (`src/index.css`) + inline styles | Design tokens via CSS variables |
| Charts | Recharts 2.10 | Bar, line charts |
| CSV Parsing | PapaParse 5 | All CSV uploads + onboarding flat file |
| Excel Export | xlsx 0.18 | XLSX multi-sheet exports |
| PDF Export | jsPDF 2.5 + jsPDF-autotable 3.8 | Board report PDF |
| PPTX Export | pptxgenjs 4.0 | Board report PowerPoint |
| AI / LLM | `@anthropic-ai/sdk` + direct API fetch | claude-haiku-4-5 model |
| FX Rates | Frankfurter API (free, ECB-sourced) | `src/lib/frankfurter.ts` — **domain: `api.frankfurter.dev/v1`** (migrated from `api.frankfurter.app`) |
| Icons | Lucide React 0.303 | |
| Date utils | date-fns 3 | |
| Monitoring | Internal `src/lib/monitoring.ts` | |

---

## Architecture

### File Structure

```
src/
├── App.tsx                     # Routes — public + protected with AppLayout shell + SmartRedirect
├── main.tsx
├── types/index.ts              # Shared TypeScript types (HedgePosition, FxExposure, OnboardingSession, etc.)
├── index.css                   # Global styles + design token CSS variables
│
├── components/
│   ├── layout/AppLayout.tsx    # Sidebar nav, entity picker, rates ticker, onboarding steps
│   ├── ui/                     # ErrorBoundary, IdleTimeout, QuovaMark, UpgradeModal
│   ├── advisor/ScenarioPanel.tsx
│   ├── analytics/
│   │   ├── BoardReportPanel.tsx
│   │   ├── HedgeAccountingExport.tsx
│   │   └── HedgeEffectivenessPanel.tsx
│   ├── integrations/IntegrationSetupModal.tsx
│   ├── upload/UploadWizard.tsx
│   └── onboarding/            # ← NEW (session 4)
│       ├── OnboardingProgressBar.tsx   # 5-step stepper, clickable completed steps
│       ├── ERPCard.tsx                 # Selectable ERP connector card
│       ├── FlatFileUploader.tsx        # Drag-and-drop CSV upload with PapaParse + PII strip
│       ├── DiscoveryEventRow.tsx       # Live feed row for AI discovery stage events
│       └── MappingRow.tsx             # Interactive field mapping row (confirm/reject/edit/undo)
│
├── context/
│   └── EntityContext.tsx       # Multi-entity selector state (org-wide or per-entity view)
│
├── hooks/
│   ├── useAuth.tsx             # Auth context — user, signIn, signUp, signOut, MFA
│   ├── useData.ts              # Core hooks: useHedgePositions, useExposures, useDashboardMetrics, etc.
│   ├── useCombinedCoverage.ts  # Merges DB exposures + CSV-derived exposures into one coverage view
│   ├── useDerivedExposures.ts  # Coverage derived from CSV upload tables (PO, contracts, etc.)
│   ├── useLiveFxRates.ts       # Polls Frankfurter API; serves live rates to UI only (no DB writes)
│   ├── useAlerts.ts            # Persistent alerts (read/upsert/resolve)
│   ├── useAlertGenerator.ts    # Auto-fires alerts based on coverage + maturity data
│   ├── useAdvisorEngine.ts     # Risk metrics, strategy scoring, backtest data
│   ├── useErpConnections.ts    # ERP/TMS connection configs
│   ├── useOnboarding.ts        # ← NEW: reads/creates onboarding session, advances state machine
│   ├── useDiscoveryPipeline.ts # ← NEW: 6-stage async discovery with live event emission
│   ├── useMappings.ts          # ← NEW: field mapping CRUD (confirm/reject/edit/bulk-confirm)
│   └── [10 more domain hooks for each upload table]
│
├── lib/
│   ├── fx.ts                   # SINGLE SOURCE: FALLBACK_FX rates + toUsd() — import from here only
│   ├── supabase.ts             # Supabase client singleton
│   ├── advisorEngine.ts        # Pure TS: strategy scoring, VaR, backtest
│   ├── scenarioEngine.ts       # Pure TS: FX stress test scenarios
│   ├── hedgeEffectiveness.ts   # Pure TS: ASC 815 / IFRS 9 effectiveness calculations
│   ├── boardReportPdf.ts       # Pure TS: jsPDF 6-page A4 board report generator
│   ├── boardReportPptx.ts      # Pure TS: pptxgenjs 6-slide board deck generator
│   ├── claudeClient.ts         # Anthropic API call + fallback analysis
│   ├── frankfurter.ts          # ECB FX rates fetch — api.frankfurter.dev/v1
│   ├── discoveryService.ts     # ← NEW: AI field mapping (Anthropic + rule-based fallback)
│   ├── erpConnectorConfig.ts   # ← NEW: config-driven ERP connector catalog (10 connectors)
│   ├── piiStripper.ts          # ← NEW: strips emails/SSN/CC/phone from sample data before AI
│   ├── csvParser.ts            # Generic exposure CSV parser
│   └── [10 more *Parser.ts for each upload data type]
│
└── pages/
    ├── [existing pages]        # One file per route (see Routes section below)
    └── onboarding/             # ← NEW (session 4)
        ├── OnboardingRouter.tsx    # State machine controller — URL-based step, auto-redirect from /onboarding
        ├── OnboardingLayout.tsx    # Standalone shell (no sidebar): Quova top bar + progress bar + outlet
        ├── SetupWizard.tsx         # 4-section accordion: currency, exposure profile, entities, optional
        ├── ConnectERP.tsx          # ERP grid + flat file upload + credential forms + test connection
        ├── DiscoveryFeed.tsx       # Live event log + summary cards, auto-starts pipeline
        ├── ValidateMappings.tsx    # Mapping table + confirm/reject/edit + required field checklist
        └── GoLive.tsx              # Real CSV data import into fx_exposures + celebration
```

### Routes

| Path | Page | Notes |
|---|---|---|
| `/onboarding/*` | OnboardingRouter | **NEW** — 5-step onboarding flow (standalone shell, no sidebar) |
| `/onboarding/setup` | SetupWizard | Company profile: functional ccy, tx currencies, entities |
| `/onboarding/connect` | ConnectERP | ERP selector + flat file upload + credential collection |
| `/onboarding/discover` | DiscoveryFeed | AI schema discovery with live event feed |
| `/onboarding/validate` | ValidateMappings | Human review of AI-proposed field mappings |
| `/onboarding/live` | GoLive | Data import into fx_exposures + celebration |
| `/dashboard` | DashboardPage | KPI summary, coverage gauge, exposure donut |
| `/inbox` | InboxPage | Alert inbox with read/dismiss |
| `/upload` | UploadPage | CSV upload wizard (10+ data types) |
| `/exposure` | ExposurePage | FX exposure table + charts |
| `/strategy` | StrategyPage | Policy settings + strategy selection |
| `/advisor` | AdvisorPage | AI hedge advisor + scenario analysis |
| `/hedge` | HedgePage | Hedge position entry (multi-step form) |
| `/trade` | TradePage | Portfolio MTM + active positions table |
| `/counterparties` | CounterpartiesPage | Bank counterparty management |
| `/analytics` | AnalyticsPage | Tabbed: Hedge View, Custom Reports, Hedge Accounting, Effectiveness Testing, Board Package |
| `/bank-accounts` | BankAccountsPage | Bank account registry |
| `/integrations` | IntegrationsPage | ERP/TMS connector catalog + setup wizard |
| `/settings` | SettingsPage | Org settings, user management |
| `/audit-log` | AuditLogPage | Immutable audit trail |

Public routes: `/login`, `/signup`, `/forgot-password`, `/reset-password`

### Smart Redirect (App.tsx)
After login/signup, `SmartRedirect` (at the `/` route) checks `onboarding_sessions`:
- **No session or status ≠ 'live'** → redirects to `/onboarding`
- **Status = 'live'** → redirects to `/dashboard`

This ensures new signups always enter the onboarding flow before seeing the main app.

---

## Design System

All styling uses **CSS variables** defined in `src/index.css`. Never hardcode colors.

### Key Tokens

```css
--bg-app:       #f0f4f8     /* outermost app background (light mode) */
--bg-card:      #ffffff
--bg-surface:   #f8fafc     /* card/panel background */

--text-primary:   #0f172a
--text-secondary: #475569
--text-muted:     #94a3b8

--border:         #e2e8f0

--teal:   #00c8a0     /* primary brand action color */
--teal-dark: #007a60
--teal-dim: #00c8a015
--red:    #ef4444
--green:  #10b981
--amber:  #f59e0b
--blue:   #3b82f6

--font-mono: 'JetBrains Mono', monospace
--r-sm: 6px  --r-md: 8px  --r-lg: 12px  --r-xl: 16px
```

### CSS Classes

```
.card              — white-bordered surface panel
.btn .btn-primary .btn-ghost .btn-sm  — buttons
.input             — text input (correct background, border, padding)
.label             — form label
.badge .badge-green .badge-teal .badge-red .badge-amber .badge-gray .badge-blue .badge-purple — status chips
.tab .tab.active   — tab buttons
.section-label     — uppercase section header
.data-table        — styled table (thead navy, tbody rows)
.empty-state       — centered icon + message placeholder
.page-header       — top bar with title + actions
.page-content      — main scrollable area padding
.error-banner      — red error message bar (background + border + color)
.fade-in           — entry animation
.spinner           — CSS spin animation
```

### Responsive Design
Basic mobile breakpoint at `768px` in `index.css`:
- `.page-header` stacks vertically
- `.data-table` gets horizontal scroll
- `.tab-bar` scrolls horizontally
- Stat cards compact

---

## Database Schema (Key Tables)

All tables have `org_id UUID` FK and full Row Level Security. Multi-tenant isolation is
enforced at the DB level via RLS policies using `current_user_org_id()` helper function.

### Core Tables

| Table | Purpose |
|---|---|
| `organisations` | One row per Quova customer. `plan`: exposure/pro/enterprise. `monthly_fee`, `setup_fee` pricing columns |
| `tier_definitions` | Feature flag matrix per tier. Boolean columns for each feature, pricing, support level. Source of truth for feature gating |
| `profiles` | Extends `auth.users`. `role`: admin/editor/viewer. `email`, `phone` contact fields |
| `hedge_policies` | One active policy per org. `min_coverage_pct`, `max_coverage_pct`, `min_notional_threshold`, `min_tenor_days`, `base_currency` |
| `fx_exposures` | ERP-sourced FX exposures. `direction`: receivable/payable. `entity_id` FK for multi-entity |
| `hedge_positions` | Manually entered FX forwards/swaps/options. `spot_rate_at_trade` for MTM inception anchor |
| `fx_rates` | Historical and live spot rates. Keyed by `(currency_pair, rate_date)`. Source: Frankfurter API |
| `upload_batches` | Audit record of every CSV upload |
| `alerts` | Persistent alert store. Unique `(org_id, alert_key)`. `resolved_at` for auto-resolution |
| `entities` | Legal entities within an org. `functional_currency`, `jurisdiction`, `parent_entity_id` |
| `erp_connections` | ERP/TMS integration config. `credentials_set: boolean` flag. Non-sensitive config only |
| `audit_logs` | Append-only activity log |
| `org_payment_methods` | Billing metadata: credit card / ACH / invoice. Metadata only (no raw numbers) |

### Onboarding Tables (migration `20260404_onboarding_system.sql`)

| Table | Purpose |
|---|---|
| `onboarding_sessions` | State machine: one row per org. `status`: setup/connect/discover/validate/live/error |
| `onboarding_events` | State transition log (from_status → to_status, event_type, event_data) |
| `organization_profiles` | Company profile collected during SETUP step (functional_currency, tx_currencies, entities JSONB, industry, revenue_band, bank_relationships, reporting_cadence) |
| `schema_discoveries` | AI discovery results: raw_schema, ai_analysis, confidence_score, currencies_found |
| `field_mappings` | Proposed → confirmed field mappings: source_field → target_field, confidence, ai_reasoning |
| `mapping_templates` | Reusable templates per ERP type (flywheel — improves with each customer) |

RPC: `advance_onboarding_status(p_session_id, p_new_status, p_reason)` — SECURITY DEFINER, logs to `onboarding_events`. **Enforces forward-only state transitions** (setup→connect→discover→validate→live); backward steps allowed one at a time; `error` state can recover to any state; `live` is terminal.

### Upload / Exposure Data Tables (all from migration 005)

`budget_rates`, `revenue_forecasts`, `purchase_orders`, `cash_flows`, `loan_schedules`,
`payroll`, `intercompany_transfers`, `capex`, `supplier_contracts`, `customer_contracts`

### Views

| View | Purpose |
|---|---|
| `v_exposure_summary` | Net exposure by currency pair (receivable − payable) per org |
| `v_hedge_coverage` | Coverage % = net_hedged / net_exposure per pair. **Net hedged = \|sell − buy\|** (direction-aware, not raw sum) |

### Critical: `useCombinedCoverage`

The most important derived data hook. Merges two exposure sources:
1. **`fx_exposures` table** (real DB rows from ERP uploads)
2. **`useDerivedExposures`** (coverage derived from all upload tables: POs, contracts, payroll, etc.)

**Always use `useCombinedCoverage`** for anything coverage-related. Never use `useExposures` alone.

---

## Completed Features

### Customer Onboarding System (NEW — session 4)
Full 5-step self-serve onboarding flow: **SETUP → CONNECT → DISCOVER → VALIDATE → LIVE**

**State Machine:**
- `onboarding_sessions` table tracks current status per org
- `SmartRedirect` in App.tsx routes new signups to `/onboarding` instead of `/dashboard`
- Progress bar shows all 5 steps; completed steps are clickable for back-navigation
- Every page has a "← Back" button; no forced forward-only flow

**Step 1 — Company Setup (`SetupWizard.tsx`):**
- 4-section accordion: Company Basics (functional ccy, fiscal year, industry, revenue band), Currency Exposure Profile (transaction currencies with auto-generated pairs preview), Entity Structure (dynamic rows with name/country/functional ccy), Additional Details (banking partners, reporting cadence, FX pain points)
- Saves to `organization_profiles` table (upsert on revisit) and creates rows in `entities` table (deduplicated by name)
- Form re-populates from saved profile on back-navigation

**Step 2 — Connect Data (`ConnectERP.tsx`):**
- 10 ERP connectors in left panel (all available): Flat File, SAP S/4HANA Cloud, SAP S/4HANA On-Premise, SAP ECC 6.0, NetSuite, Oracle Cloud ERP, Oracle EBS, Microsoft Dynamics 365, Workday, Custom API
- Config-driven field definitions in `src/lib/erpConnectorConfig.ts`
- Flat file: drag-and-drop **CSV-only** upload with PapaParse, template download, PII stripping, preview (Excel not supported — PapaParse is CSV-only)
- ERP connectors: credential form with show/hide password toggles, security banner ("credentials encrypted, never stored in browser"), "Test Connection" button with simulated module access validation checklist
- SAP S/4HANA Cloud uses **Subdomain** (not Tenant ID) + **Region** + OAuth Client ID/Secret + Environment
- Connection saved to `erp_connections` table (non-sensitive config only, `credentials_set: true`)

**Step 3 — AI Discovery (`DiscoveryFeed.tsx`):**
- 6-stage pipeline: Schema Pull → Candidate ID → Sample Pull → AI Analysis → Validation → Preview
- Live event feed (left panel) with animated events appearing sequentially
- Summary cards (right panel): Fields Mapped, Avg Confidence, Currencies Found, Open Exposures
- Discovery pipeline (`useDiscoveryPipeline.ts`): creates `schema_discoveries` + `field_mappings` records
- `discoveryService.ts`: **rule-based mapping runs first** (fast, reliable for known column names); AI (Anthropic) only called for non-standard columns the rules can't match. Fallback regex patterns match common ERP column names including compound names (e.g. `notional_amount`, `settlement_date`)
- Mappings saved to both DB and **sessionStorage** (reliable fallback if RLS blocks DB writes)

**Step 4 — Validate Mappings (`ValidateMappings.tsx`):**
- Table of proposed mappings sorted by confidence (lowest first for review)
- Per-row actions: Confirm (✓), Edit (dropdown of Quova canonical fields), Reject (✗), Undo
- "Confirm all ≥90%" bulk action button
- Right panel: Mapping Progress (confirmed count + progress bar), Required Fields checklist (7 fields), Go Live button (enabled when ≥4 required fields confirmed)
- `useMappings.ts` reads from **sessionStorage first**, falls back to DB query. **Status changes (confirmed/rejected/modified) are persisted back to sessionStorage** so GoLive and back-navigation preserve review work
- Export CSV button for offline review

**Step 5 — Go Live (`GoLive.tsx`):**
- Reads raw CSV rows from sessionStorage (`orbit_onboarding_raw_rows`)
- **Reads confirmed field mappings** from sessionStorage and remaps raw column names → Quova canonical fields before import (supports non-template CSVs)
- Filters out same-currency rows (no FX risk)
- Creates `upload_batches` record + inserts rows as `fx_exposures` (proper currency_pair, direction, entity, settlement_date)
- 7-step progress animation with real DB writes
- Celebration page: exposures imported count, currencies tracked, entities onboarded
- Advances session to `status: 'live'` → future logins go to `/dashboard`

**Data Flow through sessionStorage:**
- `orbit_onboarding_schema` — FlatFileSchema (columns, rowCount, fileName)
- `orbit_onboarding_raw_rows` — full parsed CSV rows for GoLive import
- `orbit_discovery_mappings` — AI/rule mapping results
- `orbit_discovery_id` — DB discovery record UUID
- `orbit_discovery_gaps` — missing required fields
- `orbit_discovery_summary` — summary stats

**Test Data:**
- Sample CSV at `test-data/sample-exposure-upload.csv` — 46 realistic transactions across 5 entities (Global Inc, Global Europe, Global Canada, Global UK, Global Australia), 4 currencies (EUR, GBP, CAD, AUD), 7 transaction types, settlement dates in 2026

### Authentication & Multi-tenancy
- Email/password auth via Supabase
- MFA (TOTP) support
- Role-based access: admin / editor / viewer
- Multi-entity support with entity context switcher (consolidated vs per-entity view)
- Idle timeout session enforcement
- Password reset flow
- **Self-serve signup** → automatic redirect to onboarding flow
- `onboard_new_user()` RPC creates org + profile atomically

### Data Ingestion
- **CSV Upload Wizard** — 10 data type templates with drag-and-drop, Papa Parse, dedup, preview
- Upload deduplication by file hash (`src/lib/uploadDedup.ts`)
- Sync log in Integrations tab showing all upload history

### FX Rates
- `FALLBACK_FX` in `src/lib/fx.ts` as the single source of truth (25 currencies including EM)
- `toUsd(amount, currency, ratesMap)` handles direct/inverse pair lookups + fallback
- **Critical:** All pages import `toUsd` from `@/lib/fx` — never define local copies
- `useLiveFxRates` fetches from Frankfurter on mount + every 5 min
- **Frankfurter API domain:** `api.frankfurter.dev/v1` (migrated from old `api.frankfurter.app` which is down)

### Dashboard
- KPI tiles: Total Exposure, Active Hedges, Coverage %, Unhedged Amount
- Exposure donut chart by currency
- Coverage gauge
- Onboarding checklist (policy → upload → hedge → connect integration — now queries real `erp_connections` table)

### Exposure Management
- Exposure table with currency filter, direction filter, pagination

### Hedge Advisor (AI)
- Risk metrics engine: parametric VaR at 95%, coverage ratio, policy breach detection
- Claude AI executive summary (claude-haiku-4-5, falls back to deterministic)
- 3 strategy recommendations with scoring
- Scenario Analysis & Stress Testing (7 pre-built + custom scenarios)

### Hedge Management
- Multi-step trade entry form
- Full currency pair dropdown: G10 + EM + inverted pairs

### Trade / Portfolio Screen
- 5-tile MTM layout with explanatory banner

### Persistent Alerts
- Auto-fires on coverage fingerprint change
- Per-pair alerts for all pairs in `combinedCoverage`

### Analytics & Reporting
- Hedge View, Custom Reports, Hedge Accounting, Effectiveness Testing, Board Package
- PDF + PPTX board report export

### Integrations
- Connector catalog: 10 connectors (SAP, Oracle, NetSuite, Dynamics, Workday, flat file, custom API)
- Multi-step setup wizard with simulated connection test
- ERP credentials are **never stored in the database** — only `credentials_set: true` flag

### Tier System (Exposure / Pro / Enterprise)
Three tiers: `exposure`, `pro`, `enterprise`. No entity limits on any tier.

| Tier | Description |
|---|---|
| `exposure` | Default for new signups. Real-time FX exposure visibility, ERP integration, basic reports. |
| `pro` | Full platform: hedge tracking, coverage analysis, policy compliance, approval workflows, audit trail, board reporting, AI recommendations. |
| `enterprise` | Everything in Pro plus API access, SSO, custom integrations, dedicated support. |

**Feature gating:** `src/lib/tierService.ts` — static feature matrix, `canAccess(plan, feature)` utility.
**Sidebar:** Locked features show lock icon + tier badge, clicking triggers upgrade modal (`UpgradeModal.tsx`).
**Settings page:** Organisation tab shows tier badge and upgrade comparison card.
**tier_definitions table:** DB source of truth for feature flags, pricing, support SLA.
Plans are changed by support_admin via the Support Portal.

### Support Portal (orbit-support)
Separate Vite React SPA at `/Users/stevenlabella/Git/orbit-support/` (port 5177).
- Support/support_admin roles, cross-org read access, data corrections (plan, role, pricing, payment method)
- Data corrections: reason field is optional; all changes are audit-logged regardless
- Payment methods: Credit Card / ACH / Invoice with type-specific metadata fields
- Org pricing: monthly_fee + setup_fee per customer

---

## In Progress / Pending

### Known Gaps
1. **Notional conversion bug in AdvisorPage `handleExecute`** — passes USD amount as `notional_base`
2. **Strategy B & C not interactive** — only Strategy A drives recommendations
3. **ERP integrations are UI-only** — credential forms work but no actual API calls to SAP/Oracle/NetSuite. Backend Edge Functions needed for real connectivity. Connection test is simulated (90% random pass rate, clearly labelled in code).
4. **Onboarding GoLive** — imports into `fx_exposures` but doesn't create `hedge_policies` from the onboarding profile
5. **`as any` casts** — 15+ instances in data hooks hiding type errors. Requires Supabase DB type generation (`supabase gen types`) to fix properly.
6. **`mapping_templates` table has no write policies** — flywheel feature (reusable ERP mapping templates) is non-functional at the DB level
7. **Scenario engine hedged-exposure offset** — `scenarioEngine.ts` sets `hedgedExposureDelta = -hedgeInstrumentDelta` (perfect offset), so net impact = unhedged residual only. Acceptable as a conservative stress-test simplification for sub-1-year vanilla forwards but doesn't model basis mismatch.
8. **Advisor VaR is undiversified** — `advisorEngine.ts` sums standalone per-pair VaRs with no correlation matrix. Conservative (correlation=1 assumption) but not a true portfolio VaR. Label says "P&L at Risk (95%)" which is accurate; adding "(undiversified)" would improve transparency.

---

## Known Issues / Technical Debt

### Security
- Anthropic API key exposed in browser bundle (MVP-only; BFF proxy planned)
- No server-side validation of financial data
- ERP credentials must never flow through the browser

### Data Accuracy
- Currency pair string matching (`EUR/USD` vs `EURUSD`) — normalization needed
- `spot_rate_at_trade` nullable on `hedge_positions` — now critical for hedge effectiveness testing (hypothetical derivative method). Positions missing this field fall back to `contracted_rate` with a UI warning.

### Architecture
- No message queue / background jobs — all sync happens in browser
- No test suite
- Onboarding uses sessionStorage to pass data between steps (reliable but not persistent across browser restarts)

### CSP (vercel.json)
Must include `api.frankfurter.dev` in `connect-src` (was `api.frankfurter.app`).

---

## Session 6 — Code Review & Bug Fix Summary (2026-04-04)

Comprehensive code review identified and fixed **50+ bugs** across security, data integrity, performance, and code quality. Key categories:

### Security Fixes
- **RLS hardening:** `fx_rates` write-restricted to admins; `WITH CHECK` added to all onboarding UPDATE policies; `erp_connections` INSERT/UPDATE/DELETE restricted to admin/editor roles
- **Onboarding state machine:** Removed direct-update fallback in `useOnboarding`; all transitions go through `advance_onboarding_status` RPC with forward-only guards
- **PII stripping fixed:** Schema `sampleValues` now stripped at construction time; AI prompts and `field_mappings` DB records no longer contain raw PII
- **Support audit logs:** `BEFORE INSERT` trigger enforces `actor_email`, `actor_role`, `created_at` from server state — client cannot forge identity or backdate entries
- **Last-admin guard:** `support_change_user_role` prevents demoting the only admin of an org

### Financial Calculation Fixes
- **Hedge coverage direction:** `v_hedge_coverage` view and all client-side coverage functions now compute `|sell − buy|` net hedged, not raw sum
- **Hedge effectiveness:** Fixed double USD conversion for CCY/USD pairs in `hedgeEffectiveness.ts`
- **GoLive currency fields:** Fixed swapped `base_currency`/`quote_currency` on imported exposures
- **GoLive same-currency filter:** Rows where `txnCcy === funcCcy` are now excluded (no FX risk)
- **Consistent FX rates:** ExposurePage now uses `effectiveFxRates` (live with DB fallback), matching DashboardPage

### Auth Fixes
- **MFA race condition:** Removed direct `setUser` calls from `signIn`/`signUp`/`completeMfaSignIn`; `onAuthStateChange` handles user state exclusively
- **MFA session restore:** `completeMfaSignIn` now restores pending session tokens before verification
- **Email confirmation:** `detectSessionInUrl: true` enables auto-authentication from confirmation links
- **SmartRedirect:** Now waits for auth `loading` state before deciding redirect target
- **Auth context memoized:** All auth functions wrapped in `useCallback`, context value in `useMemo`

### Onboarding Fixes
- **GoLive applies field mappings:** Reads confirmed mappings from sessionStorage and remaps CSV column names to Quova canonical fields before import
- **Mapping status persists:** `useMappings` writes status changes back to sessionStorage so confirmed/rejected state survives navigation
- **Stale trade_date:** Module-level `EMPTY` constants replaced with `freshForm()` factory functions

### Data Integrity Fixes
- **Optimistic deletes:** `deleteExposure`/`deletePosition` now check DB result before updating local state
- **Error state clearing:** `useExposures`/`useBankAccounts` clear error on successful reload
- **`updated_at` triggers:** Auto-update trigger on 5 core tables
- **SQL constraints:** CHECK on `organisations.plan`, `erp_connections.status/sync_frequency`; NOT NULL on `audit_logs.org_id`; FK on `onboarding_sessions.created_by`
- **Missing indexes:** Added on `profiles.org_id`, `upload_batches.org_id`, `hedge_policies.org_id`, `hedge_positions(org_id, currency_pair)`

### Code Quality
- **Shared components:** `QuovaMark` logo component extracted; `.error-banner` CSS class replaces 7 inline style blocks
- **Duplicate code:** `fireAuditLog` helper in `useAuth`; `parseTotpUri` and `getStrength` cached per render
- **Build optimization:** Vite chunk splitting (vendor, supabase, charts); Google Fonts moved from CSS @import to HTML preconnect
- **ESLint:** Added to devDependencies with TypeScript and React Hooks plugins
- **Responsive CSS:** Basic `@media (max-width: 768px)` breakpoint for mobile
- **EntityContext.refreshEntities():** Replaces `window.location.reload()` in SettingsPage

---

## Session 7 — Financial Calculation Accuracy Sweep (2026-04-04)

Systematic audit of all financial calculations across the app. Identified and fixed **10+ calculation bugs** related to USD conversion, sign handling, circular logic, and mixed-currency aggregation.

### Hedge Effectiveness Engine (hedgeEffectiveness.ts)
- **Broke circular logic:** Replaced `deltaFvHedgedItem = -deltaFvInstrument` with independent valuation using hypothetical derivative method (ASC 815-20-25-3). Hedged item now valued via spot-to-spot change (`spot_rate_at_trade` → `currentSpot`), instrument via forward-to-spot change (`contracted_rate` → `currentSpot`). Forward points create real ineffectiveness.
- **Fixed regression circularity:** `buildMonthlyChanges` no longer constructs `y = -x`. Applies forward points basis adjustment so prospective test produces realistic R²/slope values.
- **New result fields:** `forwardPoints`, `spotRateAtTradeAvailable` — surfaced in expanded detail UI and XLSX export.
- **Updated methodology notes:** XLSX audit report and designation memos reference hypothetical derivative method.

### MTM / P&L Calculation Fixes
- **Analytics MTM chart (`AnalyticsPage.tsx`):** Removed `Math.abs` that stripped P&L sign; added direction-aware calculation (sell vs buy); added USD conversion for USD-base pairs.
- **Custom report `crBuildMtm`:** Added USD conversion for USD-base pairs; renamed column to "Unrealized P&L (USD)".
- **Board report MTM (`BoardReportPanel.tsx`):** Fixed reversed-pair fallback (now inverts rate); replaced broken `toUsd(rawMtm, base_currency)` with correct quote-currency-to-USD conversion matching TradePage reference implementation. Handles CCY/USD, USD/CCY, and cross pairs (EUR/CAD, GBP/CAD).
- **Board report VaR:** `Math.abs(totalExposureUsd - totalHedgedUsd)` so over-hedged books produce positive VaR.

### Mixed-Currency Aggregation Fixes
- **HedgePage tiles:** "Total Notional Hedged" now uses `toUsd()` per position; replaced meaningless "Average Contracted Rate" with "Unrealized P&L" (direction-aware, USD-converted).
- **StrategyPage maturities:** Both per-row display and 90-day total now use `toUsd()` instead of `notional_usd ?? notional_base` fallback.
- **TradePage blotter footer:** Total notional now uses `toUsd()` instead of raw `notional_base` sum.

### Over-Hedge Handling
- **ExposurePage + DashboardPage:** `unhedged` floored at zero with `Math.max(0, ...)`. Added `overHedged` variable; UI dynamically shows "Over-hedged" label (amber) when hedges exceed exposure.

### RFQ/Trade Pair Fix (TradePage.tsx)
- **Fixed hard-coded `base_currency/USD`:** RFQ pair now uses actual `currency_pair` from coverage record. Previously, EUR/GBP became EUR/USD and USD/JPY became USD/USD.
- **Fixed reversed-pair spot lookup:** Now inverts rate correctly.

### USD Conversion Pattern — Canonical Approach
All MTM/P&L calculations across the app now follow the same pattern:
```typescript
// rawMtm is always in the pair's quote currency
const quoteCcy = pair.split('/')[1] ?? 'USD'
const mtmUsd = toUsd(Math.abs(rawMtm), quoteCcy, fxRates) * (rawMtm >= 0 ? 1 : -1)
```
Reference implementation: `TradePage.tsx` lines 130–133.

---

## Environment Variables (names only)

```
VITE_SUPABASE_URL         — Supabase project URL
VITE_SUPABASE_ANON_KEY    — Supabase anonymous (public) API key
VITE_ANTHROPIC_API_KEY    — Anthropic API key (WARNING: exposed client-side — MVP only)
VITE_APP_NAME             — "Quova" (display name)
VITE_APP_VERSION          — "0.1.0"
VITE_MONITORING_ENDPOINT  — (optional) telemetry ingest URL
```

---

## Conventions & Patterns

### TypeScript
- Strict mode: no implicit `any`, no unused variables, explicit return types on all exported functions
- Types in `src/types/index.ts` (shared domain types) or inline in hook/component
- Use `as const` for literal union enums, not TypeScript `enum`

### Hooks
```typescript
import { useAuth } from './useAuth'
const { user, db } = useAuth()
const orgId = user?.profile?.org_id
```
Every data hook returns `{ data, loading, reload }`. All hooks guard on `orgId` before firing queries.

### FX Conversion — THE most important rule
```typescript
import { toUsd, FALLBACK_FX } from '@/lib/fx'
```
Never define local copies.

### Shared UI Components
- `<QuovaMark size={44} />` — brand logo SVG, used on Login/Signup/ResetPassword
- `.error-banner` CSS class — standard red error message bar

### Styling
- Inline styles using `var(--token)` for one-off layout
- CSS classes (`.card`, `.btn`, `.input`, `.badge`, `.error-banner`) for reusable patterns
- Never hardcode color hex values inline — always use CSS variables

### AI Output Safety
All strings from Claude API go through `stripQuotes()` in `claudeClient.ts`.

### Lazy Imports
PDF, PPTX, XLSX are heavy — import dynamically inside handlers, never at top of file.

---

## Schema Discovery Pipeline (`packages/schema-discovery`)

> **Location:** `/Users/stevenlabella/Git/packages/schema-discovery`
> **Purpose:** AI-powered ERP schema analysis for automated onboarding — takes raw ERP metadata, identifies FX-relevant tables, maps columns to Quova's exposure model, and generates a customer-facing mapping report.
> **Runtime:** Standalone TypeScript package (Node.js, not browser). Runs via `npx tsx`.

### Architecture

Dual-LLM reconciliation pipeline: two independent Claude Sonnet analysis passes are reconciled using a tiebreaker cascade (ERP profile knowledge → sample data patterns → data type compatibility → confidence gap). This catches ambiguous mappings like SAP's WRBTR vs DMBTR (document currency vs local currency) that a single pass would miss.

### File Structure

```
packages/schema-discovery/
├── src/
│   ├── types/
│   │   ├── schema-metadata.ts      # SchemaMetadata, TableMetadata, ColumnMetadata
│   │   ├── mapping-proposal.ts     # TableMappingProposal, ColumnMapping, QuovaField
│   │   └── reconciliation.ts       # ReconciliationResult, ReconciliationVerdict
│   │
│   ├── discovery/
│   │   └── orchestrator.ts         # DiscoveryOrchestrator — runs full pipeline (triage → analysis → reconciliation → report)
│   │
│   ├── reconciliation/
│   │   ├── reconciliation-engine.ts # Dual-model reconciliation with tiebreaker cascade
│   │   └── sample-data-validator.ts # Validates mappings against sample data patterns
│   │
│   ├── knowledge/
│   │   ├── erp-profiles/
│   │   │   ├── types.ts            # ErpProfile interface
│   │   │   └── sap-s4hana.ts       # SAP S/4HANA field naming conventions, table catalog
│   │   └── mapping-library.ts      # Historical mapping precedent library
│   │
│   ├── prompts/
│   │   ├── table-triage.ts         # Prompt builder for table classification (HIGH/MEDIUM/SKIP)
│   │   └── column-analysis.ts      # Prompt builder for column-to-Quova-field mapping
│   │
│   ├── llm/
│   │   ├── anthropic-client.ts     # LlmClient implementation using @anthropic-ai/sdk
│   │   ├── multi-model-client.ts   # Wrapper for dual-model analysis (temp 0 vs temp 0.3)
│   │   ├── response-validator.ts   # Validates LLM responses against expected schemas
│   │   ├── token-estimator.ts      # Rough token counter for batching decisions
│   │   └── config.ts               # Environment variable loader (ANTHROPIC_API_KEY, etc.)
│   │
│   ├── ingest/
│   │   ├── parser-interface.ts     # SchemaParser interface + ParserRegistry (auto-detect format)
│   │   ├── parser-utils.ts         # Shared parsing utilities
│   │   ├── sample-data-loader.ts   # Enriches SchemaMetadata with sample data (file or connector)
│   │   ├── parsers/
│   │   │   ├── csv-schema-parser.ts          # Flat CSV + sectioned CSV layouts
│   │   │   ├── sql-ddl-parser.ts             # CREATE TABLE DDL (SAP HANA, Oracle, PG, SQL Server)
│   │   │   ├── sap-data-dictionary-parser.ts # SE11/SE16 tab-delimited + XML exports
│   │   │   └── json-schema-parser.ts         # information_schema + API metadata formats
│   │   └── connectors/
│   │       ├── connector-interface.ts        # ErpConnector interface + ConnectionConfig
│   │       ├── sap-hana-connector.ts         # Stub — needs @sap/hana-client
│   │       ├── netsuite-connector.ts         # Stub — needs SuiteQL REST API + OAuth2
│   │       └── generic-jdbc-connector.ts     # Stub — needs node-java-bridge
│   │
│   ├── output/
│   │   ├── mapping-report.ts       # HTML report generator (self-contained, customer-facing)
│   │   └── pdf-export.ts           # Puppeteer-based PDF export (optional dependency)
│   │
│   └── test/
│       ├── fixtures/
│       │   └── mock-sap-schema.ts  # 60-table realistic SAP S/4HANA schema with sample data
│       ├── mock-llm-client.ts      # Deterministic mock with designed disagreements
│       ├── run-pipeline.ts         # CLI runner: --live (real LLM) | --input <file> | default (mock)
│       ├── reconciliation.test.ts  # Reconciliation engine assertions
│       ├── parsers.test.ts         # Parser tests with generated fixtures
│       └── llm-integration.test.ts # Live API test (requires ANTHROPIC_API_KEY)
│
├── output/                          # Generated reports (gitignored)
│   ├── mapping-report.html
│   └── mapping-report.pdf
├── .env.example                     # Environment variable template
├── tsconfig.json
└── package.json
```

### Running

```bash
cd packages/schema-discovery

# Mock mode (no API key needed — uses deterministic mock LLM)
npx tsx src/test/run-pipeline.ts

# Live mode (real Claude Sonnet calls — costs ~$0.50-$2.00 per run)
npx tsx src/test/run-pipeline.ts --live

# Live mode with real customer data
npx tsx src/test/run-pipeline.ts --live --input ./customer-export.csv

# View HTML report after any run
open output/mapping-report.html
# Or serve it: python3 -m http.server 5179 --directory output
```

### Environment Variables

```
ANTHROPIC_API_KEY              # Required for --live mode
ORBIT_DISCOVERY_MODEL          # Default: claude-sonnet-4-20250514
ORBIT_DISCOVERY_MAX_RETRIES    # Default: 3
ORBIT_DISCOVERY_TIMEOUT_MS     # Default: 120000
ORBIT_DISCOVERY_MAX_CONCURRENT # Default: 5 (parallel LLM calls)
ORBIT_DISCOVERY_LOG_LEVEL      # Default: info
```

### Key Design Decisions

1. **Dual-LLM reconciliation:** Two analysis passes with different temperatures (0 and 0.3) to get genuine diversity. Reconciliation uses a tiebreaker cascade — not majority vote — because domain expertise (ERP profile) should override confidence when the models disagree on ambiguous SAP fields.

2. **ERP profiles as knowledge:** `sap-s4hana.ts` encodes field naming conventions (WRBTR = document currency amount, DMBTR = local currency amount) that break ties the LLM can't resolve from column names alone.

3. **Customer-facing HTML report:** Self-contained HTML+CSS (no JS) that renders identically in any browser and converts to PDF. Designed to communicate competence to CFOs/treasury directors during onboarding.

4. **Parser auto-detection:** `ParserRegistry.canParse()` sniffs format from headers/structure so customers don't need to specify file type. Handles CSV, SQL DDL, SAP data dictionary, and JSON metadata exports.

5. **Connector stubs:** SAP HANA, NetSuite, and JDBC connectors are interface-only. Real implementations need their respective SDKs and will run server-side (never in browser).

### Integration with Quova client portal

The schema-discovery pipeline is the backend engine for the onboarding flow's DISCOVER and VALIDATE steps. Currently the MVP uses a simpler rule-based `discoveryService.ts` in the browser. The plan is to:
1. Wrap this pipeline in an Edge Function / BFF endpoint
2. Replace the browser-side discovery with API calls to this pipeline
3. Pipe the `DiscoveryReport` into the existing `ValidateMappings.tsx` UI

---

## Session 8 — Schema Discovery Pipeline (2026-04-06)

Built the complete `packages/schema-discovery` package — a standalone AI-powered ERP schema analysis system for automated onboarding.

### Components Built
- **Core types:** `SchemaMetadata`, `TableMappingProposal`, `ReconciliationResult` with full TypeScript interfaces
- **Reconciliation engine:** Dual-LLM reconciliation with tiebreaker cascade (ERP profile → sample data → data type → confidence gap)
- **Sample data validator:** Pattern matching on sample data to resolve ambiguous column mappings
- **SAP S/4HANA ERP profile:** Field naming conventions, table catalog, data type mappings for ~50 core SAP tables
- **Prompt builders:** Table triage (HIGH/MEDIUM/SKIP classification) and column analysis (map to Quova exposure model)
- **Orchestrator:** Full pipeline runner — triage → dual analysis → reconciliation → report generation
- **Anthropic LLM client:** Real `@anthropic-ai/sdk` integration with retry logic, rate limit handling, token tracking, cost estimation
- **Multi-model client:** Dual-model wrapper (temp 0 + temp 0.3) for independent analysis passes
- **Response validator:** Validates LLM JSON responses against expected schemas before pipeline consumption
- **Token estimator:** Rough token counting for context window guardrails and batch splitting
- **Ingestion parsers:** CSV (flat + sectioned), SQL DDL, SAP data dictionary (TSV), JSON (information_schema + API metadata) — all with auto-detection via `ParserRegistry`
- **Sample data loader:** Enriches schema with sample data from files or connectors, with PII redaction
- **Connector stubs:** SAP HANA, NetSuite, generic JDBC interfaces (not yet implemented)
- **HTML report generator:** Customer-facing mapping report with executive summary dashboard, per-table mappings, human review queue, validation SQL, methodology section, skipped tables appendix. Quova brand styling (navy + teal).
- **PDF export:** Puppeteer-based HTML→PDF with page headers, footers, and clean page breaks
- **Test harness:** 60-table mock SAP schema, deterministic mock LLM client with designed disagreements, CLI pipeline runner (`--live` / `--input` / mock modes), reconciliation assertion tests, parser tests with generated fixtures, live API integration test

### Pipeline Validated
- Mock mode: full pipeline runs end-to-end with deterministic results
- Live mode: successfully ran against Anthropic API with real Claude Sonnet calls. Rate limit retry logic works correctly on free tier (30K input tokens/min limit).
- HTML report generates at `output/mapping-report.html` — 18 tables analyzed, 77 columns mapped, 88.4% confidence, 98.7% agreement rate

---

## Business Context

- **CEO:** Steve LaBella
- **CPO & Co-Founder:** Mingze Deng
- **Elevator pitch:** "The other 95% of the FX workflow"
- **Target:** $1B–$40B revenue companies with active FX exposure and a treasury team
- **Design partners:** Celonis (IPO-prep), Sagard (Diagram Ventures)
- **Pending pilots:** Loblaw, Atlassian
- **Seed round:** $3–3.5M (in progress)
