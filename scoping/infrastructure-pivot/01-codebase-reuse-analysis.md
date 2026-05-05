# 01 — Codebase Reuse Analysis

**Branch:** `scope/infrastructure-pivot`
**Date:** 2026-05-05
**Goal of this document:** Classify each major subsystem of Quova as REUSE / REFACTOR / REBUILD / DISCARD / NEW for the embedded-FX-API pivot, with rationale and rough engineer-week estimates.

> **Estimating convention.** All effort estimates assume **one senior full-stack engineer working full-time, augmented with Claude Code**. Estimates are in **engineer-weeks (EW)** to reach "good enough for a paying design partner," not "perfect." Wide error bars are flagged with a **±**. Effort to *cleanly extract* logic is estimated separately from effort to *expose it as a hardened API*; both are folded together unless noted.

> **Classification key.**
> - **REUSE** — ports cleanly to the API layer with minimal changes (≤1 EW per subsystem).
> - **REFACTOR** — business logic transfers but interfaces, packaging, or invocation context need significant change.
> - **REBUILD** — needs to be rewritten because it is fundamentally tied to the application context (UI, single-tenant browser session, etc.).
> - **DISCARD** — not relevant in the infrastructure model and should not be carried forward.
> - **NEW** — does not exist today and must be built from scratch.

---

## 1. Exposure detection and aggregation logic

**Current state.** Two layers. The "raw" layer is the `fx_exposures` table populated by ERP CSV imports. The "derived" layer (`useDerivedExposures.ts`) computes implicit FX exposures from supporting tables (purchase orders, revenue forecasts, payroll, capex, intercompany, supplier/customer contracts, cash flows, loan schedules, budget rates) and merges them into a unified view via `useCombinedCoverage.ts`. The DB views `v_exposure_summary` and `v_hedge_coverage` net receivables and payables and compute coverage percentages. The merging math (net exposure − hedged, by pair, by entity, by tenor bucket) is correct and direction-aware (`|sell − buy|`).

**Classification.** **REFACTOR** (math) + **REUSE** (DB views and types).

**Rationale.** The math itself is correct, well-tested in production, and not coupled to UI. But it currently lives inside React hooks (`useDerivedExposures`, `useCombinedCoverage`) — they fetch data via `db.from(...)` calls and then derive in `useMemo`. To expose this as `/v1/exposures/derive` and `/v1/coverage`, the derivation loops need to move into pure lib functions (`deriveExposuresFromSources(...)`, `mergeCoverageWithDerived(...)`). The hooks become thin React wrappers; the API handlers call the same lib functions.

**Effort.** **2 EW** (extract logic, port to lib, write idempotent handler, port DB view queries to API parameter shape).

---

## 2. Hedge advisor / recommendation engine

**Current state.** `src/lib/advisorEngine.ts` exposes `computeRiskMetrics`, `rankStrategies`, `runBacktest` as pure TypeScript functions. Inputs are domain types (`CombinedCoverage[]`, `HedgePosition[]`, `HedgePolicy | null`, rate maps, monthly snapshots). Outputs are plain `RiskMetrics`, `Strategy[]`, `BacktestResult` objects. Zero React/DOM imports. The Anthropic-backed executive-summary path is in `claudeClient.ts` and falls back to deterministic templates.

**Classification.** **REUSE.**

**Rationale.** This is the cleanest piece of the codebase. The hook (`useAdvisorEngine.ts`) is a thin orchestrator: fetch data, call engine, return result. Lifting the engine into an API handler is mechanical. Two known caveats: (1) the VaR is undiversified (sums standalone per-pair VaRs), so there is a trapped roadmap conversation about correlation matrices, and (2) Strategies B and C are not interactive (only Strategy A drives recommendations) — this is a known gap that should be closed *before* selling the API as a recommender, otherwise design partners will notice immediately.

**Effort.** **1 EW** to expose as API. **+1–2 EW ±1** if the diversified-VaR / multi-strategy gap must be closed for design-partner credibility.

---

## 3. Hedge accounting (ASC 815 / IFRS 9) and effectiveness testing

**Current state.** `src/lib/hedgeEffectiveness.ts` is a self-contained pure-TS engine implementing dollar-offset and prospective regression using the hypothetical derivative method. It correctly values the hedged item via spot-to-spot change and the instrument via forward-to-spot change so forward points produce real ineffectiveness. There is also `HedgeAccountingExport.tsx` (XLSX designation memo and audit pack) and the analytics-tab "Effectiveness Testing" UI. Hedge designation is captured during the booking flow (Cash Flow / Fair Value / Net Investment) and stored in position notes.

