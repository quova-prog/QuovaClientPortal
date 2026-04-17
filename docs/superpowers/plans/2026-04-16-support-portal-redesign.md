# Support Portal Redesign: Command Center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the orbit-support portal from a bare-bones tenant viewer into a customer health command center with gap detection, health scoring, and a nudge system.

**Architecture:** Two Supabase Edge Functions (`compute-health-scores`, `send-nudge`) powered by pg_cron write health data to 3 new tables. The orbit-support SPA reads this data to render a command center dashboard and redesigned tenant detail pages. A small client-side addition to orbit-mvp displays in-app notification banners to customers.

**Tech Stack:** React 18 + TypeScript, Supabase (PostgreSQL + Edge Functions + RLS), SendGrid (existing), Vite, Lucide icons, date-fns, CSS variables (existing design system).

**Spec:** `docs/superpowers/specs/2026-04-16-support-portal-redesign.md`

---

## File Structure

### New files — orbit-mvp (Supabase migrations + Edge Functions)

| File | Responsibility |
|---|---|
| `supabase/migrations/20260416_health_scores_tables.sql` | Create `customer_health_scores`, `customer_notifications`, `nudges` tables with RLS + indexes |
| `supabase/migrations/20260416_health_scores_cron.sql` | pg_cron job for `compute-health-scores` every 6 hours |
| `supabase/functions/compute-health-scores/index.ts` | Edge Function: evaluate gap rules, compute dimension scores, write to `customer_health_scores` |
| `supabase/functions/send-nudge/index.ts` | Edge Function: send email + in-app nudge, enforce 72h cooldown, log to `nudges` + `email_logs` |

### New files — orbit-mvp (client-side customer notifications)

| File | Responsibility |
|---|---|
| `src/hooks/useCustomerNotifications.ts` | Hook: read `customer_notifications` for current org, dismiss (set `acknowledged_at`) |
| `src/components/ui/CustomerNotificationBanner.tsx` | Dismissible banner on customer dashboard with message + CTA button |

### New files — orbit-support

| File | Responsibility |
|---|---|
| `src/hooks/useHealthScores.ts` | Hook: read `customer_health_scores` for all orgs or single org |
| `src/hooks/useNudges.ts` | Hook: read nudge history for an org, send nudge via Edge Function |
| `src/pages/CommandCenterPage.tsx` | Command center dashboard: KPI tiles, customer health grid with cards |
| `src/pages/AuditPage.tsx` | Combined audit page with Support Activity + Customer Activity sub-tabs |
| `src/components/HealthScoreCircle.tsx` | Color-coded circle displaying 0-100 health score |
| `src/components/GapBadge.tsx` | Severity badge for a detected gap (critical/warning/low) |
| `src/components/NudgeModal.tsx` | Modal: select gaps, pick channel, preview/edit message, send |
| `src/components/CustomerHealthCard.tsx` | Card for one customer: score, dimensions, top gap, quick actions |

### Modified files — orbit-support

| File | Changes |
|---|---|
| `src/App.tsx` | Replace `/dashboard` route with CommandCenterPage, replace audit routes with AuditPage |
| `src/components/layout/AppLayout.tsx` | Update sidebar nav: Command Center, Customers, Audit, Settings |
| `src/pages/TenantsPage.tsx` | Add health score badge + top gap to each tenant row |
| `src/pages/TenantDetailPage.tsx` | Replace 5-tab structure with 6-tab (Health, Overview, Users, Data, Activity, Corrections) |
| `src/types/index.ts` | Add health score, gap, nudge, customer notification types |

### Modified files — orbit-mvp

| File | Changes |
|---|---|
| `src/pages/DashboardPage.tsx` | Render `CustomerNotificationBanner` at top of dashboard |

---

## Task 1: Database Tables & RLS

**Files:**
- Create: `supabase/migrations/20260416_health_scores_tables.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- QUOVA: Health scoring, customer notifications, nudges
-- ============================================================

-- Customer health scores (computed by Edge Function)
CREATE TABLE customer_health_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  overall_score INTEGER NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'needs_attention', 'at_risk')),
  dimensions JSONB NOT NULL DEFAULT '{}',
  gaps JSONB NOT NULL DEFAULT '[]',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE INDEX idx_health_scores_org ON customer_health_scores(org_id);
CREATE INDEX idx_health_scores_status ON customer_health_scores(status);

-- RLS: support SELECT, service role INSERT/UPDATE, customers no access
ALTER TABLE customer_health_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Support users can read health scores"
  ON customer_health_scores FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM support_users WHERE id = auth.uid() AND is_active = true)
  );

-- Service role bypasses RLS, so no explicit INSERT/UPDATE policy needed


-- Customer notifications (in-app, shown to customers)
CREATE TABLE customer_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  gap_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  cta_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX idx_customer_notifications_org ON customer_notifications(org_id);
CREATE INDEX idx_customer_notifications_unacked ON customer_notifications(org_id) WHERE acknowledged_at IS NULL;

ALTER TABLE customer_notifications ENABLE ROW LEVEL SECURITY;

-- Customers can read their own org's notifications
CREATE POLICY "Customers can read own notifications"
  ON customer_notifications FOR SELECT
  USING (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  );

-- Customers can acknowledge (update acknowledged_at only)
CREATE POLICY "Customers can acknowledge own notifications"
  ON customer_notifications FOR UPDATE
  USING (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  );

-- Support can read via JIT access
CREATE POLICY "Support can read notifications with JIT access"
  ON customer_notifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM support_access_grants
      WHERE user_id = auth.uid()
        AND support_access_grants.org_id = customer_notifications.org_id
        AND revoked_at IS NULL
        AND expires_at > now()
    )
  );


-- Nudges (support tracking)
CREATE TABLE nudges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  gap_type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'in_app', 'both')),
  message TEXT,
  sent_by UUID NOT NULL REFERENCES auth.users(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX idx_nudges_org ON nudges(org_id);
CREATE INDEX idx_nudges_cooldown ON nudges(org_id, gap_type, sent_at);

ALTER TABLE nudges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Support users can read nudges"
  ON nudges FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM support_users WHERE id = auth.uid() AND is_active = true)
  );

CREATE POLICY "Support users can insert nudges"
  ON nudges FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM support_users WHERE id = auth.uid() AND is_active = true)
  );


-- Trigger: when customer_notifications.acknowledged_at is set, update matching nudge
CREATE OR REPLACE FUNCTION sync_nudge_acknowledgment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.acknowledged_at IS NOT NULL AND OLD.acknowledged_at IS NULL THEN
    UPDATE nudges
    SET acknowledged_at = NEW.acknowledged_at
    WHERE org_id = NEW.org_id
      AND gap_type = NEW.gap_type
      AND acknowledged_at IS NULL
      AND sent_at = (
        SELECT MAX(sent_at) FROM nudges
        WHERE org_id = NEW.org_id AND gap_type = NEW.gap_type AND acknowledged_at IS NULL
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_sync_nudge_ack
  AFTER UPDATE ON customer_notifications
  FOR EACH ROW
  EXECUTE FUNCTION sync_nudge_acknowledgment();
```

- [ ] **Step 2: Apply the migration**

Run in Supabase SQL Editor or via CLI:
```bash
supabase db push
```

