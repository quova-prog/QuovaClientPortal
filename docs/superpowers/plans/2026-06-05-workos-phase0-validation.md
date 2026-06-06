# WorkOS Phase 0 Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove WorkOS AuthKit token shape, organization context, Supabase Third-Party Auth, RLS behavior, and identity callsite inventory before any auth cutover work begins.

**Architecture:** This phase is a staging spike. It adds validation scripts and a disposable RLS probe table, then uses a real WorkOS staging token to prove normal customer sessions carry `org_id` and Supabase RLS accepts only matching `sub` + `org_id`. No production auth flows are replaced in this phase.

**Tech Stack:** WorkOS AuthKit dashboard, Supabase Third-Party Auth, Supabase SQL editor, Node.js scripts, `@supabase/supabase-js`, Git.

---

## Scope Check

The approved WorkOS identity spec covers multiple subsystems: WorkOS/AuthKit setup, Supabase RLS re-keying, audit actor handling, Edge Functions, team management, client auth, and orbit-support. This plan intentionally covers only the first gate:

- configure and verify WorkOS staging token shape
- prove normal customer tokens include `org_id`
- prove Supabase RLS accepts matching `sub` + `org_id` and rejects non-matching rows
- generate an exact identity-callsite inventory for the next plan

Later plans should be split by subsystem after this gate passes.

## File Structure

- Create: `docs/workos/phase0-rls-probe.sql`
  - Disposable SQL for a public RLS probe table in the Supabase project used for staging validation.
- Create: `scripts/workos/phase0-assert-workos-token.mjs`
  - Decodes and validates a real WorkOS access token without persisting secrets.
- Create: `scripts/workos/phase0-seed-rls-probe.mjs`
  - Uses the Supabase service role key to seed positive and negative probe rows derived from the real token.
- Create: `scripts/workos/phase0-rls-smoke.mjs`
  - Uses the WorkOS token as the Supabase bearer token and asserts RLS returns only the matching row.
- Create: `scripts/workos/identity-callsite-inventory.mjs`
  - Generates `docs/workos/identity-callsite-inventory.json` with categorized `auth.uid()`, AAL/MFA, invite, and Supabase Auth callsites.

## Required Manual Inputs

Create a local shell environment before running scripts. Do not commit these
values. Export each variable with the real value from the WorkOS and Supabase
staging dashboards, then run the validation command below.

```bash
: "${WORKOS_CLIENT_ID:?set WORKOS_CLIENT_ID from WorkOS staging}"
: "${WORKOS_PHASE0_ACCESS_TOKEN:?set WORKOS_PHASE0_ACCESS_TOKEN from a staging AuthKit login}"
: "${WORKOS_PHASE0_EXPECTED_ORG_ID:?set WORKOS_PHASE0_EXPECTED_ORG_ID from the decoded staging token}"
: "${SUPABASE_PHASE0_URL:?set SUPABASE_PHASE0_URL from Supabase staging}"
: "${SUPABASE_PHASE0_ANON_KEY:?set SUPABASE_PHASE0_ANON_KEY from Supabase staging API settings}"
: "${SUPABASE_PHASE0_SERVICE_ROLE_KEY:?set SUPABASE_PHASE0_SERVICE_ROLE_KEY from Supabase staging API settings}"
```

## Task 1: Commit The Approved Design Spec

**Files:**
- Already committed: `docs/superpowers/specs/2026-06-05-workos-migration-design.md`

- [ ] **Step 1: Confirm the approved spec commit exists**

Run:

```bash
git log --oneline -- docs/superpowers/specs/2026-06-05-workos-migration-design.md
```

Expected: output includes:

```text
0818314 docs: add workos identity migration design
```

- [ ] **Step 2: Confirm no unrelated files are staged**

Run:

```bash
git diff --cached --stat
```

Expected: no output.

## Task 2: Add The Disposable Supabase RLS Probe SQL

**Files:**
- Create: `docs/workos/phase0-rls-probe.sql`

