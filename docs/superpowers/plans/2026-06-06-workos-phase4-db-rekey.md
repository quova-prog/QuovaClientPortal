# WorkOS Phase 4 DB Re-key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the database authorization layer from Supabase Auth UUIDs over to WorkOS JWT claims mapped onto local `profiles.id` and `support_users.id` actors.

**Architecture:** Keep the canonical application helpers (`current_user_org_id()`, `current_user_role()`) as the main RLS contract, but redefine them to resolve active local profiles from `auth.jwt()->>'sub'` plus selected WorkOS `org_id`. Remove identity foreign keys to `auth.users`, reattach user-owned tables to `profiles` or `support_users`, and replace the direct user-ID policies/RPCs that would fail under WorkOS.

**Tech Stack:** Supabase Postgres, Postgres RLS, WorkOS JWT claims, Node security regression tests.

---

### Task 1: Add Phase 4 Static Regression Coverage

**Files:**
- Create: `tests/security/workos-phase4-db-rekey-regression.test.mjs`
- Read: `docs/workos/phase4-db-rekey-cutover.sql`

- [x] **Step 1: Write the failing test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const sqlPath = path.join(process.cwd(), 'docs/workos/phase4-db-rekey-cutover.sql')

function sql() {
  return readFileSync(sqlPath, 'utf8')
}

test('phase4 sql rekeys canonical customer helpers to WorkOS sub plus selected org_id', () => {
  const content = sql()
  assert.match(content, /CREATE OR REPLACE FUNCTION public\.current_profile_id\(\)/s)
  assert.match(content, /p\.workos_user_id = auth\.jwt\(\)->>'sub'/s)
  assert.match(content, /o\.workos_org_id = auth\.jwt\(\)->>'org_id'/s)
})
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/security/workos-phase4-db-rekey-regression.test.mjs
```

Expected: FAIL with `ENOENT` for `docs/workos/phase4-db-rekey-cutover.sql`.

- [x] **Step 3: Expand the regression assertions**

Cover these conditions in the same test file:
- Local actor FKs no longer depend on `auth.users`.
- `profiles.id` and `support_users.id` have UUID defaults.
- `notification_preferences.user_id` points to `profiles(id)`.
- `support_access_grants.user_id` points to `support_users(id)`.
- `current_profile_id()`, `current_user_org_id()`, and `current_user_role()` resolve from WorkOS `sub` and selected `org_id`.
- Support helpers use `current_workos_support_user_id()` and JIT grants, not customer org claim matching.
- Profile and notification preference policies use `current_profile_id()`.
- Customer RPCs use local profile IDs instead of Supabase Auth UUIDs.

### Task 2: Create SQL Editor Cutover Artifact

**Files:**
- Create: `docs/workos/phase4-db-rekey-cutover.sql`

- [x] **Step 1: Add actor table re-key DDL**

```sql
ALTER TABLE IF EXISTS public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE IF EXISTS public.support_users
  DROP CONSTRAINT IF EXISTS support_users_id_fkey;
ALTER TABLE IF EXISTS public.profiles
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE IF EXISTS public.support_users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
```

- [x] **Step 2: Reattach user-owned tables**

```sql
ALTER TABLE IF EXISTS public.notification_preferences
  ADD CONSTRAINT notification_preferences_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
  NOT VALID;

ALTER TABLE IF EXISTS public.support_access_grants
  ADD CONSTRAINT support_access_grants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.support_users(id) ON DELETE CASCADE
  NOT VALID;
```

- [x] **Step 3: Replace canonical customer helpers**

```sql
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT p.org_id
    FROM public.profiles p
    JOIN public.organisations o ON o.id = p.org_id
   WHERE p.workos_user_id = auth.jwt()->>'sub'
     AND o.workos_org_id = auth.jwt()->>'org_id'
     AND p.membership_status = 'active'
     AND p.deactivated_at IS NULL
   LIMIT 1
$$;
```

- [x] **Step 4: Replace direct profile/preference policies**

```sql
CREATE POLICY "notif_prefs_update" ON public.notification_preferences
  FOR UPDATE
  TO authenticated
  USING (
    user_id = public.current_profile_id()
    AND org_id = public.current_user_org_id()
  )
  WITH CHECK (
    user_id = public.current_profile_id()
    AND org_id = public.current_user_org_id()
  );
```

- [x] **Step 5: Replace customer RPC actor binding**

```sql
CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_action TEXT,
  p_resource TEXT,
  p_resource_id TEXT DEFAULT NULL,
  p_summary TEXT DEFAULT '',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_profile_id UUID := public.current_profile_id();
  v_org_id UUID := public.current_user_org_id();
BEGIN
  IF v_profile_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'audit_logs: authenticated user required';
  END IF;
END;
$$;
```

### Task 3: Verify and Ship

**Files:**
- Test: `tests/security/workos-phase4-db-rekey-regression.test.mjs`
- Test: existing security suite

- [x] **Step 1: Run focused regression**

Run:

```bash
node --test tests/security/workos-phase4-db-rekey-regression.test.mjs
```

Expected: PASS.

- [x] **Step 2: Run full security suite**

Run:

```bash
npm run test:security
```

Expected: PASS. Existing security tests may still intentionally cover the pre-cutover Supabase Auth migrations; do not rewrite those historical tests unless the test is explicitly about the Phase 4 artifact.

- [x] **Step 3: Run regular unit tests and build**

Run:

```bash
npm run test
npm run build
```

Expected: PASS. The build may emit existing Vite chunk-size warnings.

- [ ] **Step 4: Commit and push**

Run:

```bash
git add docs/workos/phase4-db-rekey-cutover.sql docs/superpowers/plans/2026-06-06-workos-phase4-db-rekey.md tests/security/workos-phase4-db-rekey-regression.test.mjs
git commit -m "chore(workos): add db rekey cutover artifact"
git push
```