**Classification.** **REUSE** (engine) + **REFACTOR** (XLSX/PDF generation moves server-side).

**Rationale.** The engine is the most differentiated piece of IP in the codebase relative to fintech infrastructure competitors — most of them do not offer effectiveness testing or hedge accounting at all. It is also the strongest "premium module" candidate. The XLSX exporter currently runs in the browser; for an API customer, this should move to a server-side renderer (or at minimum an async job that returns a download URL). The hedge designation taxonomy already exists, but the metadata is stored in `notes` rather than first-class columns; this should be promoted to dedicated columns before exposing as an API resource.

**Effort.** **1 EW** for the engine endpoint. **+2 EW ±1** for the XLSX/PDF audit pack as a server-side artifact. **+0.5 EW** to promote hedge designation fields out of `notes`.

---

## 4. Trade workflow and RFQ logic

**Current state.** Multi-step trade entry form in `HedgePage.tsx` with hedge designation, strategy selection, and review. Roll/Amend/Close lifecycle (`hedge_lifecycle` migration) is implemented with `rolled_from_id` linkage, status transitions ('rolled', 'closed'), and audit logging. The "RFQ" today is UI-only — TradePage shows a request-for-quote pair against active counterparties but there is no backend connectivity to bank dealers. Counterparty data lives in the `counterparties` and `bank_accounts` tables.

**Classification.** **REFACTOR** (lifecycle state machine) + **NEW** (real RFQ / dealer connectivity).

**Rationale.** The lifecycle state machine (book → roll/amend/close) is good and worth preserving as the canonical model for hedge events on the API. The booking and amendment business rules (notional / rate / settlement / counterparty) and the audit trail of trade events are reusable. But the *execution* layer is essentially absent. A real Execute API needs FIX or REST connectivity to one or more multi-dealer platforms (360T, FXall, MarketAxess) or direct bank APIs (Citi Velocity, Goldman Marquee, JPM Algo, etc.), or an LP partner like LMAX / Integral. This is a major dependency that the current codebase does not address at all and is the single largest *new* build inside the pivot.

**Effort.** **1 EW** to expose lifecycle endpoints over the existing model. **6–12 EW ±4** to integrate one production dealer / multi-dealer venue with order routing, ticket capture, allocation, and settlement instructions. **±** is wide because dealer-side integration timelines are mostly externally bound (legal, KYC, certification testing).

---

## 5. Reporting and analytics

**Current state.** Five tabs on `AnalyticsPage.tsx`: Hedge View, Custom Reports, Hedge Accounting, Effectiveness Testing, Board Package. Board report PDF (`boardReportPdf.ts`, jsPDF, 6-page A4) and PPTX (`boardReportPptx.ts`, pptxgenjs, 6-slide) are generated client-side. MTM with USD conversion is correct and direction-aware. Custom report builder lets users compose tables of exposures/positions with filters; this is a UI feature, not a data feature.

**Classification.** **REFACTOR** (board reports, MTM, hedge accounting export) + **DISCARD** (custom report builder UI in its current form) + **NEW** (server-side rendering pipeline).

**Rationale.** The report *content generators* (board PDF, PPTX, hedge-accounting XLSX) are valuable IP — most fintechs cannot produce a CFO-grade board pack. They need to move from "render in browser, save to disk" to "generate on request, return download URL," which means a server-side equivalent (Puppeteer for PDF, python-pptx or a Node PPTX library, ExcelJS for XLSX). The custom report builder is fundamentally UI; an API equivalent is "give the customer the data and let them render their own reports," so the UI builder doesn't carry over directly — though the *queries* it generates do.

**Effort.** **3–5 EW ±2** for the server-side rendering pipeline (PDF/PPTX/XLSX) including job-runner pattern. The report content logic itself is largely lifted as-is.

---

## 6. Onboarding state machine and AI Discovery

**Current state.** Two distinct things sharing a name. (a) The 5-step browser onboarding flow (`onboarding/*.tsx`) with a state machine in `onboarding_sessions`, mappings persisted via sessionStorage, and a final `GoLive` step. (b) The standalone `packages/schema-discovery` Node package — a dual-LLM reconciliation pipeline with ERP profile knowledge, parsers for CSV/SQL DDL/SAP data dictionary/JSON schema, and an HTML/PDF mapping report. The standalone package is the more sophisticated of the two; the in-app `discoveryService.ts` is a simpler rule-based-first path.

