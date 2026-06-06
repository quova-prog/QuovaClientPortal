# WorkOS Phase 1 Additive Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WorkOS identity columns, additive WorkOS-aware database helpers, and service-role audit actor groundwork without flipping existing RLS policies.

**Architecture:** Phase 1 is database-first and non-cutover. It adds nullable WorkOS bridge columns and new WorkOS-specific helper functions beside the current Supabase Auth helpers, so existing policies continue to use `current_user_org_id()` until the later re-key phase. Audit groundwork is backward-compatible: browser inserts still resolve from `auth.uid()`, while service-role functions can supply a trusted actor context for future WorkOS Edge Functions.

**Tech Stack:** Supabase Postgres SQL, static Node security regression tests, SQL editor deployment.

---

### Task 1: Add A Static Regression Test For Phase 1 SQL

**Files:**
- Create: `tests/security/workos-phase1-additive-regression.test.mjs`
- Create later: `docs/workos/phase1-additive-schema.sql`

- [x] **Step 1: Write the failing test**

Create `tests/security/workos-phase1-additive-regression.test.mjs` with tests that read `docs/workos/phase1-additive-schema.sql` and assert:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const sqlPath = path.join(process.cwd(), 'docs/workos/phase1-additive-schema.sql')

function sql() {
  return readFileSync(sqlPath, 'utf8')
}

test('phase1 sql adds WorkOS bridge columns without forcing cutover', () => {
  const content = sql()
  assert.match(content, /ALTER TABLE public\.organisations\s+ADD COLUMN IF NOT EXISTS workos_org_id TEXT;/s)
  assert.match(content, /ALTER TABLE public\.profiles\s+ADD COLUMN IF NOT EXISTS workos_user_id TEXT;/s)
  assert.match(content, /ALTER TABLE public\.profiles\s+ADD COLUMN IF NOT EXISTS membership_status TEXT NOT NULL DEFAULT 'active';/s)
  assert.match(content, /ALTER TABLE public\.profiles\s+ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;/s)
  assert.match(content, /ALTER TABLE public\.support_users\s+ADD COLUMN IF NOT EXISTS workos_user_id TEXT;/s)
  assert.match(content, /CREATE UNIQUE INDEX IF NOT EXISTS idx_organisations_workos_org_id_unique/s)
  assert.match(content, /CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_workos_user_org_unique\s+ON public\.profiles\(workos_user_id, org_id\)/s)
  assert.doesNotMatch(content, /CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_workos_user_id_unique\s+ON public\.profiles\(workos_user_id\)/s)
  assert.doesNotMatch(content, /CREATE OR REPLACE FUNCTION current_user_org_id\(\)/s)
  assert.doesNotMatch(content, /DROP POLICY/s)
})

test('phase1 sql adds customer WorkOS helpers bound to both sub and org_id', () => {
  const content = sql()
  for (const fn of ['current_workos_profile_id', 'current_workos_org_id', 'current_workos_user_role']) {
    assert.match(content, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)`, 's'))
  }
  assert.match(content, /p\.workos_user_id = auth\.jwt\(\)->>'sub'/s)
  assert.match(content, /o\.workos_org_id = auth\.jwt\(\)->>'org_id'/s)
  assert.match(content, /p\.membership_status = 'active'/s)
  assert.match(content, /p\.deactivated_at IS NULL/s)
})

test('phase1 sql keeps support identity separate from customer org matching', () => {
  const content = sql()
  assert.match(content, /CREATE OR REPLACE FUNCTION public\.current_workos_support_user_id\(\)/s)
  assert.match(content, /su\.workos_user_id = auth\.jwt\(\)->>'sub'/s)
  assert.match(content, /su\.is_active = TRUE/s)
  assert.match(content, /auth\.jwt\(\)->>'org_id' = NULLIF\(current_setting\('app\.workos_internal_org_id', TRUE\), ''\)/s)
  assert.doesNotMatch(content, /support_users[\s\S]*organisations[\s\S]*workos_org_id/s)
})

test('phase1 sql adds trusted audit actor groundwork for service-role writes', () => {
  const content = sql()
  assert.match(content, /ALTER TABLE public\.audit_logs\s+ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user';/s)
  assert.match(content, /ALTER TABLE public\.audit_logs\s+ADD COLUMN IF NOT EXISTS external_actor_id TEXT;/s)
  assert.match(content, /CREATE OR REPLACE FUNCTION public\.write_audit_log_as_actor\(/s)
  assert.match(content, /GRANT EXECUTE ON FUNCTION public\.write_audit_log_as_actor\(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB\) TO service_role;/s)
  assert.match(content, /NULLIF\(current_setting\('app\.audit_actor_profile_id', TRUE\), ''\)/s)
  assert.match(content, /COALESCE\(NEW\.actor_type, 'user'\) IN \('system', 'workos_webhook'\)/s)
  assert.match(content, /NEW\.actor_type := 'user';/s)
  assert.match(content, /NEW\.external_actor_id := NULL;/s)
})
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/security/workos-phase1-additive-regression.test.mjs
```

Expected: fail with `ENOENT` for `docs/workos/phase1-additive-schema.sql`.

### Task 2: Add The Additive Phase 1 SQL Artifact

**Files:**
- Create: `docs/workos/phase1-additive-schema.sql`
- Test: `tests/security/workos-phase1-additive-regression.test.mjs`

- [x] **Step 1: Create the SQL artifact**

Create `docs/workos/phase1-additive-schema.sql` with idempotent SQL that:

```sql
BEGIN;

ALTER TABLE public.organisations ADD COLUMN IF NOT EXISTS workos_org_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS workos_user_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS membership_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE public.support_users ADD COLUMN IF NOT EXISTS workos_user_id TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user';
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS external_actor_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organisations_workos_org_id_unique
  ON public.organisations(workos_org_id)
  WHERE workos_org_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_workos_user_org_unique
  ON public.profiles(workos_user_id, org_id)
  WHERE workos_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_users_workos_user_id_unique
  ON public.support_users(workos_user_id)
  WHERE workos_user_id IS NOT NULL;
```

Then add guarded `DO $$` blocks for check constraints, WorkOS customer helper functions named `current_workos_profile_id()`, `current_workos_org_id()`, and `current_workos_user_role()`, a separate `current_workos_support_user_id()` helper keyed to `app.workos_internal_org_id`, a backward-compatible `enforce_audit_log_fields()` replacement, and `write_audit_log_as_actor(...)` granted only to `service_role`.

- [x] **Step 2: Run the focused regression test**

Run:

```bash
node --test tests/security/workos-phase1-additive-regression.test.mjs
```

Expected: pass.

- [x] **Step 3: Run the full security regression suite**

Run:

```bash
npm run test:security
```

Expected: pass.

### Task 3: Commit The Phase 1 Planning And SQL Slice

**Files:**
- `docs/superpowers/plans/2026-06-06-workos-phase1-additive-db.md`
- `docs/workos/phase1-additive-schema.sql`
- `tests/security/workos-phase1-additive-regression.test.mjs`

- [x] **Step 1: Confirm no secrets are present**

Run a secret scan against the three Phase 1 files before staging. Confirm the diff contains no WorkOS API keys, Supabase service-role keys, or copied JWT/access-token values.

- [ ] **Step 2: Stage only Phase 1 files**

Run:

```bash
git add docs/superpowers/plans/2026-06-06-workos-phase1-additive-db.md docs/workos/phase1-additive-schema.sql tests/security/workos-phase1-additive-regression.test.mjs
```

- [ ] **Step 3: Commit**

Run:

```bash
git commit -m "chore(workos): add phase1 additive db plan"
```