- [ ] **Step 1: Create the docs directory**

Run:

```bash
mkdir -p docs/workos
```

Expected: command exits 0.

- [ ] **Step 2: Create the SQL probe file**

Create `docs/workos/phase0-rls-probe.sql` with this exact content:

```sql
-- WorkOS Phase 0 RLS probe.
-- Run this in the Supabase SQL editor for the staging validation project.
-- The table is disposable and must not become part of product auth.

BEGIN;

CREATE TABLE IF NOT EXISTS public.workos_phase0_rls_probe (
  id TEXT PRIMARY KEY CHECK (id IN ('allowed', 'wrong-org', 'wrong-user')),
  workos_user_id TEXT NOT NULL,
  workos_org_id TEXT NOT NULL,
  visible_label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.workos_phase0_rls_probe ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workos_phase0_select_matching_claims"
  ON public.workos_phase0_rls_probe;

CREATE POLICY "workos_phase0_select_matching_claims"
  ON public.workos_phase0_rls_probe
  FOR SELECT
  TO authenticated
  USING (
    workos_user_id = auth.jwt()->>'sub'
    AND workos_org_id = auth.jwt()->>'org_id'
  );

REVOKE ALL ON public.workos_phase0_rls_probe FROM anon;
REVOKE ALL ON public.workos_phase0_rls_probe FROM authenticated;
GRANT SELECT ON public.workos_phase0_rls_probe TO authenticated;

CREATE INDEX IF NOT EXISTS idx_workos_phase0_rls_probe_claims
  ON public.workos_phase0_rls_probe(workos_user_id, workos_org_id);

COMMIT;

-- Cleanup command after Phase 0 is fully recorded:
-- DROP TABLE IF EXISTS public.workos_phase0_rls_probe;
```

- [ ] **Step 3: Review the SQL file**

Run:

```bash
sed -n '1,120p' docs/workos/phase0-rls-probe.sql
```

Expected: output includes `workos_user_id = auth.jwt()->>'sub'` and `workos_org_id = auth.jwt()->>'org_id'`.

- [ ] **Step 4: Apply the SQL in Supabase SQL editor**

Run the file contents in the Supabase SQL editor for the staging validation project.

Expected: SQL editor reports success and the table `public.workos_phase0_rls_probe` exists.

- [ ] **Step 5: Commit the SQL probe file**

Run:

```bash
git add docs/workos/phase0-rls-probe.sql
git commit -m "chore(workos): add phase0 rls probe sql"
```

Expected: commit succeeds.

## Task 3: Add WorkOS Token Assertion Script

**Files:**
- Create: `scripts/workos/phase0-assert-workos-token.mjs`

- [ ] **Step 1: Run the missing script to verify the failure**

Run:

```bash
node scripts/workos/phase0-assert-workos-token.mjs
```

Expected: FAIL with `MODULE_NOT_FOUND` or `Cannot find module`.

- [ ] **Step 2: Create the script directory**

Run:

```bash
mkdir -p scripts/workos
```

Expected: command exits 0.

- [ ] **Step 3: Create the token assertion script**

Create `scripts/workos/phase0-assert-workos-token.mjs` with this exact content:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

function decodeJwt(token) {
  const parts = token.split('.')
  assert.equal(parts.length, 3, 'token must have three JWT parts')
  return {
    header: decodeJwtPart(parts[0]),
    payload: decodeJwtPart(parts[1]),
  }
}

const token = requiredEnv('WORKOS_PHASE0_ACCESS_TOKEN')
const clientId = requiredEnv('WORKOS_CLIENT_ID')
const expectedIssuer = `https://api.workos.com/user_management/${clientId}`
const expectedOrgId = process.env.WORKOS_PHASE0_EXPECTED_ORG_ID?.trim()

const { header, payload } = decodeJwt(token)
const now = Math.floor(Date.now() / 1000)