Verify tables exist:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('customer_health_scores', 'customer_notifications', 'nudges');
```
Expected: 3 rows.

- [ ] **Step 3: Commit**

```bash
cd /Users/stevenlabella/Git/orbit-mvp
git add supabase/migrations/20260416_health_scores_tables.sql
git commit -m "feat: add customer_health_scores, customer_notifications, nudges tables with RLS"
```

---

## Task 2: compute-health-scores Edge Function

**Files:**
- Create: `supabase/functions/compute-health-scores/index.ts`

- [ ] **Step 1: Create the Edge Function**

```typescript
// ============================================================
// QUOVA Edge Function: compute-health-scores
// Evaluates gap rules per org, computes dimension scores,
// writes results to customer_health_scores table.
// Triggered by pg_cron every 6 hours.
// ============================================================

import { createAdminClient, authenticateRequest, jsonResponse, corsHeaders } from '../_shared/auth.ts'

interface Gap {
  type: string
  severity: 'critical' | 'warning' | 'low'
  message: string
  metadata?: Record<string, unknown>
}

interface DimensionScores {
  data_completeness: number
  data_freshness: number
  coverage_health: number
  onboarding_progress: number
  position_risk: number
}

const WEIGHTS: Record<keyof DimensionScores, number> = {
  data_completeness: 0.30,
  data_freshness: 0.25,
  coverage_health: 0.20,
  onboarding_progress: 0.15,
  position_risk: 0.10,
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const auth = await authenticateRequest(req)
  if (!auth.authenticated) {
    return jsonResponse({ error: auth.error ?? 'Unauthorized' }, 401)
  }

  if (!auth.isServiceRole) {
    return jsonResponse({ error: 'Forbidden: Service Role required' }, 403)
  }

  const admin = createAdminClient()

  // Fetch all orgs
  const { data: orgs, error: orgErr } = await admin
    .from('organisations')
    .select('id, name, plan')

  if (orgErr || !orgs) {
    return jsonResponse({ error: 'Failed to fetch orgs', detail: orgErr?.message }, 500)
  }

  let processed = 0

  for (const org of orgs) {
    const gaps: Gap[] = []
    const dimensions: DimensionScores = {
      data_completeness: 100,
      data_freshness: 100,
      coverage_health: 100,
      onboarding_progress: 100,
      position_risk: 100,
    }

    // ── Data Completeness (30%) ──────────────────────────────

    // Check hedge policy
    const { count: policyCount } = await admin
      .from('hedge_policies')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id)
      .eq('active', true)

    if (!policyCount || policyCount === 0) {
      gaps.push({ type: 'no_hedge_policy', severity: 'critical', message: 'No active hedge policy set' })
      dimensions.data_completeness -= 30
    }

    // Check exposures
    const { count: exposureCount } = await admin
      .from('fx_exposures')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id)

    if (!exposureCount || exposureCount === 0) {
      gaps.push({ type: 'no_exposures', severity: 'critical', message: 'No FX exposures uploaded' })
      dimensions.data_completeness -= 30
    }

    // Check entities
    const { count: entityCount } = await admin
      .from('entities')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id)

    if (!entityCount || entityCount === 0) {
      gaps.push({ type: 'no_entities', severity: 'critical', message: 'No legal entities created' })
      dimensions.data_completeness -= 20
    }

    // Check bank accounts
    const { count: bankCount } = await admin
      .from('bank_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id)

    if (!bankCount || bankCount === 0) {
      gaps.push({ type: 'no_bank_accounts', severity: 'low', message: 'No bank accounts registered' })
      dimensions.data_completeness -= 10
    }

    // Check counterparties
    const { count: counterpartyCount } = await admin
      .from('counterparties')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id)

    if (!counterpartyCount || counterpartyCount === 0) {
      gaps.push({ type: 'no_counterparties', severity: 'low', message: 'No counterparties added' })
      dimensions.data_completeness -= 10
    }

    dimensions.data_completeness = Math.max(0, dimensions.data_completeness)

    // ── Data Freshness (25%) ─────────────────────────────────

    const now = Date.now()

    // Last exposure upload
    if (exposureCount && exposureCount > 0) {
      const { data: latestExposure } = await admin
        .from('fx_exposures')
        .select('created_at')
        .eq('org_id', org.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (latestExposure) {
        const daysSince = (now - new Date(latestExposure.created_at).getTime()) / 86400000
        if (daysSince > 14) {
          gaps.push({
            type: 'stale_exposures',
            severity: 'warning',
            message: `Exposures last updated ${Math.floor(daysSince)} days ago`,
            metadata: { days_since: Math.floor(daysSince) },
          })
          dimensions.data_freshness -= Math.min(50, daysSince * 2)
        }
      }
    } else {
      dimensions.data_freshness -= 40
    }

    // Last hedge booked
    const { data: latestHedge } = await admin
      .from('hedge_positions')
      .select('created_at')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latestHedge) {
      if (exposureCount && exposureCount > 0) {
        gaps.push({ type: 'no_hedges', severity: 'warning', message: 'No hedges booked despite active exposures' })
      }
      dimensions.data_freshness -= 30
    }

    // Last login
    const { data: orgProfiles } = await admin
      .from('profiles')
      .select('id')
      .eq('org_id', org.id)

    if (orgProfiles && orgProfiles.length > 0) {
      const { data: authUsers } = await admin.auth.admin.listUsers()
      const orgUserIds = new Set(orgProfiles.map(p => p.id))
      const orgAuthUsers = authUsers?.users?.filter(u => orgUserIds.has(u.id)) ?? []
      const lastLogin = orgAuthUsers.reduce((latest, u) => {
        const t = u.last_sign_in_at ? new Date(u.last_sign_in_at).getTime() : 0
        return t > latest ? t : latest
      }, 0)

      if (lastLogin > 0) {
        const daysSinceLogin = (now - lastLogin) / 86400000
        if (daysSinceLogin > 21) {
          gaps.push({
            type: 'no_recent_login',
            severity: 'low',
            message: `No user login in ${Math.floor(daysSinceLogin)} days`,
            metadata: { days_since: Math.floor(daysSinceLogin) },
          })
          dimensions.data_freshness -= Math.min(30, daysSinceLogin)
        }
      } else {
        dimensions.data_freshness -= 30
      }
    }

    dimensions.data_freshness = Math.max(0, dimensions.data_freshness)

    // ── Coverage Health (20%) ────────────────────────────────

    const { data: coverage } = await admin
      .from('v_hedge_coverage')
      .select('currency_pair, coverage_pct')
      .eq('org_id', org.id)

    const { data: policy } = await admin
      .from('hedge_policies')
      .select('min_coverage_pct')
      .eq('org_id', org.id)
      .eq('active', true)
      .maybeSingle()

    const minCoverage = policy?.min_coverage_pct ?? 85

    if (coverage && coverage.length > 0) {
      const underCoveredPairs = coverage.filter(c => (c.coverage_pct ?? 0) < minCoverage)
      if (underCoveredPairs.length > 0) {
        for (const pair of underCoveredPairs) {
          gaps.push({
            type: 'coverage_below_policy',
            severity: 'warning',
            message: `${pair.currency_pair} coverage at ${(pair.coverage_pct ?? 0).toFixed(0)}% (policy min: ${minCoverage}%)`,
            metadata: { pair: pair.currency_pair, coverage_pct: pair.coverage_pct, min_pct: minCoverage },
          })
        }
        const avgDeficit = underCoveredPairs.reduce((s, p) => s + (minCoverage - (p.coverage_pct ?? 0)), 0) / underCoveredPairs.length
        dimensions.coverage_health -= Math.min(100, avgDeficit * 2)
      }
    } else if (exposureCount && exposureCount > 0) {
      // Has exposures but no coverage data means 0% covered
      dimensions.coverage_health = 0
    }

    dimensions.coverage_health = Math.max(0, dimensions.coverage_health)

    // ── Onboarding Progress (15%) ────────────────────────────

    const { data: session } = await admin
      .from('onboarding_sessions')
      .select('status, updated_at')
      .eq('org_id', org.id)
      .maybeSingle()

    if (!session) {
      dimensions.onboarding_progress = 0
    } else if (session.status === 'live') {
      dimensions.onboarding_progress = 100
    } else {
      const statusScores: Record<string, number> = {
        setup: 20, connect: 40, discover: 60, validate: 80, error: 10,
      }
      dimensions.onboarding_progress = statusScores[session.status] ?? 0

      const daysSinceUpdate = (now - new Date(session.updated_at).getTime()) / 86400000
      if (daysSinceUpdate > 7) {
        gaps.push({
          type: 'onboarding_stalled',
          severity: 'warning',
          message: `Onboarding stalled at "${session.status}" for ${Math.floor(daysSinceUpdate)} days`,
          metadata: { current_step: session.status, days_stalled: Math.floor(daysSinceUpdate) },
        })
      }
    }

    // ── Position Risk (10%) ──────────────────────────────────

    const fourteenDaysOut = new Date(now + 14 * 86400000).toISOString().split('T')[0]
    const today = new Date().toISOString().split('T')[0]

    const { data: expiringPositions } = await admin
      .from('hedge_positions')
      .select('id, currency_pair, value_date, rolled_from_id')
      .eq('org_id', org.id)
      .eq('status', 'active')
      .lte('value_date', fourteenDaysOut)
      .gte('value_date', today)

    if (expiringPositions && expiringPositions.length > 0) {
      // Check if any have been rolled (i.e., a newer position references them)
      const expiringIds = expiringPositions.map(p => p.id)
      const { data: rolls } = await admin
        .from('hedge_positions')
        .select('rolled_from_id')
        .in('rolled_from_id', expiringIds)

      const rolledIds = new Set((rolls ?? []).map(r => r.rolled_from_id))
      const unrolled = expiringPositions.filter(p => !rolledIds.has(p.id))

      if (unrolled.length > 0) {
        gaps.push({
          type: 'hedges_expiring_soon',
          severity: 'warning',
          message: `${unrolled.length} hedge position(s) maturing within 14 days with no roll booked`,
          metadata: { count: unrolled.length, pairs: [...new Set(unrolled.map(p => p.currency_pair))] },
        })
        dimensions.position_risk -= Math.min(100, unrolled.length * 25)
      }
    }

    dimensions.position_risk = Math.max(0, dimensions.position_risk)

    // ── Compute overall score ────────────────────────────────

    const overall = Math.round(
      dimensions.data_completeness * WEIGHTS.data_completeness +
      dimensions.data_freshness * WEIGHTS.data_freshness +
      dimensions.coverage_health * WEIGHTS.coverage_health +
      dimensions.onboarding_progress * WEIGHTS.onboarding_progress +
      dimensions.position_risk * WEIGHTS.position_risk
    )

    const status = overall >= 80 ? 'healthy' : overall >= 50 ? 'needs_attention' : 'at_risk'

    // ── Upsert ───────────────────────────────────────────────

    await admin
      .from('customer_health_scores')
      .upsert({
        org_id: org.id,
        overall_score: overall,
        status,
        dimensions,
        gaps,
        computed_at: new Date().toISOString(),
      }, { onConflict: 'org_id' })

    processed++
  }

  return jsonResponse({ message: 'Health scores computed', processed }, 200)
})
```

- [ ] **Step 2: Deploy the Edge Function**

```bash
cd /Users/stevenlabella/Git/orbit-mvp
supabase functions deploy compute-health-scores --no-verify-jwt
```

- [ ] **Step 3: Test manually**

```bash
curl -X POST \
  "https://vmtwojalyzvmdpldgabi.supabase.co/functions/v1/compute-health-scores" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json"