**Classification.** **DISCARD** (in-app 5-step UI) + **REFACTOR** (state machine concept, recast as ingestion job lifecycle) + **REUSE** (schema-discovery package).

**Rationale.** The customer-facing 5-step wizard is the wrong abstraction for an API customer. An API customer doesn't "onboard" — they POST a schema or sample data and receive a mapping proposal asynchronously. The state machine concept (`setup → connect → discover → validate → live`) maps almost perfectly to an *ingestion job* lifecycle (`received → analyzing → mapping → confirmed → ingested`), which is genuinely useful as an API resource. The `packages/schema-discovery` Node package was almost certainly built with this future in mind — it is already standalone, has parsers, ERP profiles, dual-LLM reconciliation, and a server-side report generator. It is one of the most under-rated pieces of the codebase for the pivot.

**Effort.** **1 EW** to wrap `packages/schema-discovery` behind an API endpoint and a job runner. **2 EW ±1** to recast `onboarding_sessions` as a generic `ingestion_jobs` table and to reuse the state-machine RPC pattern. The browser flow is dropped or deferred to "reference admin console."

---

## 7. ERP/data ingestion adapters

**Current state.** Two layers. (a) `erpConnectorConfig.ts` — a config-driven catalog of 10 connectors (SAP S/4HANA Cloud/On-Prem/ECC, NetSuite, Oracle Cloud/EBS, Dynamics 365, Workday, Flat File, Custom API) with credential field definitions. The "test connection" is *simulated* — there are no real API calls to any of these systems. (b) `packages/schema-discovery/src/ingest/connectors/*` — interface stubs for SAP HANA, NetSuite, generic JDBC. Real implementations need their respective SDKs.

**Classification.** **REUSE** (config + schemas) + **NEW** (real connectors).

**Rationale.** The catalog and credential schemas are reusable and worth keeping as a marketing-facing surface. The actual integrations are absent. This is the second-largest *new* build for the pivot, though arguably less critical than execution because most fintech-API customers will already have transaction data — they POST it to your `/v1/transactions` endpoint. The real ERP connectors mostly matter for *direct corporate* customers, which is exactly the customer the pivot is moving away from. Conclusion: ERP connectors are *less* important after the pivot, not more. A "Custom API / Webhook ingest" connector is what most API customers will actually use.

**Effort.** **0.5 EW** to keep the config metadata as an API surface (list available connectors). **NEW build** of any actual ERP integration is out of scope for v0; it's a deal-by-deal project.

---

## 8. Customer dashboard UI (the entire `/src/pages/*` outside of admin)

**Current state.** ~20 pages (Dashboard, Inbox, Upload, Exposure, Strategy, Advisor, Hedge, Trade, Counterparties, Analytics, Bank Accounts, Integrations, Settings, Audit Log, Onboarding, Login/Signup/MFA). Real product, real users, deployed at `app.quovaos.com`. Built on the design system in `index.css`.

**Classification.** **DISCARD** (as a customer-facing surface) + **OPTIONAL REUSE** (as a reference / admin / demo console).

**Rationale.** This is the single biggest decision in the pivot (see `04-risks-and-decisions.md`). Three options:
1. **Keep as a reference implementation** — useful for sales demos, design-partner pilots before they have built their own UI, and for showing what the API can do. Recommended.
2. **Repurpose as an admin/back-office console for API customers** — they log in, see API logs, manage tenants, run reports for support cases. Useful but a meaningful long-term maintenance commitment.
3. **Discard.** Saves maintenance burden, loses the showroom.

The pages themselves are too coupled to a single-org-per-user mental model to reuse for multi-tenant API customer use. A login as an "engineer at Mercury" doesn't map cleanly onto an end-user with `org_id = mercury` and an entity picker that scopes them.

**Effort.** **0 EW** to keep current state as-is for demos. **3 EW ±1** to repurpose as an admin console with API-customer mental model (org becomes "API customer," tenant picker exposes their downstream end-customers).

---

## 9. Support portal (orbit-support)

