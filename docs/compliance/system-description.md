# Orbit System Description

- Version: Draft 1.0
- Owner: Engineering / Security
- Last updated: 2026-03-31
- Intended use: SOC 2 readiness and audit preparation

## 1. System Overview

Orbit is a web application for treasury and finance teams to manage foreign exchange exposure, hedge policy, hedge positions, reporting, analytics, and related operational workflows.

Based on repo evidence, the system consists of:
- a React + TypeScript single-page application built with Vite
- Supabase for authentication and PostgreSQL data storage
- row-level security and SQL migrations under `supabase/migrations/`
- Vercel for frontend hosting

No custom backend server was found in the repo.

## 2. Principal Service Commitments

Orbit is intended to:
- restrict customer data access by organization and role
- support treasury workflows for exposure tracking and hedge operations
- produce audit activity records for key in-app events
- provide downloadable reports and analytics for authorized users

## 3. System Boundaries

In scope system components:
- frontend application under `src/`
- Supabase authentication and PostgreSQL database
- SQL migration history under `supabase/migrations/`
- monitoring client under `src/lib/monitoring.ts`
- CI/security workflows under `.github/workflows/`

Out of scope unless separately documented:
- customer ERP source systems
- customer identity providers beyond Supabase Auth
- customer endpoint/device controls
- email delivery infrastructure details not represented in repo

## 4. Infrastructure and Software

Application tier:
- Vite/React SPA served to end users
- route-level rendering and protected routes in `src/App.tsx`

Authentication:
- Supabase Auth with email/password and MFA support
- app session handling in `src/hooks/useAuth.tsx`
- MFA enrollment and verification in `src/hooks/useMfa.ts` and `src/pages/SettingsPage.tsx`

Data tier:
- PostgreSQL tables and RLS policies defined through SQL migrations
- organization- and role-scoped access enforced primarily in database policy layer

Hosting:
- Vercel configuration in `vercel.json`
- security headers and CSP configured in `vercel.json`

Monitoring:
- structured client-side monitoring events sent to `VITE_MONITORING_ENDPOINT` when configured
- global monitoring bridge in `src/components/app/MonitoringBridge.tsx`

## 5. People

Primary internal roles:
- engineering maintainers
- security/control owner
- operations/deployment owner
- auditors/reviewers

Primary external users:
- treasury users
- finance users
- administrators managing entity, policy, and security settings

## 6. Data Categories

Observed categories in repo:
- account and identity data
- organization and role data
- hedge policies
- hedge positions
- FX exposures and upload batches
- bank account metadata
- analytics and downloadable reports
- audit logs

Potentially confidential data:
- treasury forecasts and cash flow data
- bank account metadata
- uploaded ERP-derived financial records
- audit history linked to users and organizations

## 7. Data Flow Summary

Typical system flow:
1. User authenticates through Supabase Auth.
2. Frontend reads org/profile context and renders role-appropriate UI.
3. Frontend performs direct reads and writes against Supabase tables.
4. PostgreSQL RLS policies enforce organization and role boundaries.
5. Sensitive user actions write audit log records to `audit_logs`.
6. Monitoring client forwards operational/security events to a configured endpoint.
7. Users may download reports generated in-browser from live application data.

## 8. Relevant Subservice Organizations

Subservice organizations inferred from repo:
- Supabase
- Vercel
- GitHub
- npm registry and package ecosystem
- any configured monitoring/event intake provider behind `VITE_MONITORING_ENDPOINT`

Additional vendors may exist outside this repo and should be added before audit fieldwork.

## 9. Control Highlights

Controls currently represented in repo:
- role-aware RLS hardening migrations
- immutable audit log protections in database migrations
- security regression tests for critical policy assumptions
- centralized monitoring hooks for crashes and auth/security anomalies
- CI workflows for build/security validation
- CSP and security headers in Vercel config

Controls requiring operational evidence outside the repo:
- branch protection and mandatory review enforcement
- access reviews
- incident response execution
- backup and restore testing
- vendor reviews
- production monitoring review cadence

## 10. Risks and Dependencies

Known architectural dependencies:
- database policy correctness is the primary authorization boundary
- browser storage and client-side execution remain relevant XSS risk factors
- production monitoring only works when `VITE_MONITORING_ENDPOINT` is configured and monitored
- recent security migrations must remain applied in production

## 11. Complementary User Entity Controls

Customers are responsible for:
- protecting their endpoint devices and browsers
- managing who is authorized to use Orbit within their organization
- validating imported data accuracy from upstream ERP systems
- notifying Orbit of suspected compromise or unauthorized access