```

Expected: `{ "message": "Health scores computed", "processed": N }` where N = number of orgs.

Verify in SQL Editor:
```sql
SELECT org_id, overall_score, status, gaps FROM customer_health_scores;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/compute-health-scores/index.ts
git commit -m "feat: add compute-health-scores Edge Function with gap detection"
```

---

## Task 3: pg_cron Job for Health Scores

**Files:**
- Create: `supabase/migrations/20260416_health_scores_cron.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- QUOVA: pg_cron job — compute health scores every 6 hours
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'compute-health-scores',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/compute-health-scores',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 2: Apply the migration**

Run in Supabase SQL Editor. Expected: returns a job ID (integer).

Verify:
```sql
SELECT * FROM cron.job WHERE jobname = 'compute-health-scores';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260416_health_scores_cron.sql
git commit -m "feat: add pg_cron job for health score computation every 6 hours"
```

---

## Task 4: send-nudge Edge Function

**Files:**
- Create: `supabase/functions/send-nudge/index.ts`

- [ ] **Step 1: Create the Edge Function**

```typescript
// ============================================================
// QUOVA Edge Function: send-nudge
// Sends email and/or in-app notification for detected gaps.
// Requires JIT access grant. Enforces 72h cooldown.
// ============================================================

import { createAdminClient, authenticateRequest, jsonResponse, corsHeaders } from '../_shared/auth.ts'
import { sendEmail } from '../_shared/sendgrid.ts'
import { signUnsubscribeToken } from '../_shared/crypto.ts'

const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? 'https://app.quovaos.com'

interface NudgeRequest {
  org_id: string
  gaps: Array<{
    type: string
    channel: 'email' | 'in_app' | 'both'
  }>
  custom_message?: string
}

const NUDGE_TEMPLATES: Record<string, { subject: string; title: string; message: string; cta_url: string }> = {
  no_hedge_policy: {
    subject: 'Set up your hedge policy in Quova',
    title: 'Hedge Policy Required',
    message: 'Your organisation doesn\'t have an active hedge policy. A hedge policy defines your target coverage range and is essential for risk management. Set one up now to start getting coverage recommendations.',
    cta_url: '/strategy',
  },
  no_exposures: {
    subject: 'Upload your FX exposures to Quova',
    title: 'FX Exposures Needed',
    message: 'You haven\'t uploaded any FX exposures yet. Quova needs your exposure data to calculate coverage, generate recommendations, and produce board reports. Upload via CSV or connect your ERP.',
    cta_url: '/upload',
  },
  no_entities: {
    subject: 'Add your legal entities in Quova',
    title: 'Legal Entities Missing',
    message: 'No legal entities have been created. Entities are required to properly attribute exposures and hedges to the right business units. Add your entities in Settings.',
    cta_url: '/settings',
  },
  stale_exposures: {
    subject: 'Your Quova exposure data may be outdated',
    title: 'Exposure Data Outdated',
    message: 'Your FX exposure data hasn\'t been updated recently. Stale data means your coverage analysis and recommendations may not reflect your current risk position. Upload fresh data to stay current.',
    cta_url: '/upload',
  },
  no_hedges: {
    subject: 'Book your first hedge in Quova',
    title: 'No Hedges Booked',
    message: 'You have active FX exposures but no hedges booked. Use the Hedge Advisor to get recommendations, then book hedges to manage your currency risk.',
    cta_url: '/advisor',
  },
  no_bank_accounts: {
    subject: 'Add your bank accounts to Quova',
    title: 'Bank Accounts Missing',
    message: 'No bank accounts have been registered. Adding your bank accounts helps track settlement flows and counterparty exposure.',
    cta_url: '/bank-accounts',
  },
  no_counterparties: {
    subject: 'Add your counterparties in Quova',
    title: 'Counterparties Missing',
    message: 'No bank counterparties have been added. Counterparty information is needed for hedge booking and counterparty risk management.',
    cta_url: '/counterparties',
  },
  onboarding_stalled: {
    subject: 'Complete your Quova onboarding',
    title: 'Onboarding Incomplete',
    message: 'Your onboarding process hasn\'t been completed. Finishing onboarding unlocks the full platform including coverage analysis, hedge recommendations, and board reporting.',
    cta_url: '/onboarding',
  },
  coverage_below_policy: {
    subject: 'Coverage alert: below policy minimum',
    title: 'Coverage Below Policy',
    message: 'One or more currency pairs have hedge coverage below your policy minimum. Review your coverage and consider booking additional hedges to meet your risk management targets.',
    cta_url: '/exposure',
  },
  hedges_expiring_soon: {
    subject: 'Hedge positions expiring soon',
    title: 'Hedges Expiring Soon',
    message: 'You have hedge positions maturing within the next 14 days with no rolls booked. Review your maturing positions and decide whether to roll, close, or let them expire.',
    cta_url: '/trade',
  },
  no_recent_login: {
    subject: 'We miss you at Quova',
    title: 'Time to Check In',
    message: 'It\'s been a while since anyone from your team logged into Quova. Your FX risk position may have changed — log in to review your current coverage and any pending actions.',
    cta_url: '/dashboard',
  },
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const auth = await authenticateRequest(req)
  if (!auth.authenticated || !auth.user) {
    return jsonResponse({ error: auth.error ?? 'Unauthorized' }, 401)
  }

  // Must be active support user
  const admin = createAdminClient()
  const { data: supportUser } = await admin
    .from('support_users')
    .select('role')
    .eq('id', auth.user.id)
    .eq('is_active', true)
    .single()

  if (!supportUser) {
    return jsonResponse({ error: 'Forbidden: not an active support user' }, 403)
  }

  // Parse request
  let body: NudgeRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.org_id || !body.gaps || body.gaps.length === 0) {
    return jsonResponse({ error: 'org_id and gaps[] required' }, 400)
  }

  // Verify JIT access grant
  const { data: grant } = await admin
    .from('support_access_grants')
    .select('id')
    .eq('user_id', auth.user.id)
    .eq('org_id', body.org_id)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (!grant) {
    return jsonResponse({ error: 'Forbidden: no active JIT access grant for this org' }, 403)
  }

  // Get org info
  const { data: org } = await admin
    .from('organisations')
    .select('name')
    .eq('id', body.org_id)
    .single()

  if (!org) {
    return jsonResponse({ error: 'Organisation not found' }, 404)
  }

  // Get org admin emails for email nudges
  const { data: orgAdmins } = await admin
    .from('profiles')
    .select('id, email, role')
    .eq('org_id', body.org_id)
    .in('role', ['admin', 'editor'])

  const results: Array<{ gap_type: string; status: string; error?: string }> = []

  for (const gap of body.gaps) {
    const template = NUDGE_TEMPLATES[gap.type]
    if (!template) {
      results.push({ gap_type: gap.type, status: 'skipped', error: 'Unknown gap type' })
      continue
    }

    // Check 72h cooldown
    const { data: recentNudge } = await admin
      .from('nudges')
      .select('id')
      .eq('org_id', body.org_id)
      .eq('gap_type', gap.type)
      .gte('sent_at', new Date(Date.now() - 72 * 3600000).toISOString())
      .maybeSingle()

    if (recentNudge) {
      results.push({ gap_type: gap.type, status: 'skipped', error: 'Cooldown: nudged within 72h' })
      continue
    }

    const message = body.custom_message || template.message
    const channel = gap.channel
    let emailSent = false
    let inAppSent = false

    // Send email
    if (channel === 'email' || channel === 'both') {
      for (const profile of (orgAdmins ?? [])) {
        if (!profile.email) continue

        const tokenStr = await signUnsubscribeToken(
          { user_id: profile.id, pref: 'email_digest' },
          7 * 86400000,
        )
        const unsubscribeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/unsubscribe-email?token=${tokenStr}`

        const html = buildNudgeEmail(org.name, template.subject, message, APP_BASE_URL + template.cta_url, unsubscribeUrl)

        const result = await sendEmail({
          to: profile.email,
          subject: template.subject,
          html,
        })

        if (result.ok) {
          emailSent = true
          await admin.from('email_logs').insert({
            org_id: body.org_id,
            user_id: profile.id,
            email_type: 'nudge',
            recipient: profile.email,
            subject: template.subject,
            status: 'sent',
          })
        }
      }
    }

    // Create in-app notification
    if (channel === 'in_app' || channel === 'both') {
      const { error: notifErr } = await admin.from('customer_notifications').insert({
        org_id: body.org_id,
        gap_type: gap.type,
        title: template.title,
        message,
        cta_url: template.cta_url,
      })
      inAppSent = !notifErr
    }

    // Record nudge
    await admin.from('nudges').insert({
      org_id: body.org_id,
      gap_type: gap.type,
      channel,
      message,
      sent_by: auth.user.id,
    })

    results.push({
      gap_type: gap.type,
      status: (emailSent || inAppSent) ? 'sent' : 'failed',
      error: (!emailSent && !inAppSent) ? 'Both channels failed' : undefined,
    })
  }

  return jsonResponse({ results }, 200)
})