**Current state.** A separate Vite SPA at port 5177. Support / support_admin roles. Tenant list with health scores, JIT 4-hour access grants per org, AAL2 enforcement, audit-logged data corrections (plan, role, pricing, payment method), impersonation flow gated by `AccessGate`, immutable audit log, command center metaphor. End-session flow revokes JIT grant.

**Classification.** **REUSE** (architecture, JIT pattern) + **REFACTOR** (rename and re-target).

**Rationale.** This portal is *exactly* the right shape for an internal tool that supports API customers. It already has the right mental model (multi-org, scoped access, audit trail, role separation). The pivot does not invalidate it; it *promotes* it from "support our 5 paying corporates" to "support our N API customers and their downstream customers." The JIT access pattern is also a great template for how API customers should access *their* downstream customer data through the platform — which is one of the harder data-residency questions in the pivot.

**Effort.** **1 EW** to rename, retarget, and add fields specific to API customers (rate limits, API key status, last successful API call, integration status). The JIT pattern carries over directly.

---

## 10. Multi-tenancy, RLS, audit triggers

**Current state.** Production-grade multi-tenant Postgres with RLS on every table, scoped by `current_user_org_id()` (which also enforces AAL2). Generic `audit_trigger_func()` applied to seven core tables with before/after JSONB snapshots. `write_audit_log()` RPC with content validation. Forward-only state machine RPCs. AAL2 enforced at DB and Edge boundaries. JIT support access via `support_access_grants` and `has_support_access_to(org_id)`.

**Classification.** **REUSE** (most of it) + **REFACTOR** (introduce a tenant-of-tenant layer) + **NEW** (API key auth alongside user-JWT auth).

**Rationale.** The multi-tenancy work done over the past several sessions is the single most valuable foundation for the pivot. RLS policies generalize naturally — an API customer is an `org`, and each end-customer of theirs is a sub-org or scoped resource. The harder question is the *shape* of that hierarchy: do API customers literally have child orgs (`parent_org_id`), or do they have a workspace per end-customer (`workspace_id` partition key alongside `org_id`)? The cleanest answer (covered in `04-risks-and-decisions.md`) is to add a `partner_id` / `workspace_id` column to every tenant-scoped table and update RLS to scope by `current_partner_id() OR current_user_org_id()` depending on the auth method. This is a real schema migration but mechanically simple. The audit triggers carry over verbatim.

**Effort.** **2 EW ±1** for the partner/workspace schema generalization and RLS update. **1.5 EW** for API key auth (generation, hashing, scopes, rotation, rate limits per key). **0.5 EW** for `partner_audit_logs` differentiation if needed.

---

## 11. Plan tier gating

**Current state.** Two pieces. (a) `tier_definitions` table — DB source of truth for feature flags, pricing, support SLA. (b) `tierService.ts` — static feature matrix in code, with `canAccess(plan, feature)`. Sidebar shows lock icons; upgrade modal triggers on click. Pro / Enterprise differentiated.

**Classification.** **REFACTOR** (rename) + **REUSE** (mechanism).

**Rationale.** The mechanism is sound. The product packaging changes from "Exposure / Pro / Enterprise" (corporate tiers) to "platform fee + usage-based + premium modules" (API tiers). The DB structure (boolean per feature flag, rolled up by plan) supports either. What changes is naming, defaults, and metering — the new dimension is *usage* (calls, exposures-tracked, hedges-booked). That's not gating; that's metering, which is in subsystem 14 below.

**Effort.** **0.5 EW** to remap names. **1.5 EW ±1** to add metering instrumentation hooks (which then feed billing).

---

## 12. Auth (MFA, role-based access)

**Current state.** Supabase Auth with mandatory TOTP MFA (AAL2). Role-based access (admin / editor / viewer). Idle timeout. SSO not implemented.

**Classification.** **REUSE** (end-user auth) + **NEW** (API key auth, OAuth for partners, optional SSO).

**Rationale.** The end-user auth path is fine and continues to apply in any "white-label embedded UI" or "admin console for the API customer's team" scenario. What's missing is the *machine* auth path: API keys for server-to-server calls, hashed at rest, scoped per-environment (sandbox vs. production), revocable, with rate limits. This is a known recipe but it's net-new code. OAuth-style flows (partner gets a client ID/secret, exchanges for tokens) are likely needed if the embedded UI or webhook signing path becomes important; they can be deferred to v1.

**Effort.** **1.5 EW** for API key auth (basic — generation, hashing, validation middleware, scopes, rate limit hooks). **+2 EW ±1** for OAuth client-credentials flow if needed for v0.

