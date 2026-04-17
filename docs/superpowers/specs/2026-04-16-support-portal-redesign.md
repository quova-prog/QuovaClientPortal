# Support Portal Redesign: Command Center

> **Date:** 2026-04-16
> **Author:** Steve LaBella + Claude
> **Status:** Approved
> **Scope:** Full redesign of orbit-support portal

---

## Problem

The support portal is a bare-bones v1: tenant list, detail tabs, read-only impersonation, data corrections, and audit logs. It lacks customer health visibility, proactive gap detection, and the ability to nudge customers when data is missing. With Loblaw, Atlassian, and Celonis pilots approaching, the portal needs to become a daily-use command center that immediately surfaces which customers need attention and why.

## User

Steve LaBella (founder, sole support user for now). The portal must give a fast, at-a-glance read on customer health without digging through individual tenant pages.

## Design

### 1. Health Scoring Engine

A per-customer health score computed by a Supabase Edge Function (`compute-health-scores`) on a cron schedule (every 6 hours). Results stored in `customer_health_scores` table.

**Dimensions (weighted into overall 0-100 score):**

| Dimension | What it checks | Weight |
|---|---|---|
| Data Completeness | Hedge policy set? Exposures uploaded? Entities created? Bank accounts? Counterparties? | 30% |
| Data Freshness | Days since last exposure upload, last hedge booked, last login | 25% |
| Coverage Health | Coverage % vs policy min/max, any pairs with 0% coverage | 20% |
| Onboarding Progress | Session status (setup/connect/discover/validate/live), days since last step | 15% |
| Position Risk | Hedges maturing within 14 days with no roll, unhedged exposure amount | 10% |

**Status mapping:**
- **Healthy** (80-100): green
- **Needs Attention** (50-79): yellow
- **At Risk** (0-49): red

### 2. Command Center Dashboard

Replaces the current dashboard. This is the landing page.

**Summary bar** — 4 KPI tiles:
- Customers At Risk (red count)
- Needs Attention (yellow count)
- Healthy (green count)
- Pending Nudges (sent but unacknowledged)

**Customer health grid** — one card per customer, sorted by health score (worst first):
- Org name + plan badge
- Overall health score (color-coded circle)
- Mini breakdown: 5 dimension bars
- Top gap callout (e.g., "No hedge policy set")
- Quick actions: "View Details", "Send Nudge"
- Last login timestamp + days since last activity

**Controls:**
- Filter by status (all / at risk / needs attention / healthy)
- Sort by health score, last activity, plan tier
- Search by org name

Cards layout (not table) — optimized for 5-20 customers in the pilot phase.

### 3. Gap Detection Rules

Hardcoded rules evaluated by the health scoring Edge Function. Configurable UI deferred until a support team exists.

| Gap | Condition | Severity |
|---|---|---|
| No hedge policy | `hedge_policies` has no active row for org | Critical |
| No exposures | `fx_exposures` count = 0 | Critical |
| No entities | `entities` count = 0 | Critical |
| Stale exposures | Last `fx_exposures` created_at > 14 days ago | Warning |
| No hedges booked | `hedge_positions` count = 0 and exposures exist | Warning |
| No bank accounts | `bank_accounts` count = 0 | Low |
| No counterparties | `counterparties` count = 0 | Low |
| Onboarding stalled | Session status not `live` and last event > 7 days ago | Warning |
| Coverage below policy | Any pair's coverage % < `min_coverage_pct` | Warning |
| Hedges expiring soon | Active positions with `value_date` within 14 days, no roll booked | Warning |
| No recent login | Last `auth.users` `last_sign_in_at` > 21 days ago | Low |

Results stored in `customer_health_scores.gaps` JSONB column — array of objects with type, severity, message, and relevant metadata.

### 4. Nudge System

Two channels: email (SendGrid, existing infrastructure) and in-app notification (new).

**Flow:**
1. Support clicks "Send Nudge" from dashboard card or tenant detail
2. Modal shows detected gaps, pre-selects relevant ones
3. Pick channel: email, in-app, or both
4. Email uses pre-built template per gap type with preview/edit before sending
5. In-app creates row in `customer_notifications` table, displayed as dismissible banner on customer's dashboard

**Nudge templates:** One per gap type. Each has subject, body, and CTA link to relevant client portal page (e.g., "Set up your hedge policy" links to `/strategy`). Hardcoded in Edge Function for now.

**Spam prevention:** Same gap type cannot be nudged to same org within 72 hours.

**Acknowledgment linkage:** When a customer dismisses an in-app notification (`customer_notifications.acknowledged_at` is set), the corresponding `nudges` record is also marked `acknowledged_at` via a DB trigger. This ensures the support portal shows accurate pending/acknowledged status regardless of which channel the customer responded through. Email-only nudges are marked acknowledged when the next health score computation finds the gap resolved.