function buildNudgeEmail(
  orgName: string,
  title: string,
  message: string,
  ctaUrl: string,
  unsubscribeUrl: string,
): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Inter,system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#0b1526;padding:20px 24px;border-radius:12px 12px 0 0;">
      <span style="color:#00c8a0;font-size:20px;font-weight:700;">Quova</span>
    </div>
    <div style="background:#ffffff;padding:32px 24px;border:1px solid #e2e8f0;border-top:none;">
      <h2 style="margin:0 0 16px;color:#0f172a;font-size:18px;">${title}</h2>
      <p style="color:#475569;line-height:1.6;margin:0 0 24px;">${message}</p>
      <a href="${ctaUrl}" style="display:inline-block;background:#00c8a0;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Take Action</a>
    </div>
    <div style="padding:16px 24px;text-align:center;">
      <p style="color:#94a3b8;font-size:12px;margin:0;">
        Sent to ${orgName} by Quova |
        <a href="${unsubscribeUrl}" style="color:#94a3b8;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`
}
```

- [ ] **Step 2: Deploy the Edge Function**

```bash
supabase functions deploy send-nudge --no-verify-jwt
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-nudge/index.ts
git commit -m "feat: add send-nudge Edge Function with email + in-app channels and 72h cooldown"
```

---

## Task 5: orbit-support Types

**Files:**
- Modify: `orbit-support/src/types/index.ts`

- [ ] **Step 1: Add new type definitions**

Append to the end of `orbit-support/src/types/index.ts`:

```typescript
// ── Health Scoring ───────────────────────────────────────────

export type HealthStatus = 'healthy' | 'needs_attention' | 'at_risk'
export type GapSeverity = 'critical' | 'warning' | 'low'

export interface Gap {
  type: string
  severity: GapSeverity
  message: string
  metadata?: Record<string, unknown>
}

export interface DimensionScores {
  data_completeness: number
  data_freshness: number
  coverage_health: number
  onboarding_progress: number
  position_risk: number
}

export interface CustomerHealthScore {
  id: string
  org_id: string
  overall_score: number
  status: HealthStatus
  dimensions: DimensionScores
  gaps: Gap[]
  computed_at: string
}

// ── Nudges ───────────────────────────────────────────────────

export type NudgeChannel = 'email' | 'in_app' | 'both'

export interface Nudge {
  id: string
  org_id: string
  gap_type: string
  channel: NudgeChannel
  message: string | null
  sent_by: string
  sent_at: string
  acknowledged_at: string | null
}

// ── Customer Notifications ───────────────────────────────────