---

## 13. ERP/AI proxy infrastructure (Edge Functions)

**Current state.** Eight Supabase Edge Functions: `anthropic-proxy`, `compute-health-scores`, `send-daily-digest`, `send-nudge`, `send-team-invite`, `send-urgent-email`, `unsubscribe-email`. All Deno-based. Service-role and user-JWT auth paths. The `anthropic-proxy` is the closest thing to an API surface today.

**Classification.** **REUSE** (the proxy pattern) + **REFACTOR** (move to a real API gateway).

**Rationale.** Supabase Edge Functions are great for what they are — async/scheduled jobs and a thin proxy. But they are not the right home for a *paid public API* with rate limits, request signing, key rotation, latency SLAs, and per-customer metering. For v0 they can serve as the interim API surface (auth via custom middleware, rate limit via Postgres counter), but for production a real API runtime — Vercel Functions on Fluid Compute, or a Hono / Express service — is the right move. The good news is the engine code is environment-agnostic; it can run anywhere.

**Effort.** **2 EW ±1** to migrate the API surface from Edge Functions to Vercel Functions (or equivalent), reusing the same handlers. Sandbox/production environment split adds ~0.5 EW.

---

## 14. NEW: Pricing/metering, billing, observability

**Current state.** None of this exists. There is a `monthly_fee` / `setup_fee` on `organisations` for invoicing, but no metering of API usage, no usage-based billing, no per-customer dashboards on call volume, latency, errors.

**Classification.** **NEW.**

**Rationale.** A platform-fee + usage-based product cannot ship without metering. Every revenue-affecting event needs to be logged with `partner_id`, `endpoint`, `result`, `request_units`, `timestamp`. Aggregates roll up daily for invoicing and per-customer dashboards. Stripe metered billing is the obvious choice. Observability also needs a step-up — you need request-level traces, error rates per endpoint per customer, p95 latency per endpoint, and webhook delivery health.

**Effort.** **3 EW ±1** for the metering schema, instrumentation, daily aggregation, and a basic admin dashboard. **+2 EW ±1** for Stripe metered billing wiring. Can be deferred for the very first design partner if you charge a flat platform fee.

---

## 15. NEW: Webhooks / event delivery

**Current state.** None. Supabase realtime exists but is row-broadcast, not the right shape.

**Classification.** **NEW.**

**Rationale.** Most API customers will need outbound events: "a new exposure was detected," "a hedge effectiveness test failed," "a forward matured." Built right, this is a producer (write to `webhook_events` table) + worker (poll, deliver with retries, sign with HMAC, dead-letter) + customer dashboard (delivery health, retry, replay). Vercel Queues is a natural fit if shipping on Vercel.

**Effort.** **3 EW ±1.5** for the webhook delivery system end-to-end. Skippable for v0 if design partner is happy with polling.

---

## 16. NEW: Sandbox environment

**Current state.** None. There is one production environment.

**Classification.** **NEW.**

**Rationale.** No fintech infrastructure customer integrates without a sandbox. You need a parallel environment that issues sandbox API keys, runs against synthetic FX rates and fictional counterparties, and never bills. Architecturally this is a `environment` column on the partner / API key, plus deploy-time isolation if you want strong guarantees, plus seed data scripts.

**Effort.** **1.5 EW ±1** for a "soft" sandbox (same DB, environment flag everywhere). **3 EW ±1** for a "hard" sandbox (separate DB / project). v0 can ship with the soft version.

---

## 17. NEW: Developer experience surface (docs, SDK, examples)

**Current state.** None. No public documentation, no published SDK, no example apps.

**Classification.** **NEW.**

**Rationale.** Cannot sell an API without docs. Minimum: an OpenAPI spec, a docs site (Mintlify, Fern, ReadMe — all good), one TypeScript SDK (auto-generated from OpenAPI is fine for v0), and one or two reference apps (a "minimal-integrate Mercury" demo). For a design partner, a Postman collection is acceptable for the first integration session but becomes embarrassing fast.

**Effort.** **2 EW ±1** for the v0 surface (OpenAPI + docs site + TS SDK + one example). Iterates from there.

---

## 18. NEW: Partner-of-record / data residency / contracting layer

**Current state.** Partial. There is a `data_residency` column on `organisations` from earlier work, and DPAs exist informally, but nothing structurally enforced for partner-of-partner relationships.