assert.equal(payload.iss, expectedIssuer, 'issuer must match WorkOS user-management issuer')
assert.equal(payload.role, 'authenticated', 'role must be the Supabase postgres role')
assert.equal(typeof payload.sub, 'string', 'sub must be a string')
assert.ok(payload.sub.startsWith('user_'), 'sub must look like a WorkOS user id')
assert.equal(typeof payload.org_id, 'string', 'normal app token must include org_id')
assert.ok(payload.org_id.startsWith('org_'), 'org_id must look like a WorkOS org id')
assert.equal(typeof payload.user_role, 'string', 'token must include user_role')
assert.ok(['admin', 'editor', 'viewer'].includes(payload.user_role), 'user_role must match Quova role enum')
assert.equal(typeof payload.sid, 'string', 'token must include sid')
assert.equal(typeof payload.exp, 'number', 'token must include numeric exp')
assert.ok(payload.exp > now, 'token must not be expired')

if (expectedOrgId) {
  assert.equal(payload.org_id, expectedOrgId, 'org_id must match expected staging org')
}

console.log(JSON.stringify({
  header_alg: header.alg,
  iss: payload.iss,
  sub: payload.sub,
  org_id: payload.org_id,
  role: payload.role,
  user_role: payload.user_role,
  sid: payload.sid,
  exp: payload.exp,
}, null, 2))
```

- [ ] **Step 4: Run without env to verify controlled failure**

Run:

```bash
node scripts/workos/phase0-assert-workos-token.mjs
```

Expected: FAIL with:

```text
WORKOS_PHASE0_ACCESS_TOKEN is required
```

- [ ] **Step 5: Run with real staging env**

Run:

```bash
node scripts/workos/phase0-assert-workos-token.mjs
```

Expected: PASS and print JSON containing `role: "authenticated"`, an `org_id` beginning with `org_`, and `user_role` equal to `admin`, `editor`, or `viewer`.

- [ ] **Step 6: Commit the token assertion script**

Run:

```bash
git add scripts/workos/phase0-assert-workos-token.mjs
git commit -m "chore(workos): add phase0 token assertion"
```

Expected: commit succeeds.

## Task 4: Add Supabase RLS Probe Seeder

**Files:**
- Create: `scripts/workos/phase0-seed-rls-probe.mjs`

- [ ] **Step 1: Run the missing script to verify the failure**

Run:

```bash
node scripts/workos/phase0-seed-rls-probe.mjs
```

Expected: FAIL with `MODULE_NOT_FOUND` or `Cannot find module`.

- [ ] **Step 2: Create the probe seeder script**

Create `scripts/workos/phase0-seed-rls-probe.mjs` with this exact content:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  assert.equal(parts.length, 3, 'token must have three JWT parts')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

const supabaseUrl = requiredEnv('SUPABASE_PHASE0_URL')
const serviceRoleKey = requiredEnv('SUPABASE_PHASE0_SERVICE_ROLE_KEY')
const token = requiredEnv('WORKOS_PHASE0_ACCESS_TOKEN')
const payload = decodeJwtPayload(token)

assert.equal(typeof payload.sub, 'string', 'token must include sub')
assert.equal(typeof payload.org_id, 'string', 'token must include org_id')

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

const rows = [
  {
    id: 'allowed',
    workos_user_id: payload.sub,
    workos_org_id: payload.org_id,
    visible_label: 'allowed row for matching WorkOS sub and org',
  },
  {
    id: 'wrong-org',
    workos_user_id: payload.sub,
    workos_org_id: 'org_phase0_wrong',
    visible_label: 'row with matching user and wrong org',
  },
  {
    id: 'wrong-user',
    workos_user_id: 'user_phase0_wrong',
    workos_org_id: payload.org_id,
    visible_label: 'row with wrong user and matching org',
  },
]

const { data, error } = await admin
  .from('workos_phase0_rls_probe')
  .upsert(rows, { onConflict: 'id' })
  .select('id, workos_user_id, workos_org_id, visible_label')
  .order('id')

if (error) {
  throw new Error(`Failed to seed probe rows: ${error.message}`)
}

console.log(JSON.stringify(data, null, 2))
```