export interface CustomerNotification {
  id: string
  org_id: string
  gap_type: string
  title: string
  message: string
  cta_url: string | null
  created_at: string
  acknowledged_at: string | null
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/stevenlabella/Git/orbit-support
git add src/types/index.ts
git commit -m "feat: add health score, gap, nudge, and notification types"
```

---

## Task 6: useHealthScores Hook

**Files:**
- Create: `orbit-support/src/hooks/useHealthScores.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { CustomerHealthScore } from '../types'

export function useHealthScores() {
  const [scores, setScores] = useState<CustomerHealthScore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('customer_health_scores')
      .select('*')
      .order('overall_score', { ascending: true })

    if (err) {
      setError(err.message)
    } else {
      setScores(data ?? [])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { scores, loading, error, reload }
}

export function useOrgHealthScore(orgId: string | undefined) {
  const [score, setScore] = useState<CustomerHealthScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!orgId) return

    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('customer_health_scores')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle()

    if (err) {
      setError(err.message)
    } else {
      setScore(data)
    }

    setLoading(false)
  }, [orgId])

  useEffect(() => {
    reload()
  }, [reload])

  return { score, loading, error, reload }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useHealthScores.ts
git commit -m "feat: add useHealthScores and useOrgHealthScore hooks"
```

---

## Task 7: useNudges Hook

**Files:**
- Create: `orbit-support/src/hooks/useNudges.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Nudge } from '../types'

export function useNudges(orgId: string | undefined) {
  const [nudges, setNudges] = useState<Nudge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!orgId) return

    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('nudges')
      .select('*')
      .eq('org_id', orgId)
      .order('sent_at', { ascending: false })
      .limit(50)

    if (err) {
      setError(err.message)
    } else {
      setNudges(data ?? [])
    }

    setLoading(false)
  }, [orgId])

  useEffect(() => {
    reload()
  }, [reload])

  const sendNudge = useCallback(async (
    targetOrgId: string,
    gaps: Array<{ type: string; channel: 'email' | 'in_app' | 'both' }>,
    customMessage?: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    const { data, error: err } = await supabase.functions.invoke('send-nudge', {
      body: { org_id: targetOrgId, gaps, custom_message: customMessage },
    })

    if (err) {
      return { ok: false, error: err.message }
    }

    await reload()
    return { ok: true }
  }, [reload])

  return { nudges, loading, error, reload, sendNudge }
}

export function usePendingNudgeCount() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    async function fetch() {
      const { count: c } = await supabase
        .from('nudges')
        .select('id', { count: 'exact', head: true })
        .is('acknowledged_at', null)

      setCount(c ?? 0)
    }
    fetch()
  }, [])

  return count
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useNudges.ts
git commit -m "feat: add useNudges hook with sendNudge and pending count"
```

---

## Task 8: Shared UI Components (HealthScoreCircle, GapBadge)

**Files:**
- Create: `orbit-support/src/components/HealthScoreCircle.tsx`
- Create: `orbit-support/src/components/GapBadge.tsx`

- [ ] **Step 1: Create HealthScoreCircle**

```typescript
import type { HealthStatus } from '../types'

const STATUS_COLORS: Record<HealthStatus, string> = {
  healthy: 'var(--green)',
  needs_attention: 'var(--amber)',
  at_risk: 'var(--red)',
}

interface Props {
  score: number
  status: HealthStatus
  size?: number
}