**Classification.** **NEW** (light) — primarily a legal/contracting investment, not engineering. Engineering side is mostly metadata flags.

**Rationale.** Most enterprise fintechs need to know: "where is our customer data stored, who has access, can we delete it on request, and is there an SCC in place." Engineering exposure is small (~1 EW for residency-aware tenant placement) but the legal/operational work is real and a frequent gating factor for paid pilots.

**Effort.** **1 EW** engineering. Legal / commercial work owned outside this codebase but flagged here as a gating risk.

---

## Summary table

| # | Subsystem | Classification | EW (engineer-weeks) |
|---|---|---|---|
| 1 | Exposure detection / aggregation | REFACTOR + REUSE | 2 |
| 2 | Advisor / recommendation engine | REUSE | 1 (+1–2 for VaR/multi-strategy gap) |
| 3 | Hedge accounting & effectiveness | REUSE + REFACTOR | 1 + 2 + 0.5 |
| 4 | Trade workflow / RFQ | REFACTOR + NEW | 1 + 6–12 |
| 5 | Reporting & analytics | REFACTOR + DISCARD + NEW | 3–5 |
| 6 | Onboarding / AI Discovery | DISCARD + REFACTOR + REUSE | 1 + 2 |
| 7 | ERP ingestion adapters | REUSE + NEW | 0.5 (deferred) |
| 8 | Customer dashboard UI | DISCARD / OPTIONAL | 0 (or 3 if repurposed) |
| 9 | Support portal | REUSE + REFACTOR | 1 |
| 10 | Multi-tenancy / RLS / audit | REUSE + REFACTOR + NEW | 2 + 1.5 + 0.5 |
| 11 | Plan tier gating | REFACTOR + REUSE | 0.5 + 1.5 |
| 12 | Auth (MFA / RBAC) | REUSE + NEW | 1.5 (+2 for OAuth) |
| 13 | Edge Functions / proxy | REUSE + REFACTOR | 2 |
| 14 | **NEW** Metering / billing | NEW | 3 (+2 Stripe) |
| 15 | **NEW** Webhooks | NEW | 3 |
| 16 | **NEW** Sandbox | NEW | 1.5 |
| 17 | **NEW** Developer experience | NEW | 2 |
| 18 | **NEW** Data residency / contracting | NEW | 1 |

**Sum of midpoints, excluding execution dealer integration and excluding deferrable items:** ~28–34 EW. With dealer integration: 34–46 EW. The migration plan in document 03 is what sequences these and identifies the v0 cut.

---

## Things the codebase does well that *enable* the pivot

These are easy to under-appreciate and important to preserve:

- **`tier_definitions` as DB source of truth.** Repackaging is a config change, not a code refactor.
- **The dual-LLM reconciliation pipeline in `packages/schema-discovery`.** Already standalone, already server-shaped, already has an HTML/PDF report. This is the foundation of the Ingest API.
- **The pure-engine triumvirate** (`advisorEngine`, `scenarioEngine`, `hedgeEffectiveness`). These are competitive moat for a fintech API; competitors in the embedded-FX space don't have hedge-accounting-grade effectiveness testing.
- **The multi-tenant + audit + JIT-access foundation.** Done right and tested. The hardest 30% of an enterprise platform is already built.
- **The `audit_trigger_func()` pattern.** Generalizes to any new tenant-scoped table with one trigger declaration.
- **The MFA + AAL2 + service-role separation in Edge Functions.** This is exactly the pattern the API gateway needs.
- **The state-machine RPC pattern (`advance_onboarding_status`).** Reusable as `advance_ingestion_job_status`, `advance_hedge_lifecycle_status`.

## Things that look more coupled or fragile than expected

- **The Custom Reports tab.** Stores query definitions implicitly in component state; not generalized.
- **`spot_rate_at_trade` is nullable** on `hedge_positions` despite being load-bearing for effectiveness testing.
- **Currency-pair normalization** (`normalizeCurrencyPair`) is only applied at CSV-parse time, not at hedge entry, GoLive import, FX rate lookups, or coverage matching. This is a latent data-quality bug that will be exposed faster by API traffic than UI traffic.
- **`mapping_templates` table has no write policies** — the flywheel feature is non-functional at the DB level. Either fix or drop before the pivot.
- **`as any` casts in 15+ data hooks** suggest the Supabase generated types are out of date. Worth regenerating before exposing typed APIs.