- [ ] **Step 3: Run without env to verify controlled failure**

Run:

```bash
node scripts/workos/phase0-seed-rls-probe.mjs
```

Expected: FAIL with:

```text
SUPABASE_PHASE0_URL is required
```

- [ ] **Step 4: Run with real staging env**

Run:

```bash
node scripts/workos/phase0-seed-rls-probe.mjs
```

Expected: PASS and print three rows with ids `allowed`, `wrong-org`, and `wrong-user`.

- [ ] **Step 5: Commit the seeder**

Run:

```bash
git add scripts/workos/phase0-seed-rls-probe.mjs
git commit -m "chore(workos): add phase0 rls probe seeder"
```

Expected: commit succeeds.

## Task 5: Add Supabase RLS Smoke Test Script

**Files:**
- Create: `scripts/workos/phase0-rls-smoke.mjs`

- [ ] **Step 1: Run the missing script to verify the failure**

Run:

```bash
node scripts/workos/phase0-rls-smoke.mjs
```

Expected: FAIL with `MODULE_NOT_FOUND` or `Cannot find module`.

- [ ] **Step 2: Create the RLS smoke script**

Create `scripts/workos/phase0-rls-smoke.mjs` with this exact content:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  assert.equal(parts.length, 3, 'token must have three JWT parts')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

const supabaseUrl = requiredEnv('SUPABASE_PHASE0_URL')
const anonKey = requiredEnv('SUPABASE_PHASE0_ANON_KEY')
const token = requiredEnv('WORKOS_PHASE0_ACCESS_TOKEN')
const payload = decodeJwtPayload(token)

assert.equal(typeof payload.sub, 'string', 'token must include sub')
assert.equal(typeof payload.org_id, 'string', 'token must include org_id')

const supabase = createClient(supabaseUrl, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
  accessToken: async () => token,
})

const { data, error } = await supabase
  .from('workos_phase0_rls_probe')
  .select('id, workos_user_id, workos_org_id, visible_label')
  .order('id')

if (error) {
  throw new Error(`RLS probe failed: ${error.message}`)
}

assert.deepEqual(
  data.map(row => row.id),
  ['allowed'],
  'RLS must return only the matching row'
)
assert.equal(data[0].workos_user_id, payload.sub, 'returned row must match token sub')
assert.equal(data[0].workos_org_id, payload.org_id, 'returned row must match token org_id')

console.log(JSON.stringify({
  rows_visible: data.length,
  visible_ids: data.map(row => row.id),
  sub: payload.sub,
  org_id: payload.org_id,
}, null, 2))
```

- [ ] **Step 3: Run without env to verify controlled failure**

Run:

```bash
node scripts/workos/phase0-rls-smoke.mjs
```

Expected: FAIL with:

```text
SUPABASE_PHASE0_URL is required
```

- [ ] **Step 4: Run with real staging env**

Run:

```bash
node scripts/workos/phase0-rls-smoke.mjs
```

Expected: PASS and print:

```json
{
  "rows_visible": 1,
  "visible_ids": [
    "allowed"
  ]
}
```

- [ ] **Step 5: Commit the smoke script**

Run:

```bash
git add scripts/workos/phase0-rls-smoke.mjs
git commit -m "chore(workos): add phase0 rls smoke test"
```

Expected: commit succeeds.

## Task 6: Add Identity Callsite Inventory Script

**Files:**
- Create: `scripts/workos/identity-callsite-inventory.mjs`
- Generated by script: `docs/workos/identity-callsite-inventory.json`

- [ ] **Step 1: Run the missing script to verify the failure**

Run:

```bash
node scripts/workos/identity-callsite-inventory.mjs
```

Expected: FAIL with `MODULE_NOT_FOUND` or `Cannot find module`.

- [ ] **Step 2: Create the inventory script**

Create `scripts/workos/identity-callsite-inventory.mjs` with this exact content:

```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const roots = ['src', 'supabase/functions', 'supabase/migrations', 'tests']
const outputPath = 'docs/workos/identity-callsite-inventory.json'