export function HealthScoreCircle({ score, status, size = 48 }: Props) {
  const color = STATUS_COLORS[status]
  const fontSize = size * 0.35

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `3px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>
        {score}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Create GapBadge**

```typescript
import type { GapSeverity } from '../types'

const SEVERITY_CLASSES: Record<GapSeverity, string> = {
  critical: 'badge badge-red',
  warning: 'badge badge-amber',
  low: 'badge badge-gray',
}

interface Props {
  severity: GapSeverity
  label?: string
}

export function GapBadge({ severity, label }: Props) {
  return (
    <span className={SEVERITY_CLASSES[severity]}>
      {label ?? severity}
    </span>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/HealthScoreCircle.tsx src/components/GapBadge.tsx
git commit -m "feat: add HealthScoreCircle and GapBadge shared components"
```

---

## Task 9: CustomerHealthCard Component

**Files:**
- Create: `orbit-support/src/components/CustomerHealthCard.tsx`

- [ ] **Step 1: Create the component**

```typescript
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Eye, Send } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { HealthScoreCircle } from './HealthScoreCircle'
import { GapBadge } from './GapBadge'
import type { CustomerHealthScore, DimensionScores } from '../types'

interface Props {
  orgId: string
  orgName: string
  plan: string
  healthScore: CustomerHealthScore
  lastSignIn: string | null
  onNudge: (orgId: string) => void
}

const DIMENSION_LABELS: Record<keyof DimensionScores, string> = {
  data_completeness: 'Data',
  data_freshness: 'Freshness',
  coverage_health: 'Coverage',
  onboarding_progress: 'Onboarding',
  position_risk: 'Risk',
}

const PLAN_BADGE: Record<string, string> = {
  exposure: 'badge badge-gray',
  pro: 'badge badge-teal',
  enterprise: 'badge badge-purple',
}

export function CustomerHealthCard({ orgId, orgName, plan, healthScore, lastSignIn, onNudge }: Props) {
  const navigate = useNavigate()
  const topGap = healthScore.gaps[0]

  return (
    <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header: name + score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <HealthScoreCircle score={healthScore.overall_score} status={healthScore.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>{orgName}</span>
            <span className={PLAN_BADGE[plan] ?? 'badge badge-gray'}>{plan}</span>
          </div>
          {lastSignIn ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Last login {formatDistanceToNow(new Date(lastSignIn), { addSuffix: true })}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Never logged in</span>
          )}
        </div>
      </div>

      {/* Dimension bars */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(Object.keys(DIMENSION_LABELS) as Array<keyof DimensionScores>).map(dim => {
          const value = healthScore.dimensions[dim]
          const color = value >= 80 ? 'var(--green)' : value >= 50 ? 'var(--amber)' : 'var(--red)'
          return (
            <div key={dim} style={{ flex: 1 }} title={`${DIMENSION_LABELS[dim]}: ${value}`}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{DIMENSION_LABELS[dim]}</div>
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Top gap callout */}
      {topGap && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', fontSize: 13 }}>
          <AlertTriangle size={14} style={{ color: 'var(--amber)', flexShrink: 0 }} />
          <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{topGap.message}</span>
          <GapBadge severity={topGap.severity} />
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/tenants/${orgId}`)} style={{ flex: 1 }}>
          <Eye size={14} /> View Details
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => onNudge(orgId)} style={{ flex: 1 }} disabled={healthScore.gaps.length === 0}>
          <Send size={14} /> Send Nudge
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/CustomerHealthCard.tsx
git commit -m "feat: add CustomerHealthCard component for command center grid"
```

---

## Task 10: NudgeModal Component

**Files:**
- Create: `orbit-support/src/components/NudgeModal.tsx`

- [ ] **Step 1: Create the component**

```typescript
import { useState } from 'react'
import { X, Mail, Bell, Send } from 'lucide-react'
import { GapBadge } from './GapBadge'
import type { Gap, NudgeChannel } from '../types'

interface Props {
  orgId: string
  orgName: string
  gaps: Gap[]
  onSend: (orgId: string, gaps: Array<{ type: string; channel: NudgeChannel }>, customMessage?: string) => Promise<{ ok: boolean; error?: string }>
  onClose: () => void
}

const CHANNEL_OPTIONS: Array<{ value: NudgeChannel; label: string; icon: typeof Mail }> = [
  { value: 'both', label: 'Email + In-App', icon: Send },
  { value: 'email', label: 'Email Only', icon: Mail },
  { value: 'in_app', label: 'In-App Only', icon: Bell },
]

export function NudgeModal({ orgId, orgName, gaps, onSend, onClose }: Props) {
  const [selectedGaps, setSelectedGaps] = useState<Set<string>>(new Set(gaps.map(g => g.type)))
  const [channel, setChannel] = useState<NudgeChannel>('both')
  const [customMessage, setCustomMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null)

  const toggleGap = (type: string) => {
    setSelectedGaps(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const handleSend = async () => {
    setSending(true)
    const gapsToSend = gaps.filter(g => selectedGaps.has(g.type)).map(g => ({ type: g.type, channel }))
    const res = await onSend(orgId, gapsToSend, customMessage || undefined)
    setResult(res)
    setSending(false)
  }

  if (result?.ok) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
        <div className="card" style={{ width: 480, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#10003;</div>
          <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>Nudge Sent</h3>
          <p style={{ color: 'var(--text-secondary)', margin: '0 0 24px' }}>
            {selectedGaps.size} nudge(s) sent to {orgName} via {channel.replace('_', '-')}.
          </p>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="card" style={{ width: 540, maxHeight: '80vh', overflow: 'auto', padding: 0 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>Send Nudge to {orgName}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: 4 }}><X size={16} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Gap selection */}
          <div>
            <label className="label">Select gaps to nudge</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {gaps.map(gap => (
                <label key={gap.type} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: selectedGaps.has(gap.type) ? 'var(--teal-dim)' : 'var(--bg-surface)', borderRadius: 'var(--r-md)', cursor: 'pointer', border: `1px solid ${selectedGaps.has(gap.type) ? 'var(--teal)' : 'var(--border)'}` }}>
                  <input type="checkbox" checked={selectedGaps.has(gap.type)} onChange={() => toggleGap(gap.type)} />
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{gap.message}</span>
                  <GapBadge severity={gap.severity} />
                </label>
              ))}
            </div>
          </div>

          {/* Channel selection */}
          <div>
            <label className="label">Delivery channel</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {CHANNEL_OPTIONS.map(opt => (
                <button key={opt.value} className={`btn btn-sm ${channel === opt.value ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setChannel(opt.value)} style={{ flex: 1 }}>
                  <opt.icon size={14} /> {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom message */}
          <div>
            <label className="label">Custom message (optional — overrides default template text)</label>
            <textarea className="input" rows={3} value={customMessage} onChange={e => setCustomMessage(e.target.value)} placeholder="Leave blank to use the default template for each gap type..." style={{ marginTop: 8, resize: 'vertical' }} />
          </div>

          {/* Error */}
          {result?.error && (
            <div className="error-banner">{result.error}</div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSend} disabled={sending || selectedGaps.size === 0}>
              {sending ? 'Sending...' : `Send ${selectedGaps.size} Nudge(s)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/NudgeModal.tsx
git commit -m "feat: add NudgeModal component for gap selection and nudge dispatch"
```

---

## Task 11: Command Center Page

**Files:**
- Create: `orbit-support/src/pages/CommandCenterPage.tsx`

- [ ] **Step 1: Create the page**

```typescript
import { useState, useMemo } from 'react'
import { ShieldAlert, AlertTriangle, CheckCircle, Bell, Search, RefreshCw } from 'lucide-react'
import { useHealthScores } from '../hooks/useHealthScores'
import { useTenantsData } from '../hooks/useTenantsData'
import { usePendingNudgeCount } from '../hooks/useNudges'
import { useNudges } from '../hooks/useNudges'
import { CustomerHealthCard } from '../components/CustomerHealthCard'
import { NudgeModal } from '../components/NudgeModal'
import type { HealthStatus, CustomerHealthScore } from '../types'

type SortKey = 'score' | 'activity' | 'plan'
type FilterStatus = 'all' | HealthStatus

export default function CommandCenterPage() {
  const { scores, loading: scoresLoading, reload: reloadScores } = useHealthScores()
  const { tenants, loading: tenantsLoading } = useTenantsData()
  const pendingNudges = usePendingNudgeCount()
  const { sendNudge } = useNudges(undefined)

  const [filter, setFilter] = useState<FilterStatus>('all')
  const [sort, setSort] = useState<SortKey>('score')
  const [search, setSearch] = useState('')
  const [nudgeOrgId, setNudgeOrgId] = useState<string | null>(null)

  // Build a map of org_id → tenant info
  const tenantMap = useMemo(() => {
    const map = new Map<string, { name: string; plan: string; lastSignIn: string | null }>()
    for (const t of tenants) {
      map.set(t.id, { name: t.name, plan: t.plan, lastSignIn: null })
    }
    return map
  }, [tenants])

  // Filter and sort
  const filteredScores = useMemo(() => {
    let result = scores.filter(s => {
      const tenant = tenantMap.get(s.org_id)
      if (!tenant) return false
      if (filter !== 'all' && s.status !== filter) return false
      if (search && !tenant.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })

    result.sort((a, b) => {
      if (sort === 'score') return a.overall_score - b.overall_score
      if (sort === 'plan') {
        const planOrder: Record<string, number> = { enterprise: 0, pro: 1, exposure: 2 }
        const pa = planOrder[tenantMap.get(a.org_id)?.plan ?? ''] ?? 3
        const pb = planOrder[tenantMap.get(b.org_id)?.plan ?? ''] ?? 3
        return pa - pb
      }
      return 0
    })

    return result
  }, [scores, tenantMap, filter, sort, search])

  // Counts
  const atRisk = scores.filter(s => s.status === 'at_risk').length
  const needsAttention = scores.filter(s => s.status === 'needs_attention').length
  const healthy = scores.filter(s => s.status === 'healthy').length

  const loading = scoresLoading || tenantsLoading

  // Nudge modal
  const nudgeScore = nudgeOrgId ? scores.find(s => s.org_id === nudgeOrgId) : null
  const nudgeOrg = nudgeOrgId ? tenantMap.get(nudgeOrgId) : null

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Command Center</h1>
        <button className="btn btn-ghost btn-sm" onClick={reloadScores} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> Refresh
        </button>
      </div>

      <div className="page-content">
        {/* KPI Tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <div className="card" style={{ padding: 16, textAlign: 'center' }}>
            <ShieldAlert size={20} style={{ color: 'var(--red)', marginBottom: 8 }} />
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>{atRisk}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>At Risk</div>
          </div>
          <div className="card" style={{ padding: 16, textAlign: 'center' }}>
            <AlertTriangle size={20} style={{ color: 'var(--amber)', marginBottom: 8 }} />
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>{needsAttention}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Needs Attention</div>
          </div>
          <div className="card" style={{ padding: 16, textAlign: 'center' }}>
            <CheckCircle size={20} style={{ color: 'var(--green)', marginBottom: 8 }} />
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{healthy}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Healthy</div>
          </div>
          <div className="card" style={{ padding: 16, textAlign: 'center' }}>
            <Bell size={20} style={{ color: 'var(--blue)', marginBottom: 8 }} />
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--blue)', fontFamily: 'var(--font-mono)' }}>{pendingNudges}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pending Nudges</div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="input" placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'at_risk', 'needs_attention', 'healthy'] as FilterStatus[]).map(s => (
              <button key={s} className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(s)}>
                {s === 'all' ? 'All' : s === 'at_risk' ? 'At Risk' : s === 'needs_attention' ? 'Attention' : 'Healthy'}
              </button>
            ))}
          </div>
          <select className="input" value={sort} onChange={e => setSort(e.target.value as SortKey)} style={{ width: 'auto' }}>
            <option value="score">Sort: Health Score</option>
            <option value="plan">Sort: Plan Tier</option>
          </select>
        </div>

        {/* Health Grid */}
        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : filteredScores.length === 0 ? (
          <div className="empty-state">
            <CheckCircle size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
            <p style={{ color: 'var(--text-muted)' }}>
              {scores.length === 0 ? 'No health scores computed yet. Run the health check first.' : 'No customers match your filters.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
            {filteredScores.map(s => {
              const tenant = tenantMap.get(s.org_id)
              if (!tenant) return null
              return (
                <CustomerHealthCard
                  key={s.org_id}
                  orgId={s.org_id}
                  orgName={tenant.name}
                  plan={tenant.plan}
                  healthScore={s}
                  lastSignIn={tenant.lastSignIn}
                  onNudge={setNudgeOrgId}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Nudge Modal */}
      {nudgeOrgId && nudgeScore && nudgeOrg && (
        <NudgeModal
          orgId={nudgeOrgId}
          orgName={nudgeOrg.name}
          gaps={nudgeScore.gaps}
          onSend={sendNudge}
          onClose={() => { setNudgeOrgId(null); reloadScores() }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/CommandCenterPage.tsx
git commit -m "feat: add CommandCenterPage with KPI tiles, health grid, and nudge integration"
```

---

## Task 12: Combined Audit Page

**Files:**
- Create: `orbit-support/src/pages/AuditPage.tsx`

- [ ] **Step 1: Create the combined audit page**

This combines the existing SupportAuditPage and CustomerAuditPage into one page with sub-tabs. Copy the existing rendering logic from both pages into tab sections.

```typescript
import { useState } from 'react'
import { Shield, Users } from 'lucide-react'

// Re-use the existing page components as tab content
// Import the inner content from each existing page
import SupportAuditContent from './SupportAuditPage'
import CustomerAuditContent from './CustomerAuditPage'

type AuditTab = 'support' | 'customer'

export default function AuditPage() {
  const [tab, setTab] = useState<AuditTab>('support')

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Audit</h1>
      </div>

      <div className="page-content">
        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 2 }}>
          <button className={`tab ${tab === 'support' ? 'active' : ''}`} onClick={() => setTab('support')}>
            <Shield size={14} /> Support Activity
          </button>
          <button className={`tab ${tab === 'customer' ? 'active' : ''}`} onClick={() => setTab('customer')}>
            <Users size={14} /> Customer Activity
          </button>
        </div>

        {tab === 'support' && <SupportAuditContent />}
        {tab === 'customer' && <CustomerAuditContent />}
      </div>
    </div>
  )
}
```

**Note:** This requires a small refactor of `SupportAuditPage.tsx` and `CustomerAuditPage.tsx` — their existing content needs to be extractable as components (remove the outer `page-header` and `page-content` wrappers and export the inner content). The simplest approach: keep both files as-is but also export a version without the outer wrappers. Alternatively, strip the wrappers and let `AuditPage` be the only entry point.

Preferred approach — modify both existing pages to export their content without wrappers:

In `SupportAuditPage.tsx`, change the default export to remove `page-header` and `page-content` divs (just return the search bar + table). Same for `CustomerAuditPage.tsx`.

- [ ] **Step 2: Refactor SupportAuditPage to be embeddable**

In `orbit-support/src/pages/SupportAuditPage.tsx`, remove the outer `<div className="fade-in">`, `<div className="page-header">`, and `<div className="page-content">` wrappers. The component should return just the search + table content directly in a fragment or plain div.

- [ ] **Step 3: Refactor CustomerAuditPage to be embeddable**

Same treatment for `orbit-support/src/pages/CustomerAuditPage.tsx` — remove outer page wrappers.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AuditPage.tsx src/pages/SupportAuditPage.tsx src/pages/CustomerAuditPage.tsx
git commit -m "feat: add combined AuditPage with support + customer sub-tabs"
```

---

## Task 13: Redesigned TenantDetailPage

**Files:**
- Modify: `orbit-support/src/pages/TenantDetailPage.tsx`

- [ ] **Step 1: Update tab type and add Health + Data + Activity tabs**

Replace the existing `Tab` type and tab rendering. The new tab structure is:

```typescript
type Tab = 'health' | 'overview' | 'users' | 'data' | 'activity' | 'corrections'
```

Default tab changes from `'overview'` to `'health'`.

Add imports:
```typescript
import { useOrgHealthScore } from '../hooks/useHealthScores'
import { useNudges } from '../hooks/useNudges'
import { HealthScoreCircle } from '../components/HealthScoreCircle'
import { GapBadge } from '../components/GapBadge'
import { NudgeModal } from '../components/NudgeModal'
```

- [ ] **Step 2: Add Health tab content**

The Health tab renders:
- Health score circle (large, centered) with status label
- 5 dimension score bars with labels and values
- Gaps list: each gap as a row with severity badge, message, and "Send Nudge" button
- Gap history: last 10 nudges sent to this org with status (pending/acknowledged)

```typescript
// Inside the Health tab render:
const { score: healthScore, loading: healthLoading } = useOrgHealthScore(orgId)
const { nudges, sendNudge } = useNudges(orgId)

// Render health score breakdown, gaps list with nudge buttons, nudge history
```

- [ ] **Step 3: Add Data tab content**

The Data tab shows a summary of what data exists for this org — read-only, no JIT access needed. Uses the existing `useTenantDetail` data plus additional counts:

- Exposure count by currency pair (query `fx_exposures` grouped by `currency_pair`)
- Hedge count by status (active/rolled/closed)
- Policy summary (active policy min/max coverage, base currency)
- Entity list (name, functional currency, jurisdiction)
- Bank account count
- Counterparty count
- ERP connection status (moved from old Integrations tab)

This requires adding a new hook or extending `useTenantDetail` to fetch these counts. The simplest approach: add a `useOrgDataSummary(orgId)` hook that queries these counts using the support user's existing read access.

- [ ] **Step 4: Add Activity tab content**

The Activity tab merges:
- Customer audit log (existing, from `useTenantDetail.auditLogs`)
- Nudge history (from `useNudges(orgId)`)

Render as a single chronological feed, each entry tagged with its source (audit/nudge).

- [ ] **Step 5: Remove Integrations tab**

ERP connection data moves into the Data tab. Remove the old Integrations tab option.

- [ ] **Step 6: Update tab bar**

```typescript
const TABS: Array<{ key: Tab; label: string; icon: typeof Heart }> = [
  { key: 'health', label: 'Health', icon: Heart },
  { key: 'overview', label: 'Overview', icon: Building },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'data', label: 'Data', icon: Database },
  { key: 'activity', label: 'Activity', icon: Clock },
  { key: 'corrections', label: 'Corrections', icon: Settings },
]
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/TenantDetailPage.tsx
git commit -m "feat: redesign TenantDetailPage with Health, Data, Activity tabs"
```

---

## Task 14: Update TenantsPage with Health Badges

**Files:**
- Modify: `orbit-support/src/pages/TenantsPage.tsx`

- [ ] **Step 1: Add health score badge to tenant rows**

Import `useHealthScores` and `HealthScoreCircle`. Build a map of `org_id → healthScore`. In each tenant row, add a small `HealthScoreCircle` (size 32) and the top gap message.

```typescript
import { useHealthScores } from '../hooks/useHealthScores'
import { HealthScoreCircle } from '../components/HealthScoreCircle'

// Inside component:
const { scores } = useHealthScores()
const scoreMap = useMemo(() => {
  const map = new Map<string, CustomerHealthScore>()
  for (const s of scores) map.set(s.org_id, s)
  return map
}, [scores])

// In table row:
const score = scoreMap.get(tenant.id)
// Render HealthScoreCircle + top gap message in a new column
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/TenantsPage.tsx
git commit -m "feat: add health score badges to tenant list"
```

---

## Task 15: Update Navigation & Routing

**Files:**
- Modify: `orbit-support/src/App.tsx`
- Modify: `orbit-support/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Update App.tsx routes**

Replace `/dashboard` → `CommandCenterPage`. Replace `/audit-log` and `/customer-audit` with single `/audit` → `AuditPage`.

```typescript
import CommandCenterPage from './pages/CommandCenterPage'
import AuditPage from './pages/AuditPage'

// In routes:
// Replace: <Route path="dashboard" element={<DashboardPage />} />
// With:    <Route path="dashboard" element={<CommandCenterPage />} />

// Replace: <Route path="audit-log" element={<SupportAuditPage />} />
//          <Route path="customer-audit" element={<CustomerAuditPage />} />
// With:    <Route path="audit" element={<AuditPage />} />
```

Keep old routes as redirects for bookmarks:
```typescript
import { Navigate } from 'react-router-dom'
<Route path="audit-log" element={<Navigate to="/audit" replace />} />
<Route path="customer-audit" element={<Navigate to="/audit" replace />} />
```

- [ ] **Step 2: Update AppLayout.tsx sidebar**

Change nav items:
```typescript
const NAV_ITEMS = [
  { to: '/dashboard', label: 'Command Center', icon: LayoutDashboard },
  { to: '/tenants', label: 'Customers', icon: Building },
  { to: '/audit', label: 'Audit', icon: FileText },
]
```

Remove "Customer Audit Search" and "Support Audit Log" as separate items.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/components/layout/AppLayout.tsx
git commit -m "feat: update routing and sidebar for command center navigation"
```

---

## Task 16: Customer Notification Banner (orbit-mvp)

**Files:**
- Create: `orbit-mvp/src/hooks/useCustomerNotifications.ts`
- Create: `orbit-mvp/src/components/ui/CustomerNotificationBanner.tsx`
- Modify: `orbit-mvp/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Create useCustomerNotifications hook**

```typescript
import { useEffect, useState, useCallback } from 'react'
import { useAuth } from './useAuth'

interface CustomerNotification {
  id: string
  org_id: string
  gap_type: string
  title: string
  message: string
  cta_url: string | null
  created_at: string
  acknowledged_at: string | null
}

export function useCustomerNotifications() {
  const { user, db } = useAuth()
  const orgId = user?.profile?.org_id
  const [notifications, setNotifications] = useState<CustomerNotification[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!orgId || !db) return

    const { data } = await db
      .from('customer_notifications')
      .select('*')
      .eq('org_id', orgId)
      .is('acknowledged_at', null)
      .order('created_at', { ascending: false })
      .limit(5)

    setNotifications(data ?? [])
    setLoading(false)
  }, [orgId, db])

  useEffect(() => {
    reload()
  }, [reload])

  const dismiss = useCallback(async (id: string) => {
    if (!db) return
    await db
      .from('customer_notifications')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', id)

    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [db])

  return { notifications, loading, dismiss, reload }
}
```

- [ ] **Step 2: Create CustomerNotificationBanner component**

```typescript
import { useNavigate } from 'react-router-dom'
import { X, ArrowRight } from 'lucide-react'
import { useCustomerNotifications } from '../../hooks/useCustomerNotifications'

export function CustomerNotificationBanner() {
  const { notifications, dismiss } = useCustomerNotifications()
  const navigate = useNavigate()

  if (notifications.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
      {notifications.map(n => (
        <div
          key={n.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            background: 'var(--teal-dim)',
            border: '1px solid var(--teal)',
            borderRadius: 'var(--r-md)',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 2 }}>{n.title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{n.message}</div>
          </div>
          {n.cta_url && (
            <button className="btn btn-primary btn-sm" onClick={() => navigate(n.cta_url!)}>
              Take Action <ArrowRight size={12} />
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => dismiss(n.id)}
            style={{ padding: 4 }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Add banner to DashboardPage**

In `orbit-mvp/src/pages/DashboardPage.tsx`, import and render `CustomerNotificationBanner` at the top of the page content (above the KPI tiles):

```typescript
import { CustomerNotificationBanner } from '../components/ui/CustomerNotificationBanner'

// At the top of the page-content div:
<CustomerNotificationBanner />
```

- [ ] **Step 4: Commit**

```bash
cd /Users/stevenlabella/Git/orbit-mvp
git add src/hooks/useCustomerNotifications.ts src/components/ui/CustomerNotificationBanner.tsx src/pages/DashboardPage.tsx
git commit -m "feat: add customer notification banner on dashboard for support nudges"
```

---

## Task 17: Delete Old DashboardPage

**Files:**
- Delete: `orbit-support/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Remove the old dashboard**

The old `DashboardPage.tsx` is fully replaced by `CommandCenterPage.tsx`. Delete it and verify no imports reference it.

```bash
cd /Users/stevenlabella/Git/orbit-support
rm src/pages/DashboardPage.tsx
```

Verify no remaining imports:
```bash
grep -r "DashboardPage" src/
```

Expected: no results (App.tsx should already reference CommandCenterPage from Task 15).

- [ ] **Step 2: Commit**

```bash
git add -u src/pages/DashboardPage.tsx
git commit -m "chore: remove old DashboardPage replaced by CommandCenterPage"
```

---

## Task 18: End-to-End Verification

- [ ] **Step 1: Run orbit-support dev server**

```bash
cd /Users/stevenlabella/Git/orbit-support
npm run dev
```

Verify: no build errors, app loads at `http://localhost:5177`.

- [ ] **Step 2: Verify Command Center**

1. Navigate to `/dashboard` (Command Center)
2. Verify 4 KPI tiles render (may show 0 if health scores haven't been computed)
3. Trigger a manual health score computation:
   ```bash
   curl -X POST "https://vmtwojalyzvmdpldgabi.supabase.co/functions/v1/compute-health-scores" \
     -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
     -H "Content-Type: application/json"
   ```
4. Refresh — customer health cards should appear
5. Verify filter buttons (All/At Risk/Attention/Healthy) work
6. Verify search filters by org name

- [ ] **Step 3: Verify Tenant Detail Health Tab**

1. Click "View Details" on a health card
2. Verify Health tab is the default
3. Verify health score circle, dimension bars, and gaps list render
4. Verify Data tab shows exposure/hedge/entity counts
5. Verify Activity tab shows audit + nudge history

- [ ] **Step 4: Verify Nudge Flow**

1. From Command Center, click "Send Nudge" on a customer card
2. Verify NudgeModal opens with gaps pre-selected
3. Select channel and send
4. Verify nudge appears in tenant detail Activity tab

- [ ] **Step 5: Verify orbit-mvp notification banner**

```bash
cd /Users/stevenlabella/Git/orbit-mvp
npm run dev
```

1. Log in as a customer user
2. Navigate to Dashboard
3. Verify notification banner appears (if a nudge was sent with in-app channel)
4. Verify dismiss (X) button removes the banner
5. Verify CTA button navigates to correct page

- [ ] **Step 6: Verify Audit Page**

1. Navigate to `/audit`
2. Verify Support Activity sub-tab shows support staff logs
3. Verify Customer Activity sub-tab shows cross-org search

- [ ] **Step 7: Verify sidebar navigation**

1. Command Center, Customers, Audit visible in sidebar
2. Old audit routes (`/audit-log`, `/customer-audit`) redirect to `/audit`