**Tracking:** `nudges` table records all sends. Dashboard shows "Pending Nudges" count. Tenant detail shows nudge history with acknowledged/pending status.

**Edge Function:** `send-nudge` — handles both channels. Requires JIT access grant for target org. Logs to `nudges` + `email_logs`.

**Client-side (orbit-mvp):** New `useCustomerNotifications` hook reads from `customer_notifications`. Renders dismissible banner on customer dashboard with message + CTA button. Dismissal sets `acknowledged_at`, which flows back to support portal.

### 5. Redesigned Tenant Detail Page

Reorganized around "what needs attention" rather than raw data.

**New tab structure:**

| Tab | Purpose |
|---|---|
| **Health** (default) | Health score breakdown, active gaps with severity badges, nudge buttons per gap, gap history timeline |
| **Overview** | Org metadata, plan, pricing, payment — mostly unchanged |
| **Users** | Customer profiles with roles, last login, MFA status — mostly unchanged |
| **Data** | Combined view: exposure count by pair, hedge count by status, policy summary, entities, bank accounts. Shows what's there AND what's missing. Eliminates most impersonation needs. ERP connection status included here. |
| **Activity** | Merged: customer audit log + nudge history + login timeline. One chronological feed. |
| **Corrections** | Admin-only data corrections — unchanged |

**Key changes:**
- Health tab is the default landing (gaps first, not metadata)
- Data tab reduces impersonation needs (see data state without JIT access flow)
- Activity tab consolidates audit + nudge history
- Integrations tab removed as standalone (ERP status moves to Data tab)

### 6. Navigation & Page Structure

**Sidebar:**

| Nav Item | Page |
|---|---|
| Command Center | Health dashboard |
| Customers | Tenant list (cards show health score badge + top gap) |
| Audit | Combined page with sub-tabs: "Support Activity" and "Customer Activity" |
| Settings | Support user preferences (placeholder, minimal) |

**Sub-pages (no sidebar entry):**
- `Customers/:id` — Tenant detail (redesigned tabs)
- `Customers/:id/impersonate` — Read-only customer data (unchanged, still behind JIT gate)

**Removed:** Separate Customer Audit and Support Audit sidebar items (merged into Audit).

### 7. Database & Edge Functions

**New tables:**

#### `customer_health_scores`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `org_id` | UUID | FK to organisations, unique |
| `overall_score` | INTEGER | 0-100 |
| `status` | TEXT | healthy / needs_attention / at_risk |
| `dimensions` | JSONB | Per-dimension scores: { data_completeness: 85, data_freshness: 60, ... } |
| `gaps` | JSONB | Array: [{ type, severity, message, metadata }] |
| `computed_at` | TIMESTAMPTZ | Last computation time |

#### `customer_notifications`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `org_id` | UUID | FK to organisations |
| `gap_type` | TEXT | Which gap triggered this |
| `title` | TEXT | Notification title |
| `message` | TEXT | Notification body |
| `cta_url` | TEXT | Link to relevant page in client portal |
| `created_at` | TIMESTAMPTZ | When sent |
| `acknowledged_at` | TIMESTAMPTZ | When customer dismissed |

#### `nudges`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `org_id` | UUID | FK to organisations |
| `gap_type` | TEXT | Which gap this nudge addresses |
| `channel` | TEXT | email / in_app / both |
| `message` | TEXT | Message sent (for audit) |
| `sent_by` | UUID | Support user who sent it |
| `sent_at` | TIMESTAMPTZ | When sent |
| `acknowledged_at` | TIMESTAMPTZ | When customer acted on it |

**RLS policies:**
- `customer_health_scores`: support SELECT, service role INSERT/UPDATE, customers no access
- `customer_notifications`: customers SELECT + UPDATE (acknowledged_at only) scoped to own org, support SELECT via JIT, service role INSERT
- `nudges`: support SELECT/INSERT, customers no access

**New Edge Functions:**

| Function | Trigger | Purpose |
|---|---|---|
| `compute-health-scores` | pg_cron every 6 hours | Evaluate gap rules, compute dimension scores, write to `customer_health_scores` |
| `send-nudge` | Manual (support portal) | Send email and/or create `customer_notifications` row. Requires JIT grant. Enforces 72h cooldown. Logs to `nudges` + `email_logs`. |

**New pg_cron job:**
- `compute-health-scores` — `0 */6 * * *` (every 6 hours) — calls Edge Function via pg_net with service role key

**Client-side changes (orbit-mvp):**
- New `useCustomerNotifications` hook — reads `customer_notifications` for current org
- Dashboard banner component — dismissible, shows message + CTA button
- Dismissal updates `acknowledged_at`