const patterns = [
  { key: 'auth_uid', pattern: 'auth\\.uid\\(\\)' },
  { key: 'aal_or_mfa', pattern: "auth\\.jwt\\(\\)->>'aal'|aal2|authenticateUserAal2|getAuthenticatorAssuranceLevel|Supabase MFA|mfa" },
  { key: 'supabase_auth', pattern: 'supabase\\.auth\\.|auth\\.users|Session|User' },
  { key: 'invite_flow', pattern: 'accept_invite|send-team-invite|invites|AcceptInvitePage|teamInviteEmail' },
  { key: 'support_identity', pattern: 'support_users|is_support_user|has_support_access_to|support_write_audit_log' },
  { key: 'audit_identity', pattern: 'write_audit_log|audit_trigger_func|enforce_audit_log_fields|audit_logs' },
]

function runRg(pattern) {
  try {
    return execFileSync('rg', ['-n', pattern, ...roots, '-g', '!deno.lock'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    if (error.status === 1) return ''
    throw error
  }
}

function classifyFile(file) {
  if (file.startsWith('supabase/migrations/')) return 'migration'
  if (file.startsWith('supabase/functions/')) return 'edge-function'
  if (file.startsWith('src/')) return 'frontend'
  if (file.startsWith('tests/')) return 'test'
  return 'other'
}

function parseLine(rawLine) {
  const first = rawLine.indexOf(':')
  const second = rawLine.indexOf(':', first + 1)
  const file = rawLine.slice(0, first)
  const line = Number(rawLine.slice(first + 1, second))
  const text = rawLine.slice(second + 1).trim()
  return {
    file,
    line,
    category: classifyFile(file),
    text,
  }
}

const inventory = {
  generated_at: new Date().toISOString(),
  roots,
  patterns: {},
  summary: {},
}

for (const { key, pattern } of patterns) {
  const raw = runRg(pattern)
  const entries = raw
    .split('\n')
    .filter(Boolean)
    .map(parseLine)

  inventory.patterns[key] = entries
  inventory.summary[key] = {
    matches: entries.length,
    files: [...new Set(entries.map(entry => entry.file))].sort().length,
    by_category: entries.reduce((acc, entry) => {
      acc[entry.category] = (acc[entry.category] || 0) + 1
      return acc
    }, {}),
  }
}

mkdirSync(path.dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`)

console.log(JSON.stringify(inventory.summary, null, 2))
console.log(`Wrote ${outputPath}`)
```

- [ ] **Step 3: Run the inventory script**

Run:

```bash
node scripts/workos/identity-callsite-inventory.mjs
```

Expected: PASS, prints JSON summary, and writes `docs/workos/identity-callsite-inventory.json`.

- [ ] **Step 4: Inspect key counts**

Run:

```bash
node -e "const i=require('./docs/workos/identity-callsite-inventory.json'); console.log(i.summary.auth_uid); console.log(i.summary.aal_or_mfa)"
```

Expected: both printed summaries have `matches` greater than 0.

- [ ] **Step 5: Commit the inventory script and generated inventory**

Run:

```bash
git add scripts/workos/identity-callsite-inventory.mjs docs/workos/identity-callsite-inventory.json
git commit -m "chore(workos): inventory identity callsites"
```

Expected: commit succeeds.

## Task 7: Record Phase 0 Validation Result

**Files:**
- Create: `scripts/workos/phase0-write-result.mjs`
- Create: `docs/workos/phase0-validation-result.md`

- [ ] **Step 1: Create the result writer script**

Create `scripts/workos/phase0-write-result.mjs` with this exact content:

```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const tokenAssertion = run('node', ['scripts/workos/phase0-assert-workos-token.mjs'])
const seedResult = run('node', ['scripts/workos/phase0-seed-rls-probe.mjs'])
const smokeResult = run('node', ['scripts/workos/phase0-rls-smoke.mjs'])
const inventoryRaw = readFileSync('docs/workos/identity-callsite-inventory.json', 'utf8')
const inventory = JSON.parse(inventoryRaw)

const output = `# WorkOS Phase 0 Validation Result

Date: ${new Date().toISOString().slice(0, 10)}

## Token Assertion

Command:

\`\`\`bash
node scripts/workos/phase0-assert-workos-token.mjs
\`\`\`

Output:

\`\`\`json
${tokenAssertion}
\`\`\`

## RLS Probe Seeding

Command:

\`\`\`bash
node scripts/workos/phase0-seed-rls-probe.mjs
\`\`\`

Output:

\`\`\`json
${seedResult}
\`\`\`

## RLS Smoke

Command:

\`\`\`bash
node scripts/workos/phase0-rls-smoke.mjs
\`\`\`

Output:

\`\`\`json
${smokeResult}
\`\`\`

## Identity Inventory Summary

\`\`\`json
${JSON.stringify(inventory.summary, null, 2)}
\`\`\`

## Gate Decision

Phase 0 passed because the decoded token has \`role = authenticated\`, has a
real WorkOS \`org_id\`, has a Quova \`user_role\`, the Supabase RLS smoke script
returned only the \`allowed\` row, and the generated identity callsite inventory
exists.

Decision: PASS
`

writeFileSync('docs/workos/phase0-validation-result.md', output)
console.log('Wrote docs/workos/phase0-validation-result.md')
```

- [ ] **Step 2: Run the result writer**

Run:

```bash
node scripts/workos/phase0-write-result.mjs
```

Expected: PASS and prints:

```text
Wrote docs/workos/phase0-validation-result.md
```

- [ ] **Step 3: Inspect the generated result**

Run:

```bash
sed -n '1,220p' docs/workos/phase0-validation-result.md
```

Expected: output includes `Decision: PASS`, `rows_visible`, and `Identity Inventory Summary`.

- [ ] **Step 4: Commit validation result**

Run:

```bash
git add scripts/workos/phase0-write-result.mjs docs/workos/phase0-validation-result.md
git commit -m "docs(workos): record phase0 validation result"
```

Expected: commit succeeds.

## Task 8: Cleanup Disposable Probe After Result Is Recorded

**Files:**
- Read: `docs/workos/phase0-rls-probe.sql`

- [ ] **Step 1: Drop the disposable probe table in Supabase SQL editor**

Run this in the Supabase SQL editor only after Task 7 is committed:

```sql
DROP TABLE IF EXISTS public.workos_phase0_rls_probe;
```

Expected: SQL editor reports success.

- [ ] **Step 2: Run the RLS smoke script to verify cleanup**

Run:

```bash
node scripts/workos/phase0-rls-smoke.mjs
```

Expected: FAIL with an error that the relation/table is missing.

- [ ] **Step 3: Record cleanup in git**

Run:

```bash
git commit --allow-empty -m "chore(workos): cleanup phase0 rls probe"
```

Expected: empty commit succeeds and documents the cleanup point.

## Final Verification

- [ ] **Step 1: Verify no secrets were committed**

Run:

```bash
rg -n "WORKOS_PHASE0_ACCESS_TOKEN|SUPABASE_PHASE0_SERVICE_ROLE_KEY|eyJ" docs scripts
```

Expected: matches only environment variable names in docs/scripts, not real token values.

- [ ] **Step 2: Verify repository state**

Run:

```bash
git status -sb
```

Expected: no staged changes. Unrelated local `.claude` changes may remain unstaged.

- [ ] **Step 3: Push the Phase 0 plan/execution commits**

Run:

```bash
git push origin main
```

Expected: push succeeds.
